import { test, expect, type Page } from "@playwright/test";
import { PrismaClient, type Prisma } from "@prisma/client";
import { E2E_DATABASE_URL } from "./global-setup";

/**
 * The needs-a-human queue: the card, its disclosure, the held changes and the
 * two ways out of it.
 *
 * NOTHING ELSE IN THE SUITE REACHES THIS SCREEN. No seed writes an AgentRun,
 * and the only handler in this build — `system.hello` — returns `success`
 * unconditionally, so no test can produce a `needs_human` run by driving the
 * app. The two runs below are therefore written straight into the isolated e2e
 * schema and deleted in afterAll, exactly as payroll-adjustment-edit.spec.ts
 * writes its payroll run. The rows are inert: `notifyRun` lives in the runner,
 * not in a database trigger, so a hand-written run notifies nobody.
 *
 * WHY THIS IS ITS OWN FILE, and not more tests appended to agents.spec.ts: a
 * file-level `beforeAll` there would put a card in the queue for that file's
 * own tests, one of which reads this very page and asserts what the feed
 * holds. `fullyParallel: false` and `workers: 1` mean no other file is live
 * while this one runs, so the fixture's blast radius is this file's duration
 * and nothing else ever sees these rows.
 *
 * NEVER SEED A `failed` RUN HERE. agents.spec.ts asserts that the status=failed
 * filter shows "No runs match these filters."; a `needs_human` run keeps that
 * true, and a `failed` one would break it.
 */

const PASSWORD = "Passw0rd!";
const STAMP = Date.now();
const HELD_NOTHING = `E2E held run holding nothing ${STAMP}`;
const HELD_CHANGE = `E2E held run holding one change ${STAMP}`;
const DEAL_LABEL = `E2E Queue Fixture ${STAMP}`;

/** Exactly TargetStage: what a held change has to carry for the re-check. */
const TARGET_STAGE = {
  id: true,
  key: true,
  name: true,
  position: true,
  isActionRequired: true,
  defaultBlocker: true,
  stageType: true,
} as const;

const db = new PrismaClient({ datasources: { db: { url: E2E_DATABASE_URL } } });

let emptyRunId = "";
let changeRunId = "";
let leadId = "";
let toStageId = "";

async function login(page: Page, email: string) {
  await page.context().clearCookies();
  await page.goto("/login");
  await page.fill("#email", email);
  await page.fill("#password", PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/portal/**", { timeout: 15000 });
}

/** A RunDetail written by hand, in the shape readDetail expects to find. */
function detail(changes: unknown[]): Prisma.InputJsonValue {
  return {
    handlerKey: "system.hello",
    configSnapshot: {},
    gated: true,
    durationMs: 10,
    log: [],
    handler: null,
    changes,
    resolution: null,
    lateResult: null,
  } as unknown as Prisma.InputJsonValue;
}

test.beforeAll(async () => {
  const company = await db.company.findUniqueOrThrow({ where: { slug: "anexa-homes" }, select: { id: true } });
  const agent = await db.agent.findFirstOrThrow({
    where: { companyId: company.id, name: "Hello Agent" },
    select: { id: true },
  });
  const pipeline = await db.pipeline.findFirstOrThrow({
    where: { companyId: company.id, vertical: "roofing" },
    select: { id: true },
  });

  /**
   * Two ORDINARY EARLY stages, on purpose. Both sit far before Contract Signed
   * (position 7), and roofing has no M1 Funding gate at all, so neither half of
   * `stageMoveError` can refuse this move — a gated stage would fail the Apply
   * test for a reason that has nothing to do with the queue.
   */
  const from = await db.pipelineStage.findFirstOrThrow({
    where: { pipelineId: pipeline.id, key: "new_lead" },
    select: TARGET_STAGE,
  });
  const to = await db.pipelineStage.findFirstOrThrow({
    where: { pipelineId: pipeline.id, key: "appointment_set" },
    select: TARGET_STAGE,
  });
  toStageId = to.id;

  // A throwaway deal, so Apply moves a row no other spec asserts on.
  const lead = await db.lead.create({
    data: {
      companyId: company.id,
      vertical: "roofing",
      pipelineId: pipeline.id,
      stageId: from.id,
      firstName: "E2E Queue",
      lastName: `Fixture ${STAMP}`,
      address: "1 Held Run Way",
    },
  });
  leadId = lead.id;

  // Holding nothing: there is no deal on this one and nothing to clean up but
  // the row itself.
  emptyRunId = (
    await db.agentRun.create({
      data: {
        companyId: company.id,
        agentId: agent.id,
        vertical: "roofing",
        trigger: "manual",
        status: "needs_human",
        summary: HELD_NOTHING,
        startedAt: new Date(),
        finishedAt: new Date(),
        detail: detail([]),
      },
    })
  ).id;

  /**
   * Holding one change. The shape has to satisfy `resolveAgentRunAction`'s
   * re-check, which is strict: `fromStage.id` must be the lead's CURRENT
   * stage, `toStage.id` must be a stage in that lead's OWN pipeline, and
   * `toStage` must be the full TargetStage rather than a bare StageRef.
   */
  const change = {
    type: "move_stage",
    leadId: lead.id,
    toStageKey: to.key,
    reason: "Appointment confirmed by phone",
    dealLabel: DEAL_LABEL,
    fromStage: { id: from.id, key: from.key, name: from.name },
    toStage: to,
    outcome: "held",
    note: "Held: this agent is gated and Appointment Set is not an Action Required stage.",
  };
  changeRunId = (
    await db.agentRun.create({
      data: {
        companyId: company.id,
        agentId: agent.id,
        leadId: lead.id,
        leadLabel: DEAL_LABEL,
        vertical: "roofing",
        trigger: "manual",
        status: "needs_human",
        summary: HELD_CHANGE,
        startedAt: new Date(),
        finishedAt: new Date(),
        detail: detail([change]),
      },
    })
  ).id;
});

/**
 * Ordered, and every one a deleteMany, so a failure part-way through the file
 * still leaves the schema as it was found. The runs go FIRST: `AgentRun.leadId`
 * is SetNull, so a run would otherwise outlive its deal and sit in the queue
 * for every later file in the run.
 */
test.afterAll(async () => {
  await db.agentRun.deleteMany({ where: { id: { in: [emptyRunId, changeRunId].filter(Boolean) } } });
  if (leadId) {
    await db.leadStageEvent.deleteMany({ where: { leadId } });
    await db.activityLog.deleteMany({ where: { leadId } });
    await db.lead.deleteMany({ where: { id: leadId } });
  }
  await db.$disconnect();
});

test("a run holding nothing says so, offers no Apply, and leaves the queue when it is closed", async ({ page }) => {
  await login(page, "admin@anexahomes.com");
  await page.goto("/portal/agents/runs");

  const card = page.getByTestId("needs-human-card").filter({ hasText: HELD_NOTHING });
  await expect(card).toBeVisible();

  await card.getByRole("button", { name: "Review and resolve" }).click();
  await expect(card.getByText("This run is holding no changes")).toBeVisible();
  await expect(card.getByTestId("agent-run-changes")).toHaveCount(0);
  // heldCount === 0 is a fact, not an unread run: Apply is ABSENT, not disabled.
  await expect(card.getByRole("button", { name: /^Apply/ })).toHaveCount(0);

  await card.getByRole("button", { name: "Close without applying" }).click();
  const dialog = page.getByRole("dialog", { name: "Close without applying" });
  const closeRun = dialog.getByRole("button", { name: "Close run" });
  // The note is the only record of the decision, so it is required.
  await expect(closeRun).toBeDisabled();
  await dialog.getByLabel("Why it is closed").fill("Checked by hand; there was nothing to do.");
  await expect(closeRun).toBeEnabled();
  await closeRun.click();

  /**
   * THE ASSERTION THIS FILE EXISTS FOR. A resolve sets `resolvedAt` without
   * touching `status`, and the queue filters on `resolvedAt: null` — so a card
   * that stays put after Close means the page is showing a run that has already
   * been answered, with a live button on it.
   */
  await expect(card).toHaveCount(0, { timeout: 15000 });

  const run = await db.agentRun.findUniqueOrThrow({
    where: { id: emptyRunId },
    select: { status: true, resolution: true, resolvedAt: true, resolutionNote: true },
  });
  expect(run).toMatchObject({ status: "needs_human", resolution: "closed" });
  expect(run.resolvedAt).not.toBeNull();
  expect(run.resolutionNote).toBe("Checked by hand; there was nothing to do.");
});

test("a run holding one change reads it in words, and Apply moves the deal and clears the card", async ({ page }) => {
  await login(page, "admin@anexahomes.com");
  await page.goto("/portal/agents/runs");

  const card = page.getByTestId("needs-human-card").filter({ hasText: HELD_CHANGE });
  await expect(card).toBeVisible();
  await expect(card.getByRole("link", { name: DEAL_LABEL })).toBeVisible();

  await card.getByRole("button", { name: "Review and resolve" }).click();
  const changes = card.getByTestId("agent-run-changes");
  await expect(changes).toContainText(`Move ${DEAL_LABEL} from New Appointment to Appointment Set`);
  await expect(changes).toContainText("Held for a person");
  await expect(changes).toContainText("Reason: Appointment confirmed by phone");

  // heldCount === 1, so the button counts what it would apply.
  await card.getByRole("button", { name: "Apply change" }).click();
  const confirm = page.getByRole("alertdialog");
  await expect(confirm).toContainText("Apply this change?");
  await confirm.getByRole("button", { name: "Apply", exact: true }).click();

  await expect(card).toHaveCount(0, { timeout: 20000 });

  // The deal really moved, and it moved as the person who pressed Apply.
  const lead = await db.lead.findUniqueOrThrow({ where: { id: leadId }, select: { stageId: true } });
  expect(lead.stageId).toBe(toStageId);
  const run = await db.agentRun.findUniqueOrThrow({
    where: { id: changeRunId },
    select: { resolution: true, resolvedById: true },
  });
  expect(run.resolution).toBe("applied");
  expect(run.resolvedById).not.toBeNull();
});
