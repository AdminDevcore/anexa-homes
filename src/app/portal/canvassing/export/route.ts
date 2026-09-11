import { NextResponse } from "next/server";
import { requireUser } from "@/server/auth/session";
import { can } from "@/server/rbac/guards";
import { dispositionMeta } from "@/lib/canvassing";
import { getKnockList } from "@/server/modules/canvassing/queries";

/**
 * The knock list as a CSV.
 *
 * This used to be assembled in the browser out of rows the List tab had
 * already fetched (`canvassing-list.tsx`), which meant the download existed
 * outside the permission model entirely: nothing to check, nothing to log,
 * nothing to revoke. The rows themselves were row-scoped, so it leaked no more
 * than the table above it — but "no worse than the screen" is not the standard
 * for a file that leaves the building with every door a rep worked and the
 * notes they wrote at each one.
 *
 * Server-side now, and gated on `export Canvassing` — leadership only. The
 * rows stay scoped by `knockScope` inside getKnockList, so a manager's CSV is
 * their team's doors and nobody else's.
 */
function cell(v: string | number): string {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function parseDate(s: string | null): Date | undefined {
  if (!s) return undefined;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

export async function GET(req: Request) {
  const user = await requireUser();
  if (!can(user, "export", "Canvassing")) return new NextResponse("Forbidden", { status: 403 });

  const sp = new URL(req.url).searchParams;
  const statuses = sp.get("status")?.split(",").filter(Boolean);
  const rows = await getKnockList(user.companyId, user.userId, user.role, {
    repId: sp.get("rep") || undefined,
    statuses: statuses?.length ? statuses : undefined,
    q: sp.get("q") || undefined,
    range: { from: parseDate(sp.get("from")), to: parseDate(sp.get("to")) },
  });

  const header = ["Address", "Status", "Rep", "Territory", "Date/Time", "Notes"];
  const lines = [
    header,
    ...rows.map((r) => [
      r.address ?? "",
      dispositionMeta(r.status).label,
      r.repName ?? "",
      r.territoryName ?? "",
      new Date(r.knockedAt).toLocaleString(),
      r.notesPreview ?? "",
    ]),
  ];

  const csv = lines.map((row) => row.map(cell).join(",")).join("\n");
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="canvassing-knocks-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  });
}
