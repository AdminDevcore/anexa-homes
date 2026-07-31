import { z } from "zod";
import type { CreditStatus } from "@prisma/client";
import { prisma } from "@/server/db/client";
import { runInVertical, runUnscoped, asActiveVertical } from "@/server/vertical/context";

export const dynamic = "force-dynamic";

/**
 * Inbound lender status webhook.
 *
 *   POST /api/webhooks/lenders/goodleap
 *   Authorization: Bearer <LENDER_WEBHOOK_SECRET>
 *
 * Lenders each speak their own dialect, so `mapStatus` normalises the handful
 * of words they actually use onto our CreditStatus. Anything unrecognised is
 * rejected rather than guessed — silently mapping an unknown status to
 * "approved" would push a deal to NTP on a decision that never happened.
 *
 * ISOLATION: there is no session here. The application is found by its lender +
 * external id (unscoped, because its workspace is unknown until it is read),
 * then everything downstream runs inside that deal's vertical so the stage move
 * and its notification rules resolve correctly.
 */

const payloadSchema = z.object({
  /** The lender's own application id, as supplied when we submitted. */
  applicationId: z.string().min(1),
  status: z.string().min(1),
  amountCents: z.number().int().min(0).optional(),
  termMonths: z.number().int().min(0).max(600).optional(),
  aprPct: z.number().min(0).max(50).optional(),
  dealerFeePct: z.number().min(0).max(100).optional(),
  stipulations: z.array(z.string()).optional(),
  expiresAt: z.string().datetime().optional(),
});

const STATUS_MAP: Record<string, CreditStatus> = {
  approved: "approved",
  approve: "approved",
  accepted: "approved",
  conditional: "conditional",
  conditionally_approved: "conditional",
  pending_stips: "conditional",
  declined: "declined",
  denied: "declined",
  rejected: "declined",
  expired: "expired",
  submitted: "submitted",
  received: "submitted",
  in_review: "submitted",
};

function mapStatus(raw: string): CreditStatus | null {
  return STATUS_MAP[raw.trim().toLowerCase().replace(/[\s-]+/g, "_")] ?? null;
}

export async function POST(req: Request, { params }: { params: Promise<{ lender: string }> }) {
  const secret = process.env.LENDER_WEBHOOK_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  const { lender } = await params;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = payloadSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ ok: false, error: "Invalid payload" }, { status: 400 });
  }

  const status = mapStatus(parsed.data.status);
  if (!status) {
    // Loud, not silent: an unmapped status means this lender changed their
    // vocabulary and somebody needs to add it.
    console.error(`[webhook:${lender}] unmapped status "${parsed.data.status}"`);
    return Response.json({ ok: false, error: "Unrecognised status" }, { status: 422 });
  }

  const app = await runUnscoped(
    "lender webhook: find the credit application before its workspace is known",
    () =>
      prisma.creditApplication.findFirst({
        where: { lender, externalId: parsed.data.applicationId },
        select: { id: true, companyId: true, leadId: true, lead: { select: { vertical: true } } },
      })
  );
  if (!app) return Response.json({ ok: false, error: "Unknown application" }, { status: 404 });

  const decided = status === "approved" || status === "declined" || status === "conditional";

  await runInVertical(asActiveVertical(app.lead.vertical), async () => {
    await prisma.creditApplication.update({
      where: { id: app.id },
      data: {
        status,
        ...(parsed.data.amountCents !== undefined ? { amountCents: parsed.data.amountCents } : {}),
        ...(parsed.data.termMonths !== undefined ? { termMonths: parsed.data.termMonths } : {}),
        ...(parsed.data.aprPct !== undefined ? { aprPct: parsed.data.aprPct } : {}),
        ...(parsed.data.dealerFeePct !== undefined ? { dealerFeePct: parsed.data.dealerFeePct } : {}),
        ...(parsed.data.stipulations ? { stipulations: parsed.data.stipulations } : {}),
        ...(parsed.data.expiresAt ? { expiresAt: new Date(parsed.data.expiresAt) } : {}),
        ...(decided ? { decidedAt: new Date() } : {}),
      },
    });

    // Approved credit unblocks the deal, so the lender stops being the blocker.
    // Deliberately does NOT auto-advance the stage: a coordinator confirms the
    // terms first, and a webhook should not move somebody's pipeline for them.
    if (status === "approved") {
      await prisma.lead.update({
        where: { id: app.leadId },
        data: { blockedBy: null, lastTouchAt: new Date() },
      });
    } else if (status === "conditional") {
      await prisma.lead.update({
        where: { id: app.leadId },
        data: {
          blockedBy: "customer", // stipulations are the customer's to clear
          blockerNote: (parsed.data.stipulations ?? []).join("; ") || "Lender stipulations outstanding",
        },
      });
    }

    await prisma.activityLog.create({
      data: {
        companyId: app.companyId,
        type: "system",
        message: `${lender} credit decision: ${status}`,
        leadId: app.leadId,
      },
    });
  });

  return Response.json({ ok: true, status });
}
