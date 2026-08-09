/**
 * Workspace-isolation probe. Logs in over HTTP as real users and attacks the
 * running server with direct URLs and direct object IDs — the checks a
 * page-level review cannot make, because a page being isolated says nothing
 * about its API, download or detail endpoint.
 *
 * MUST be pointed at a PRODUCTION BUILD:
 *
 *   npx next build
 *   SOLAR_VERTICAL_ENABLED=1 PORT=3009 npx next start
 *   SOLAR_VERTICAL_ENABLED=1 npx tsx scripts/isolation-fixture.ts
 *   PROBE_BASE=http://localhost:3009 npx tsx scripts/isolation-probe.ts
 *
 * `next dev` can instantiate server/vertical/context.ts twice, giving the
 * isolation extension a different AsyncLocalStorage than runInVertical writes
 * to. Overrides then silently no-op and this probe reports false results.
 *
 * Exit code is non-zero if any check fails, so it can gate a release.
 */
const BASE = process.env.PROBE_BASE ?? "http://localhost:3009";
const PASSWORD = "Passw0rd!";

const ROOF_LEAD = "00000000-0000-4000-8000-000000000101";
const SOLAR_LEAD = "00000000-0000-4000-8000-000000000102";
const FILE_COMPANY = "00000000-0000-4000-8000-000000000301";
const FILE_SOLAR_WS = "00000000-0000-4000-8000-000000000302";
const FILE_PRIVATE = "00000000-0000-4000-8000-000000000303";
const FILE_SOLAR_DEAL = "00000000-0000-4000-8000-000000000304";

type Session = { cookie: string; label: string };

function mergeCookies(jar: Map<string, string>, res: Response) {
  // getSetCookie is the only way to see multiple Set-Cookie headers.
  const raw = (res.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie?.() ?? [];
  for (const c of raw) {
    const [pair] = c.split(";");
    const idx = pair.indexOf("=");
    if (idx > 0) jar.set(pair.slice(0, idx).trim(), pair.slice(idx + 1).trim());
  }
}
const jarToHeader = (jar: Map<string, string>) =>
  [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");

async function login(email: string): Promise<Session> {
  const jar = new Map<string, string>();
  const csrfRes = await fetch(`${BASE}/api/auth/csrf`);
  mergeCookies(jar, csrfRes);
  const { csrfToken } = (await csrfRes.json()) as { csrfToken: string };

  const res = await fetch(`${BASE}/api/auth/callback/credentials`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", cookie: jarToHeader(jar) },
    body: new URLSearchParams({ csrfToken, email, password: PASSWORD, redirect: "false", json: "true" }),
    redirect: "manual",
  });
  mergeCookies(jar, res);

  const check = await fetch(`${BASE}/api/auth/session`, { headers: { cookie: jarToHeader(jar) } });
  const session = (await check.json()) as { user?: { id?: string } };
  if (!session?.user?.id) throw new Error(`login failed for ${email} (status ${res.status})`);
  return { cookie: jarToHeader(jar), label: email };
}

/** Set the active-workspace cookie the way the switcher does. */
function withWorkspace(s: Session, v: "roofing" | "solar"): Session {
  const stripped = s.cookie
    .split("; ")
    .filter((c) => !c.startsWith("anexa_vertical="))
    .join("; ");
  return { ...s, cookie: `${stripped}; anexa_vertical=${v}` };
}

async function get(s: Session, path: string) {
  const res = await fetch(`${BASE}${path}`, { headers: { cookie: s.cookie }, redirect: "manual" });
  const body = res.status === 200 ? await res.text() : "";
  return { status: res.status, body, location: res.headers.get("location") ?? "" };
}

let pass = 0;
let fail = 0;
const failures: string[] = [];

function check(name: string, ok: boolean, detail: string) {
  if (ok) {
    pass++;
    console.log(`  PASS  ${name}`);
  } else {
    fail++;
    failures.push(`${name} — ${detail}`);
    console.log(`  FAIL  ${name}  (${detail})`);
  }
}

async function main() {
  console.log(`Probing ${BASE}\n`);
  const roof = await login("isoroof@test.local");
  const solar = await login("isosolar@test.local");
  const dual = await login("isodual@test.local");
  const rep = await login("isorep@test.local");
  const acctRoof = await login("isoacctroof@test.local");
  const acctSolar = await login("isoacctsolar@test.local");
  console.log("logged in: roofing-admin, solar-admin, dual-admin, roofing-rep\n");

  // ---- 1. Operational data: direct object-ID access across workspaces -------
  console.log("1. Deal pages by direct object ID");
  {
    const r = await get(roof, `/portal/leads/${SOLAR_LEAD}`);
    check("roofing-only CANNOT open a Solar deal by id", r.status !== 200 || !r.body.includes("solarLEAD"), `status=${r.status}`);
    const s = await get(solar, `/portal/leads/${ROOF_LEAD}`);
    check("solar-only CANNOT open a Roofing deal by id", s.status !== 200 || !s.body.includes("roofingLEAD"), `status=${s.status}`);
    const own = await get(roof, `/portal/leads/${ROOF_LEAD}`);
    check("roofing-only CAN open its own Roofing deal", own.status === 200 && own.body.includes("roofingLEAD"), `status=${own.status}`);
  }

  // ---- 2. Knowledge base — the hard rule ------------------------------------
  console.log("\n2. Knowledge base isolation (hard rule)");
  {
    const r = await get(roof, "/portal/knowledge");
    check("roofing sees Roofing KB", r.body.includes("ISO roofing training"), `status=${r.status}`);
    check("roofing does NOT see Solar KB", !r.body.includes("ISO solar training") && !r.body.includes("ISO solar SECRET DOC"), "solar content present");
    const s = await get(solar, "/portal/knowledge");
    check("solar sees Solar KB", s.body.includes("ISO solar training"), `status=${s.status}`);
    check("solar does NOT see Roofing KB", !s.body.includes("ISO roofing training") && !s.body.includes("ISO roofing SECRET DOC"), "roofing content present");
    // Dual user must see exactly one side at a time, decided by active workspace.
    const dR = await get(withWorkspace(dual, "roofing"), "/portal/knowledge");
    check("dual in Roofing sees ONLY Roofing KB", dR.body.includes("ISO roofing training") && !dR.body.includes("ISO solar training"), "leak");
    const dS = await get(withWorkspace(dual, "solar"), "/portal/knowledge");
    check("dual in Solar sees ONLY Solar KB", dS.body.includes("ISO solar training") && !dS.body.includes("ISO roofing training"), "leak");
  }

  // ---- 3. Tasks: workspace vs company scope --------------------------------
  console.log("\n3. Task scope");
  {
    const r = await get(withWorkspace(dual, "roofing"), "/portal/tasks");
    check("Roofing shows the Roofing task", r.body.includes("ISO ROOFING TASK"), `status=${r.status}`);
    check("Roofing HIDES the Solar task", !r.body.includes("ISO SOLAR TASK"), "solar task leaked");
    check("Roofing shows the Company task", r.body.includes("ISO COMPANY TASK"), "company task missing");
    const s = await get(withWorkspace(dual, "solar"), "/portal/tasks");
    check("Solar shows the Solar task", s.body.includes("ISO SOLAR TASK"), `status=${s.status}`);
    check("Solar HIDES the Roofing task", !s.body.includes("ISO ROOFING TASK"), "roofing task leaked");
    check("Solar shows the Company task", s.body.includes("ISO COMPANY TASK"), "company task missing");
  }

  // ---- 4. Global search: permitted workspaces, not active ------------------
  console.log("\n4. Global search (permission-scoped)");
  {
    const rq = await get(roof, "/api/search?q=ISO");
    check("roofing-only search excludes Solar deals", !rq.body.includes("solarLEAD"), "solar leaked into search");
    check("roofing-only search includes its own deals", rq.body.includes("roofingLEAD"), `status=${rq.status}`);
    const sq = await get(solar, "/api/search?q=ISO");
    check("solar-only search excludes Roofing deals", !sq.body.includes("roofingLEAD"), "roofing leaked into search");
    const dq = await get(withWorkspace(dual, "roofing"), "/api/search?q=ISO");
    const d = JSON.parse(dq.body) as { leads: { title: string; vertical: string }[]; showWorkspace: boolean };
    const verts = new Set(d.leads.map((l) => l.vertical));
    check("dual search spans BOTH workspaces while standing in Roofing", verts.has("roofing") && verts.has("solar"), `saw ${[...verts].join(",")}`);
    check("dual search results carry a workspace label", d.showWorkspace === true, `showWorkspace=${d.showWorkspace}`);
  }

  // ---- 5. Combined calendar ------------------------------------------------
  console.log("\n5. Calendar modes");
  {
    const from = "2020-01-01T00:00:00.000Z";
    const to = "2035-01-01T00:00:00.000Z";
    const c = await get(withWorkspace(dual, "roofing"), `/api/calendar?from=${from}&to=${to}&mode=combined`);
    const parsed = JSON.parse(c.body) as { events: { vertical: string }[]; mode: string };
    check("combined mode is honoured", parsed.mode === "combined", `mode=${parsed.mode}`);
    const solarOnly = await get(roof, `/api/calendar?from=${from}&to=${to}&mode=solar`);
    const so = JSON.parse(solarOnly.body) as { events: { vertical: string }[]; mode: string };
    check("roofing-only asking for mode=solar is refused (falls back)", so.mode !== "solar" && !so.events.some((e) => e.vertical === "solar"), `mode=${so.mode}`);
    const comboForSingle = await get(roof, `/api/calendar?from=${from}&to=${to}&mode=combined`);
    const cs = JSON.parse(comboForSingle.body) as { events: { vertical: string }[]; mode: string };
    check("roofing-only asking for mode=combined gets no Solar", !cs.events.some((e) => e.vertical === "solar"), `mode=${cs.mode}`);
  }

  // ---- 6. Files: company / workspace / private ------------------------------
  console.log("\n6. File scopes by direct object ID");
  {
    // `scope: company` means NOT WORKSPACE-RESTRICTED. It does not mean
    // world-readable — RBAC still decides who may read it, which is why a GL
    // receipt or a payroll stub stays accounting-only. So the meaningful test is
    // that BOTH workspace admins reach it identically.
    const a1 = await get(withWorkspace(roof, "roofing"), `/portal/files/${FILE_COMPANY}`);
    const a2 = await get(withWorkspace(solar, "solar"), `/portal/files/${FILE_COMPANY}`);
    check("company file is not workspace-restricted (same result in both)", a1.status === a2.status && a1.status !== 403, `roofing=${a1.status} solar=${a2.status}`);
    const a3 = await get(rep, `/portal/files/${FILE_COMPANY}`);
    check("company file still obeys RBAC (non-admin staff blocked)", a3.status === 403, `status=${a3.status}`);
    const b = await get(withWorkspace(roof, "roofing"), `/portal/files/${FILE_SOLAR_WS}`);
    check("roofing user CANNOT fetch a parentless Solar workspace file", b.status === 404 || b.status === 403, `status=${b.status}`);
    const c = await get(roof, `/portal/files/${FILE_PRIVATE}`);
    check("private file: owner is not forbidden", c.status !== 403, `status=${c.status}`);
    const d = await get(rep, `/portal/files/${FILE_PRIVATE}`);
    check("private file: non-owner non-admin IS forbidden", d.status === 403, `status=${d.status}`);
    const d2 = await get(solar, `/portal/files/${FILE_PRIVATE}`);
    check("private file: an ADMIN may read it (deliberate)", d2.status !== 403, `status=${d2.status}`);
    const e = await get(withWorkspace(roof, "roofing"), `/portal/files/${FILE_SOLAR_DEAL}`);
    check("roofing user CANNOT fetch a Solar deal's file", e.status === 404 || e.status === 403, `status=${e.status}`);
  }

  // ---- 6b. RBAC and workspace isolation COMPOSE ---------------------------
  console.log("\n6b. RBAC + workspace compose (non-admin, single workspace)");
  {
    const a = await get(rep, `/portal/leads/${SOLAR_LEAD}`);
    check("roofing rep cannot open a Solar deal", a.status !== 200 || !a.body.includes("solarLEAD"), `status=${a.status}`);
    const b = await get(rep, "/api/search?q=ISO");
    check("roofing rep search leaks no Solar deal", !b.body.includes("solarLEAD"), "solar leaked");
    const c = await get(rep, "/portal/knowledge");
    check("roofing rep sees no Solar KB", !c.body.includes("ISO solar"), "solar KB leaked");
  }

  // ---- 7. Notifications: permission-scoped ---------------------------------
  console.log("\n7. Notifications");
  {
    const r = await get(roof, "/api/notifications/summary");
    const rj = JSON.parse(r.body) as { items: { vertical: string | null }[]; showWorkspace: boolean };
    check("roofing-only sees no Solar notifications", !rj.items.some((i) => i.vertical === "solar"), "solar notification leaked");
    check("roofing-only gets NO workspace chrome", rj.showWorkspace === false, `showWorkspace=${rj.showWorkspace}`);
    const d = await get(dual, "/api/notifications/summary");
    const dj = JSON.parse(d.body) as { showWorkspace: boolean };
    check("dual user DOES get workspace chrome", dj.showWorkspace === true, `showWorkspace=${dj.showWorkspace}`);
  }

  // ---- 8. Reports: the A/R aging ledger leak -------------------------------
  console.log("\n8. Reports (TAGGED ledger models)");
  {
    const r = await get(withWorkspace(acctRoof, "roofing"), "/portal/reports/ar-aging");
    const s2 = await get(withWorkspace(acctSolar, "solar"), "/portal/reports/ar-aging");
    check("A/R aging renders for both workspaces", r.status === 200 && s2.status === 200, `roofing=${r.status} solar=${s2.status}`);
    check("A/R aging shows no Solar customer to a Roofing admin", !r.body.includes("solarLEAD"), "solar customer leaked");
    check("A/R aging shows no Roofing customer to a Solar admin", !s2.body.includes("roofingLEAD"), "roofing customer leaked");
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  if (failures.length) {
    console.log("\nFAILURES:");
    for (const f of failures) console.log(" - " + f);
  }
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("PROBE ERROR", e);
  process.exit(2);
});
