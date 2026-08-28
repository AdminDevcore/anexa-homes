import { Prisma } from "@prisma/client";
import type { ActiveVertical } from "@/lib/vertical";
import { classify } from "./models";
import {
  CrossVerticalAccessError,
  MissingVerticalContextError,
  resolveVertical,
  runUnscoped,
} from "./context";
import { solarVerticalEnabled } from "./flag";

/**
 * The vertical-isolation Prisma client extension.
 *
 * It wraps the model API, so every one of the ~900 `prisma.<model>.<op>()` call
 * sites in the codebase is scoped without being edited, and a query written
 * tomorrow is scoped the moment it is written. There is no "remember to add the
 * filter" step to forget.
 *
 * It does NOT see $queryRaw/$executeRaw. That gap is closed by an eslint rule
 * plus src/lib/__tests__/no-raw-sql.test.ts.
 */

type Json = Record<string, unknown>;

/** Operations that accept a `where`. */
const WHERE_OPS = new Set([
  "findUnique",
  "findUniqueOrThrow",
  "findFirst",
  "findFirstOrThrow",
  "findMany",
  "count",
  "aggregate",
  "groupBy",
  "update",
  "updateMany",
  "updateManyAndReturn",
  "delete",
  "deleteMany",
  "upsert",
]);

/** Operations that accept a `data` payload. */
const DATA_OPS = new Set([
  "create",
  "createMany",
  "createManyAndReturn",
  "update",
  "updateMany",
  "updateManyAndReturn",
]);

/**
 * model -> (relation field name -> related model name), built once from the
 * generated DMMF. Used to walk nested writes so a child row created through its
 * parent (`lead.create({ data: { project: { create: {...} } } })`) is stamped
 * with the same vertical as the parent.
 */
const RELATIONS: Map<string, Map<string, string>> = (() => {
  const map = new Map<string, Map<string, string>>();
  for (const model of Prisma.dmmf.datamodel.models) {
    const fields = new Map<string, string>();
    for (const field of model.fields) {
      if (field.kind === "object") fields.set(field.name, field.type);
    }
    map.set(model.name, fields);
  }
  return map;
})();

function isPlainObject(v: unknown): v is Json {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Stamp `vertical` onto a create/update payload and everything it creates
 * beneath it. Returns a copy; never mutates the caller's object.
 */
function stampData(model: string, data: unknown, vertical: ActiveVertical): unknown {
  if (Array.isArray(data)) return data.map((d) => stampData(model, d, vertical));
  if (!isPlainObject(data)) return data;

  const out: Json = { ...data };
  const cls = classify(model);

  if (cls === "scoped") {
    const explicit = out.vertical;
    if (explicit != null && explicit !== vertical) {
      throw new CrossVerticalAccessError(
        `Refusing to write ${model} into vertical "${String(explicit)}" while acting in "${vertical}".`
      );
    }
    out.vertical = vertical;
  } else if (cls === "scopedOptional") {
    // An EXPLICIT null is a deliberate company-scoped row (a Company task) and
    // must survive. That is why this tests key presence rather than nullishness:
    // `{ vertical: null }` means "company", while an absent key means "wherever
    // I am standing". Writing into someone else's workspace is still refused.
    if ("vertical" in out) {
      const explicit = out.vertical;
      if (explicit != null && explicit !== vertical) {
        throw new CrossVerticalAccessError(
          `Refusing to write ${model} into vertical "${String(explicit)}" while acting in "${vertical}".`
        );
      }
    } else {
      out.vertical = vertical;
    }
  } else if (cls === "tagged") {
    // A tagged row's department is a property of the record it belongs to, not
    // of whichever workspace the user happens to have open — otherwise a
    // mis-set toggle silently corrupts the departmental P&L. An explicit value
    // therefore WINS rather than being rejected, and callers that reach here
    // (nested writes under a scoped parent) are inheriting the parent's
    // vertical, which IS the provenance. Top-level tagged writes get their
    // provenance resolved from the linked job in resolveTaggedProvenance().
    if (out.vertical == null) out.vertical = vertical;
  }

  const relations = RELATIONS.get(model);
  if (!relations) return out;

  for (const [field, target] of relations) {
    const node = out[field];
    if (!isPlainObject(node)) continue;
    // Only nested-write shapes matter. connect/disconnect/set reference rows by
    // id and are covered by the fact that reading an out-of-vertical id is
    // already blocked.
    const next: Json = { ...node };
    let touched = false;

    if (next.create !== undefined) {
      next.create = stampData(target, next.create, vertical);
      touched = true;
    }
    if (isPlainObject(next.createMany) && next.createMany.data !== undefined) {
      next.createMany = {
        ...next.createMany,
        data: stampData(target, next.createMany.data, vertical),
      };
      touched = true;
    }
    if (next.connectOrCreate !== undefined) {
      const stampOne = (n: unknown) =>
        isPlainObject(n) && n.create !== undefined
          ? { ...n, create: stampData(target, n.create, vertical) }
          : n;
      next.connectOrCreate = Array.isArray(next.connectOrCreate)
        ? next.connectOrCreate.map(stampOne)
        : stampOne(next.connectOrCreate);
      touched = true;
    }
    if (next.upsert !== undefined) {
      const stampOne = (n: unknown) =>
        isPlainObject(n) && n.create !== undefined
          ? { ...n, create: stampData(target, n.create, vertical) }
          : n;
      next.upsert = Array.isArray(next.upsert) ? next.upsert.map(stampOne) : stampOne(next.upsert);
      touched = true;
    }

    if (touched) out[field] = next;
  }

  return out;
}

/**
 * Which foreign key carries a tagged row's department. Every tagged model hangs
 * off a job, so the job's vertical is the row's vertical — full stop.
 *
 * ContractorPay's `projectId` is the one that can legitimately be NULL: an
 * invoice can be dropped on a deal that never became a job. Provenance then
 * falls through to the ambient workspace, which is the same treatment
 * hand-booked office rent already gets.
 */
const TAGGED_PROVENANCE: Record<string, string> = {
  Transaction: "projectId",
  Commission: "projectId",
  ContractorPay: "projectId",
  Invoice: "projectId",
  ProjectCost: "projectId",
};

type ProjectLookup = (id: string) => Promise<ActiveVertical | null>;

/**
 * Resolve a tagged row's department from the job it belongs to.
 *
 * Precedence:
 *   1. an explicit `vertical` in the payload  (seeds, backfills, imports)
 *   2. the linked job's vertical              ← the authoritative source
 *   3. the ambient active vertical            (only when there is no link,
 *                                              e.g. office rent booked by hand)
 *
 * Without step 2, a bookkeeper with the wrong workspace toggled would file a
 * solar job's cost against roofing and the departmental P&L would be wrong
 * while still reconciling — the worst kind of wrong, because it looks right.
 */
async function resolveTaggedProvenance(
  model: string,
  data: unknown,
  ambient: ActiveVertical,
  lookup: ProjectLookup
): Promise<unknown> {
  if (Array.isArray(data)) {
    return Promise.all(data.map((d) => resolveTaggedProvenance(model, d, ambient, lookup)));
  }
  if (!isPlainObject(data)) return data;

  const out: Json = { ...data };
  if (out.vertical != null) return out; // explicit wins

  const fk = TAGGED_PROVENANCE[model];
  const linkedId = fk ? out[fk] : undefined;
  if (typeof linkedId === "string") {
    const derived = await lookup(linkedId);
    if (derived) {
      out.vertical = derived;
      return out;
    }
  }

  out.vertical = ambient;
  return out;
}

/** Add `vertical` to a where clause, rejecting an explicit disagreement. */
function stampWhere(model: string, where: unknown, vertical: ActiveVertical): Json {
  const base = isPlainObject(where) ? where : {};
  const explicit = base.vertical;
  if (explicit != null && typeof explicit === "string" && explicit !== vertical) {
    throw new CrossVerticalAccessError(
      `Refusing to read ${model} from vertical "${explicit}" while acting in "${vertical}".`
    );
  }
  return { ...base, vertical };
}

/**
 * The SCOPED_OPTIONAL read filter: this workspace's rows PLUS the company-level
 * ones (vertical NULL).
 *
 * Wrapped in `AND` rather than spread in as a sibling `OR` on purpose — a caller
 * that already passes its own `OR` (the Tasks page does, for "assigned to me or
 * created by me") would otherwise have it silently overwritten, widening the
 * query instead of narrowing it. `AND` composes with whatever is already there.
 *
 * An explicit `vertical` in the caller's where still wins, so a screen can ask
 * for only-company (`null`) or only-this-workspace rows deliberately.
 */
function stampWhereOptional(model: string, where: unknown, vertical: ActiveVertical): Json {
  const base = isPlainObject(where) ? where : {};
  if ("vertical" in base) {
    const explicit = base.vertical;
    if (explicit != null && typeof explicit === "string" && explicit !== vertical) {
      throw new CrossVerticalAccessError(
        `Refusing to read ${model} from vertical "${explicit}" while acting in "${vertical}".`
      );
    }
    return { ...base };
  }
  return {
    AND: [base, { OR: [{ vertical }, { vertical: null }] }],
  };
}

/** Ops that bring a row into existence, where provenance must be resolved. */
const CREATE_OPS = new Set(["create", "createMany", "createManyAndReturn"]);
/** Ops that mutate an existing row. */
const UPDATE_OPS = new Set(["update", "updateMany", "updateManyAndReturn"]);

export function verticalExtension() {
  // Function form so we get the client this extension is being applied to, for
  // the provenance lookup below. That client does not carry this extension, so
  // reading a Project to learn its vertical cannot recurse or be filtered.
  return Prisma.defineExtension((baseClient) => {
    const projects = (
      baseClient as unknown as {
        project: {
          findUnique(a: {
            where: { id: string };
            select: { vertical: true };
          }): Promise<{ vertical: ActiveVertical } | null>;
        };
      }
    ).project;

    const lookupProjectVertical: ProjectLookup = async (id) => {
      const project = await runUnscoped(
        "tag provenance: read the linked job's department",
        () => projects.findUnique({ where: { id }, select: { vertical: true } })
      );
      return project?.vertical ?? null;
    };

    return baseClient.$extends({
    name: "vertical-isolation",
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          // Flag off: hand the query back exactly as it arrived. This is the
          // byte-for-byte roofing guarantee.
          if (!solarVerticalEnabled()) return query(args);

          const cls = classify(model);
          if (cls === "shared") return query(args);

          const resolution = await resolveVertical();

          // Explicitly company-wide (consolidated books, employee roster,
          // token lookups before the vertical is known).
          if (resolution.mode === "unscoped") return query(args);

          if (resolution.mode === "none") {
            // A tagged row with no context simply goes untagged — it is
            // company-level by definition (e.g. office rent imported by cron).
            if (cls === "tagged") return query(args);
            throw new MissingVerticalContextError(
              `${model}.${operation} touched a vertical-scoped model with no active vertical. ` +
                `Wrap this call in runInVertical() (cron jobs, public token pages, website intake, seeds) ` +
                `or runUnscoped() if it is genuinely company-wide.`
            );
          }

          const { vertical } = resolution;
          // `args` is typed as a union over every model × operation. Narrowing
          // it produces a type TS cannot represent, so widen to a plain object
          // up front — we only ever add a `vertical` key to `where`/`data`.
          const raw = args as unknown;
          const next: Json = isPlainObject(raw) ? { ...raw } : {};

          // Tagged models are stamped on write but never filtered on read, so
          // the ledger stays consolidated and still breaks out by department.
          if (cls === "scoped" && WHERE_OPS.has(operation)) {
            next.where = stampWhere(model!, next.where, vertical);
          } else if (cls === "scopedOptional" && WHERE_OPS.has(operation)) {
            next.where = stampWhereOptional(model!, next.where, vertical);
          }

          if (DATA_OPS.has(operation) && next.data !== undefined) {
            if (cls === "tagged") {
              // Creating a tagged row: derive its department from the job it
              // belongs to. Updating one: only re-derive if the link itself is
              // changing — a plain edit must NEVER re-stamp the row with
              // whichever workspace the editor happens to have open.
              if (CREATE_OPS.has(operation)) {
                next.data = await resolveTaggedProvenance(
                  model!,
                  next.data,
                  vertical,
                  lookupProjectVertical
                );
              } else if (UPDATE_OPS.has(operation)) {
                const fk = TAGGED_PROVENANCE[model!];
                const d = next.data;
                const relinked = fk && isPlainObject(d) && typeof d[fk] === "string";
                if (relinked) {
                  const derived = await lookupProjectVertical((d as Json)[fk] as string);
                  if (derived) next.data = { ...(d as Json), vertical: derived };
                }
                // else: leave `vertical` untouched.
              }
            } else {
              next.data = stampData(model!, next.data, vertical);
            }
          }

          if (operation === "upsert") {
            if (next.create !== undefined) {
              next.create =
                cls === "tagged"
                  ? await resolveTaggedProvenance(
                      model!,
                      next.create,
                      vertical,
                      lookupProjectVertical
                    )
                  : stampData(model!, next.create, vertical);
            }
            // An upsert's `update` branch edits an existing row: same rule as
            // above — do not re-stamp a tagged row from ambient context.
            if (next.update !== undefined && cls !== "tagged") {
              next.update = stampData(model!, next.update, vertical);
            }
          }

          // `query`'s parameter is a union over every model × operation, which
          // TS cannot represent once we hand it a widened object. The shape is
          // unchanged by construction — we only ever add a `vertical` key to
          // `where`/`data` — so erase the union rather than fight it.
          const run = query as unknown as (a: unknown) => Promise<unknown>;
          return run(next);
        },
      },
    },
    });
  });
}
