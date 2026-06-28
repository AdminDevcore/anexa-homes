import type { Prisma, Role } from "@prisma/client";
import { prisma } from "@/server/db/client";
import { canManageAllCanvassing } from "./policies";
import { skipTraceEnabled } from "@/server/modules/skiptrace/provider";

export type KnockDTO = {
  id: string;
  lat: number;
  lng: number;
  address: string | null;
  disposition: string;
  notes: string | null;
  contactName: string | null; // homeowner name (door capture or skip-trace)
  repId: string | null;
  repName: string | null;
  territoryId: string | null;
  leadId: string | null;
  propertyValue: number | null; // cents
  propertyValueSource: string | null;
  knockedAt: string;
};

export type DealDTO = {
  id: string;
  lat: number;
  lng: number;
  name: string;
  address: string | null;
  phone: string | null;
  stageName: string | null;
  stageColor: string | null;
  status: string;
  repName: string | null;
  value: number | null; // cents (estimated job value)
  appointmentAt: string | null;
  note: string | null;
};

export type TerritoryDTO = {
  id: string;
  name: string;
  color: string;
  polygon: [number, number][];
  assignedRepId: string | null;
  assignedRepName: string | null;
  repIds: string[]; // all reps assigned (multi-rep), primary first
  repNames: string[];
  total: number; // total pins/houses
  knocked: number; // pins with a real disposition
};

export type RepDTO = { id: string; name: string };

export type CanvassingMeta = {
  me: { id: string; canManageAll: boolean };
  territories: TerritoryDTO[];
  reps: RepDTO[];
  stats: { today: number; knocked: number; houses: number; byDisposition: Record<string, number> };
  // Whether a skip-trace provider (BatchData etc.) is configured → show "Look up owner".
  ownerLookupEnabled: boolean;
};

function name(u: { firstName: string; lastName: string } | null): string | null {
  return u ? `${u.firstName} ${u.lastName}`.trim() : null;
}

/** What knocks a user may see: managers see all; reps see their own knocks
 *  plus blank pins in territories assigned to them. */
export function knockScope(companyId: string, userId: string, role: Role): Prisma.KnockWhereInput {
  // Admins see the whole company.
  if (role === "super_admin" || role === "admin") return { companyId };
  // A sales manager sees their team's knocks only: their reps + the canvassers
  // under those reps (and any territories assigned to the manager).
  if (role === "manager") {
    return {
      companyId,
      OR: [
        { repId: userId },
        { rep: { managerId: userId } },
        { rep: { salesRep: { managerId: userId } } },
        { disposition: "not_knocked", territory: { OR: [{ assignedRepId: userId }, { reps: { some: { userId } } }] } },
      ],
    };
  }
  return {
    companyId,
    OR: [
      { repId: userId },
      // A sales rep also sees every knock logged by canvassers assigned to them.
      { rep: { salesRepId: userId } },
      // Blank pins in any territory this rep is assigned to (primary or multi-rep).
      { disposition: "not_knocked", territory: { OR: [{ assignedRepId: userId }, { reps: { some: { userId } } }] } },
    ],
  };
}

export async function getCanvassingMeta(companyId: string, userId: string, role: Role): Promise<CanvassingMeta> {
  const canManageAll = canManageAllCanvassing(role);
  const scope = knockScope(companyId, userId, role);

  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);

  const [territoryRows, totalByTerr, knockedByTerr, dispGroups, todayKnocked, reps] = await Promise.all([
    prisma.territory.findMany({
      where: { companyId },
      orderBy: { createdAt: "asc" },
      select: {
        id: true, name: true, color: true, polygon: true, assignedRepId: true,
        assignedRep: { select: { firstName: true, lastName: true } },
        reps: { select: { userId: true } },
      },
    }),
    prisma.knock.groupBy({ by: ["territoryId"], where: { companyId, territoryId: { not: null } }, _count: true }),
    prisma.knock.groupBy({
      by: ["territoryId"],
      where: { companyId, territoryId: { not: null }, disposition: { not: "not_knocked" } },
      _count: true,
    }),
    prisma.knock.groupBy({ by: ["disposition"], where: scope, _count: true }),
    prisma.knock.count({ where: { ...scope, disposition: { not: "not_knocked" }, knockedAt: { gte: startOfToday } } }),
    role === "super_admin" || role === "admin"
      ? prisma.user.findMany({
          where: { companyId, status: "active", role: { in: ["sales_rep", "manager"] } },
          select: { id: true, firstName: true, lastName: true },
          orderBy: [{ firstName: "asc" }],
        })
      : role === "manager"
        ? // A manager filters only by their own reps + canvassers under them.
          prisma.user.findMany({
            where: { companyId, status: "active", OR: [{ managerId: userId }, { salesRep: { managerId: userId } }] },
            select: { id: true, firstName: true, lastName: true },
            orderBy: [{ firstName: "asc" }],
          })
        : Promise.resolve([]),
  ]);

  const totalMap = new Map(totalByTerr.map((g) => [g.territoryId, g._count]));
  const knockedMap = new Map(knockedByTerr.map((g) => [g.territoryId, g._count]));

  // Resolve names for every assigned rep referenced by any territory.
  const repUserIds = [
    ...new Set(territoryRows.flatMap((t) => [t.assignedRepId, ...t.reps.map((r) => r.userId)]).filter((x): x is string => !!x)),
  ];
  const repUsers = repUserIds.length
    ? await prisma.user.findMany({ where: { id: { in: repUserIds } }, select: { id: true, firstName: true, lastName: true } })
    : [];
  const repNameById = new Map(repUsers.map((u) => [u.id, `${u.firstName} ${u.lastName}`.trim()]));

  const territories: TerritoryDTO[] = territoryRows.map((t) => {
    const ids = [...new Set([t.assignedRepId, ...t.reps.map((r) => r.userId)].filter((x): x is string => !!x))];
    return {
      id: t.id,
      name: t.name,
      color: t.color,
      polygon: (t.polygon as [number, number][]) ?? [],
      assignedRepId: t.assignedRepId,
      assignedRepName: name(t.assignedRep),
      repIds: ids,
      repNames: ids.map((id) => repNameById.get(id) ?? "—"),
      total: totalMap.get(t.id) ?? 0,
      knocked: knockedMap.get(t.id) ?? 0,
    };
  });

  const byDisposition: Record<string, number> = {};
  let houses = 0;
  let knocked = 0;
  for (const g of dispGroups) {
    byDisposition[g.disposition] = g._count;
    houses += g._count;
    if (g.disposition !== "not_knocked") knocked += g._count;
  }

  return {
    me: { id: userId, canManageAll },
    territories,
    reps: reps.map((r) => ({ id: r.id, name: `${r.firstName} ${r.lastName}` })),
    stats: { today: todayKnocked, knocked, houses, byDisposition },
    ownerLookupEnabled: skipTraceEnabled(),
  };
}

export type Bounds = { minLat: number; minLng: number; maxLat: number; maxLng: number };

/** Knocks within the current viewport (lazy-loaded). Capped for performance. */
export async function getKnocksInBounds(
  companyId: string,
  userId: string,
  role: Role,
  bounds: Bounds,
  opts: { repId?: string; statuses?: string[] } = {},
  cap = 1500
): Promise<KnockDTO[]> {
  const canManageAll = canManageAllCanvassing(role);
  const scope = knockScope(companyId, userId, role);

  const where: Prisma.KnockWhereInput = {
    AND: [
      scope,
      { lat: { gte: bounds.minLat, lte: bounds.maxLat }, lng: { gte: bounds.minLng, lte: bounds.maxLng } },
      ...(opts.repId ? [{ repId: opts.repId }] : []),
      ...(opts.statuses && opts.statuses.length ? [{ disposition: { in: opts.statuses as never } }] : []),
    ],
  };

  const rows = await prisma.knock.findMany({
    where,
    orderBy: { knockedAt: "desc" },
    take: cap,
    select: {
      id: true, lat: true, lng: true, address: true, disposition: true, notes: true,
      contactName: true,
      repId: true, territoryId: true, leadId: true, knockedAt: true,
      propertyValue: true, propertyValueSource: true,
      rep: { select: { firstName: true, lastName: true } },
    },
  });

  return rows.map((k) => ({
    id: k.id,
    lat: k.lat,
    lng: k.lng,
    address: k.address,
    disposition: k.disposition,
    notes: k.notes,
    contactName: k.contactName,
    repId: k.repId,
    repName: name(k.rep),
    territoryId: k.territoryId,
    leadId: k.leadId,
    propertyValue: k.propertyValue,
    propertyValueSource: k.propertyValueSource,
    knockedAt: k.knockedAt.toISOString(),
  }));
}

/** Pipeline deals (geocoded leads) within the viewport — plotted on the
 *  canvassing map so reps see the whole pipeline geographically. Company-wide
 *  by design: the map is the shared geographic source of truth, so every door
 *  knocker can see which homes are already deals/appointments. Capped. */
export async function getDealsInBounds(
  companyId: string,
  bounds: Bounds,
  cap = 500
): Promise<DealDTO[]> {
  const rows = await prisma.lead.findMany({
    where: {
      companyId,
      lat: { not: null, gte: bounds.minLat, lte: bounds.maxLat },
      lng: { not: null, gte: bounds.minLng, lte: bounds.maxLng },
    },
    orderBy: { updatedAt: "desc" },
    take: cap,
    select: {
      id: true, firstName: true, lastName: true, lat: true, lng: true,
      address: true, phone: true, status: true, value: true,
      appointmentAt: true, notes: true,
      stage: { select: { name: true, color: true } },
      assignedRep: { select: { firstName: true, lastName: true } },
    },
  });

  return rows.map((l) => ({
    id: l.id,
    lat: l.lat as number,
    lng: l.lng as number,
    name: `${l.firstName} ${l.lastName}`.trim(),
    address: l.address,
    phone: l.phone,
    stageName: l.stage?.name ?? null,
    stageColor: l.stage?.color ?? null,
    status: l.status,
    repName: name(l.assignedRep),
    value: l.value,
    appointmentAt: l.appointmentAt ? l.appointmentAt.toISOString() : null,
    note: l.notes,
  }));
}

// ----------------------------- Leaderboard ---------------------------------

export type LeaderboardPeriod = "today" | "week" | "month" | "all";

export type LeaderboardRow = {
  repId: string;
  repName: string;
  knocks: number;
  appointments: number;
  sold: number;
  conversions: number;
  convRate: number;
};

function periodStart(period: LeaderboardPeriod): Date | null {
  if (period === "all") return null;
  const d = new Date();
  if (period === "today") {
    d.setHours(0, 0, 0, 0);
    return d;
  }
  d.setDate(d.getDate() - (period === "week" ? 7 : 30));
  return d;
}

export async function getLeaderboard(
  user: { companyId: string; userId: string; role: Role },
  period: LeaderboardPeriod
): Promise<LeaderboardRow[]> {
  const since = periodStart(period);
  const rows = await prisma.knock.findMany({
    // Role-scoped: admins see the whole company, a manager sees their team, and
    // a rep sees only their own (and their canvassers') knocks — reps can't view
    // each other's numbers. Only real knocks by a rep count toward the board.
    where: {
      AND: [
        knockScope(user.companyId, user.userId, user.role),
        { disposition: { not: "not_knocked" }, repId: { not: null }, ...(since ? { knockedAt: { gte: since } } : {}) },
      ],
    },
    select: { repId: true, disposition: true, leadId: true, rep: { select: { firstName: true, lastName: true } } },
  });

  const map = new Map<string, LeaderboardRow>();
  for (const k of rows) {
    if (!k.repId) continue;
    let r = map.get(k.repId);
    if (!r) {
      r = { repId: k.repId, repName: name(k.rep) ?? "—", knocks: 0, appointments: 0, sold: 0, conversions: 0, convRate: 0 };
      map.set(k.repId, r);
    }
    r.knocks += 1;
    if (k.disposition === "appointment") r.appointments += 1;
    if (k.disposition === "sold") r.sold += 1;
    if (k.leadId) r.conversions += 1;
  }

  return [...map.values()]
    .map((r) => ({ ...r, convRate: r.knocks ? Math.round((r.conversions / r.knocks) * 100) : 0 }))
    .sort((a, b) => b.knocks - a.knocks || b.sold - a.sold || b.appointments - a.appointments);
}

// ----------------------------- List + Dashboard -----------------------------

export type DateRange = { from?: Date; to?: Date };

function rangeWhere(r: DateRange): Prisma.KnockWhereInput {
  if (!r.from && !r.to) return {};
  return { knockedAt: { ...(r.from ? { gte: r.from } : {}), ...(r.to ? { lte: r.to } : {}) } };
}

export type KnockListRow = {
  id: string;
  address: string | null;
  status: string;
  repName: string | null;
  territoryName: string | null;
  knockedAt: string;
  notesPreview: string | null;
};

/** Flat, filterable list of real knocks for the List tab + CSV export. */
export async function getKnockList(
  companyId: string,
  userId: string,
  role: Role,
  opts: { repId?: string; statuses?: string[]; range?: DateRange; q?: string } = {},
  cap = 1000
): Promise<KnockListRow[]> {
  const scope = knockScope(companyId, userId, role);
  const where: Prisma.KnockWhereInput = {
    AND: [
      scope,
      { disposition: { not: "not_knocked" } },
      ...(opts.repId ? [{ repId: opts.repId }] : []),
      ...(opts.statuses && opts.statuses.length ? [{ disposition: { in: opts.statuses as never } }] : []),
      ...(opts.range ? [rangeWhere(opts.range)] : []),
      ...(opts.q
        ? [{ OR: [{ address: { contains: opts.q, mode: "insensitive" as const } }, { notes: { contains: opts.q, mode: "insensitive" as const } }] }]
        : []),
    ],
  };
  const rows = await prisma.knock.findMany({
    where,
    orderBy: { knockedAt: "desc" },
    take: cap,
    select: {
      id: true, address: true, disposition: true, notes: true, knockedAt: true,
      rep: { select: { firstName: true, lastName: true } },
      territory: { select: { name: true } },
    },
  });
  return rows.map((k) => ({
    id: k.id,
    address: k.address,
    status: k.disposition,
    repName: name(k.rep),
    territoryName: k.territory?.name ?? null,
    knockedAt: k.knockedAt.toISOString(),
    notesPreview: k.notes ? (k.notes.length > 80 ? k.notes.slice(0, 79) + "…" : k.notes) : null,
  }));
}

export type RepDashboard = {
  knocked: number;
  appointments: number;
  sold: number;
  conversions: number;
  convRate: number;
  remaining: number;
  byStatus: Record<string, number>;
  overTime: { date: string; count: number }[];
  ranking: LeaderboardRow[];
};

/** Per-rep (or company-wide) activity metrics for the Dashboard tab, date-filtered. */
export async function getRepDashboard(
  companyId: string,
  userId: string,
  role: Role,
  opts: { repId?: string; range?: DateRange } = {}
): Promise<RepDashboard> {
  const canManageAll = canManageAllCanvassing(role);
  // Reps are always scoped to themselves; managers may pick a rep or see all.
  const effectiveRep = canManageAll ? opts.repId : userId;
  const range = opts.range ?? {};

  const rows = await prisma.knock.findMany({
    where: {
      companyId,
      disposition: { not: "not_knocked" },
      ...(effectiveRep ? { repId: effectiveRep } : {}),
      ...rangeWhere(range),
    },
    select: { disposition: true, leadId: true, knockedAt: true, repId: true, rep: { select: { firstName: true, lastName: true } } },
  });

  const byStatus: Record<string, number> = {};
  let appointments = 0, sold = 0, conversions = 0;
  const dayMap = new Map<string, number>();
  const rankMap = new Map<string, LeaderboardRow>();
  for (const k of rows) {
    byStatus[k.disposition] = (byStatus[k.disposition] ?? 0) + 1;
    if (k.disposition === "appointment") appointments += 1;
    if (k.disposition === "sold") sold += 1;
    if (k.leadId) conversions += 1;
    const day = k.knockedAt.toISOString().slice(0, 10);
    dayMap.set(day, (dayMap.get(day) ?? 0) + 1);
    if (k.repId) {
      let r = rankMap.get(k.repId);
      if (!r) {
        r = { repId: k.repId, repName: name(k.rep) ?? "—", knocks: 0, appointments: 0, sold: 0, conversions: 0, convRate: 0 };
        rankMap.set(k.repId, r);
      }
      r.knocks += 1;
      if (k.disposition === "appointment") r.appointments += 1;
      if (k.disposition === "sold") r.sold += 1;
      if (k.leadId) r.conversions += 1;
    }
  }
  const knocked = rows.length;

  // Houses remaining = unknocked pins in the rep's territories (or company-wide).
  let remaining: number;
  if (effectiveRep) {
    const terrs = await prisma.territory.findMany({
      where: { companyId, OR: [{ assignedRepId: effectiveRep }, { reps: { some: { userId: effectiveRep } } }] },
      select: { id: true },
    });
    remaining = terrs.length
      ? await prisma.knock.count({ where: { companyId, disposition: "not_knocked", territoryId: { in: terrs.map((t) => t.id) } } })
      : 0;
  } else {
    remaining = await prisma.knock.count({ where: { companyId, disposition: "not_knocked" } });
  }

  return {
    knocked,
    appointments,
    sold,
    conversions,
    convRate: knocked ? Math.round((conversions / knocked) * 100) : 0,
    remaining,
    byStatus,
    overTime: [...dayMap.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([date, count]) => ({ date, count })),
    ranking: [...rankMap.values()]
      .map((r) => ({ ...r, convRate: r.knocks ? Math.round((r.conversions / r.knocks) * 100) : 0 }))
      .sort((a, b) => b.knocks - a.knocks || b.sold - a.sold),
  };
}

// ----------------------------- Pin detail -----------------------------------

export type KnockEventDTO = {
  id: string;
  type: string;
  body: string | null;
  disposition: string | null;
  authorName: string | null;
  createdAt: string;
};

export type KnockDetailDTO = {
  id: string;
  lat: number;
  lng: number;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  disposition: string;
  notes: string | null;
  contactName: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
  bestTime: string | null;
  repId: string | null;
  repName: string | null;
  territoryId: string | null;
  territoryName: string | null;
  leadId: string | null;
  propertyValue: number | null; // cents
  propertyValueSource: string | null;
  propertyValueAt: string | null;
  // Cached homeowner skip-trace result (BatchData etc.) — alternates the rep can pick from.
  owner: { names: string[]; phones: string[]; emails: string[]; source: string } | null;
  ownerLookedUpAt: string | null;
  appointmentAt: string | null;
  knockedAt: string;
  events: KnockEventDTO[];
};

/** Safe-parse the cached skip-trace JSON into the names/phones/emails the UI shows. */
function ownerFromJson(json: unknown, source: string | null): KnockDetailDTO["owner"] {
  if (!json || typeof json !== "object") return null;
  const o = json as Record<string, unknown>;
  const arr = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
  const names = arr(o.names);
  const phones = arr(o.phones);
  const emails = arr(o.emails);
  if (!names.length && !phones.length && !emails.length) return null;
  return { names, phones, emails, source: (typeof o.source === "string" && o.source) || source || "Lookup" };
}

/** Full detail for one house pin: contact, notes, and the visit-history timeline. */
export async function getKnockDetail(
  companyId: string,
  userId: string,
  role: Role,
  id: string
): Promise<KnockDetailDTO | null> {
  const canManageAll = canManageAllCanvassing(role);
  const k = await prisma.knock.findFirst({
    where: { id, companyId },
    include: {
      rep: { select: { firstName: true, lastName: true } },
      territory: { select: { name: true, assignedRepId: true } },
      events: { orderBy: { createdAt: "desc" }, take: 200 },
    },
  });
  if (!k) return null;
  // Reps may view their own knocks + unclaimed pins in their assigned territory.
  if (!canManageAll && k.repId && k.repId !== userId && k.territory?.assignedRepId !== userId) return null;

  return {
    id: k.id,
    lat: k.lat,
    lng: k.lng,
    address: k.address,
    city: k.city,
    state: k.state,
    zip: k.zip,
    disposition: k.disposition,
    notes: k.notes,
    contactName: k.contactName,
    contactPhone: k.contactPhone,
    contactEmail: k.contactEmail,
    bestTime: k.bestTime,
    repId: k.repId,
    repName: name(k.rep),
    territoryId: k.territoryId,
    territoryName: k.territory?.name ?? null,
    leadId: k.leadId,
    propertyValue: k.propertyValue,
    propertyValueSource: k.propertyValueSource,
    propertyValueAt: k.propertyValueAt ? k.propertyValueAt.toISOString().slice(0, 10) : null,
    owner: ownerFromJson(k.ownerData, k.ownerSource),
    ownerLookedUpAt: k.ownerLookedUpAt ? k.ownerLookedUpAt.toISOString().slice(0, 10) : null,
    appointmentAt: k.appointmentAt ? k.appointmentAt.toISOString() : null,
    knockedAt: k.knockedAt.toISOString(),
    events: k.events.map((e) => ({
      id: e.id,
      type: e.type,
      body: e.body,
      disposition: e.disposition,
      authorName: e.authorName,
      createdAt: e.createdAt.toISOString(),
    })),
  };
}

// ----------------------------- Appointments / Calendar ----------------------

export type AppointmentDTO = {
  id: string; // knock id (the appointment lives on the house dot)
  leadId: string | null;
  address: string | null;
  homeowner: string | null;
  repId: string | null;
  repName: string | null;
  status: string;
  appointmentAt: string; // ISO
  territoryId: string | null;
  lat: number;
  lng: number;
};

/** Scheduled appointments for the calendar. Reps see their own; managers see all
 *  (optionally filtered to one rep). Reads the appointment stored on the house dot. */
export async function getAppointments(
  companyId: string,
  userId: string,
  role: Role,
  opts: { from?: Date; to?: Date; repId?: string } = {}
): Promise<AppointmentDTO[]> {
  const canManageAll = canManageAllCanvassing(role);
  const at: Prisma.DateTimeNullableFilter = { not: null };
  if (opts.from) at.gte = opts.from;
  if (opts.to) at.lte = opts.to;

  const rows = await prisma.knock.findMany({
    where: {
      companyId,
      appointmentAt: at,
      ...(canManageAll ? (opts.repId ? { repId: opts.repId } : {}) : { repId: userId }),
    },
    orderBy: { appointmentAt: "asc" },
    select: {
      id: true, leadId: true, address: true, contactName: true, repId: true,
      disposition: true, appointmentAt: true, territoryId: true, lat: true, lng: true,
      rep: { select: { firstName: true, lastName: true } },
    },
  });

  return rows.map((k) => ({
    id: k.id,
    leadId: k.leadId,
    address: k.address,
    homeowner: k.contactName,
    repId: k.repId,
    repName: k.rep ? `${k.rep.firstName} ${k.rep.lastName}`.trim() : null,
    status: k.disposition,
    appointmentAt: (k.appointmentAt as Date).toISOString(),
    territoryId: k.territoryId,
    lat: k.lat,
    lng: k.lng,
  }));
}

// ----------------------------- Map stats (date-filtered) --------------------

export type CanvassingStats = { knocked: number; houses: number; byDisposition: Record<string, number> };

/** Knock stats scoped to a date range (drives the Map tab's counters/chips). */
export async function getCanvassingStats(
  companyId: string,
  userId: string,
  role: Role,
  opts: { from?: Date; to?: Date; repId?: string } = {}
): Promise<CanvassingStats> {
  const scope = knockScope(companyId, userId, role);
  const range: Prisma.KnockWhereInput =
    opts.from || opts.to ? { knockedAt: { ...(opts.from ? { gte: opts.from } : {}), ...(opts.to ? { lte: opts.to } : {}) } } : {};
  const where: Prisma.KnockWhereInput = { AND: [scope, range, ...(opts.repId ? [{ repId: opts.repId }] : [])] };

  const groups = await prisma.knock.groupBy({ by: ["disposition"], where, _count: true });
  const byDisposition: Record<string, number> = {};
  let houses = 0;
  let knocked = 0;
  for (const g of groups) {
    byDisposition[g.disposition] = g._count;
    houses += g._count;
    if (g.disposition !== "not_knocked") knocked += g._count;
  }
  return { knocked, houses, byDisposition };
}
