import * as React from "react";
import Link from "next/link";
import { AlertTriangle, ArrowRight, Building2, CheckCircle2, Users } from "lucide-react";
import {
  SETTINGS_SECTIONS,
  visibleSettingsGroups,
  type SettingsSectionKey,
} from "@/lib/settings-sections";
import type { SettingsInventory } from "@/server/modules/settings/inventory";
import type { SetupGap } from "@/server/modules/settings/workspace-health";
import { VERTICAL_ACCENT, VERTICAL_LABEL, type ActiveVertical } from "@/lib/vertical";
import { cn } from "@/lib/utils";

/**
 * What `/portal/settings` is now that the menu lives in the sidebar.
 *
 * It used to be the menu: twenty near-identical cards, each with a paragraph of
 * description, laid out three across. That was the right answer while Settings
 * had no navigation of its own — the grid was the only way to see what existed.
 * It is the wrong answer now, because the sidebar lists every one of those
 * sections with the same counts on it, and a page repeating the menu beside the
 * menu says everything twice.
 *
 * So the landing page stops being a directory and becomes what a directory could
 * never be: the state of this workspace. Whose settings these are, what is not
 * finished, and which of them are shared with every other workspace. On a
 * workspace with nothing outstanding it is short, and that is the point — "there
 * is nothing to deal with here" is a useful thing for a page to be able to say.
 */
export function SettingsOverview({
  vertical,
  inventory,
  gaps,
  company,
}: {
  vertical: ActiveVertical;
  inventory: SettingsInventory;
  gaps: SetupGap[];
  company: { name: string; userCount: number };
}) {
  const groups = visibleSettingsGroups(vertical);
  const visible = new Set(groups.flatMap((g) => g.sections.map((s) => s.key)));

  // Only gaps whose section this workspace actually shows. A check whose section
  // is hidden here has nowhere to be fixed, so listing it would send somebody to
  // a screen that does not exist in the workspace they are standing in.
  const open = gaps.filter((g) => visible.has(g.key as SettingsSectionKey));

  // Sections the whole company shares — one public site, one roster — rather
  // than ones this workspace configures for itself. Read off the inventory
  // rather than named here, so a section that changes scope changes in one file.
  const shared = groups
    .flatMap((g) => g.sections)
    .filter((s) => inventory[s.key]?.companyWide && s.href);

  return (
    <div className="space-y-6">
      {/* ── Whose settings these are ─────────────────────────────────────── */}
      <div className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
        <div className="flex min-w-0 items-center gap-3">
          <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-gold/10 text-gold">
            <Building2 className="size-5" />
          </span>
          <div className="min-w-0">
            <div className="truncate font-display text-base font-semibold tracking-tight">
              {company.name}
            </div>
            <div className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
              <span
                className="size-1.5 rounded-full"
                style={{ backgroundColor: VERTICAL_ACCENT[vertical] }}
                aria-hidden
              />
              {VERTICAL_LABEL[vertical]} workspace
            </div>
          </div>
        </div>

        <Link
          href="/portal/team"
          className="flex items-center gap-3 rounded-xl border border-border bg-background px-4 py-2.5 transition-colors hover:border-gold/40"
          title="Everyone in the company — one roster, shared by every workspace"
        >
          <Users className="size-4 text-muted-foreground" />
          <span className="font-display text-lg font-semibold tabular-nums">
            {company.userCount}
          </span>
          <span className="text-sm text-muted-foreground">
            {company.userCount === 1 ? "user" : "users"}
          </span>
        </Link>
      </div>

      {/* ── What is not finished ─────────────────────────────────────────── */}
      {open.length > 0 ? (
        <section className="space-y-3">
          <div className="flex items-baseline gap-2">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Needs attention
            </h2>
            <span className="text-xs tabular-nums text-muted-foreground/70">{open.length}</span>
          </div>
          <p className="text-sm text-muted-foreground">
            Configuration does not carry across workspaces, and nothing below raises an error when
            it is empty — an unset setting simply produces an empty list somewhere downstream.
          </p>
          <div className="grid gap-3 lg:grid-cols-2">
            {open.map((gap) => (
              <GapCard key={gap.key} gap={gap} />
            ))}
          </div>
        </section>
      ) : (
        <div className="flex items-start gap-3 rounded-2xl border border-border bg-card p-4 sm:p-5">
          <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-emerald-600 dark:text-emerald-400" />
          <div className="min-w-0">
            <h2 className="font-medium">
              Everything in {VERTICAL_LABEL[vertical]} is set up
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Every section this workspace uses has something in it. Pick one from the menu on the
              left to change it.
            </p>
          </div>
        </div>
      )}

      {/* ── The ones that are not this workspace's to own ─────────────────── */}
      {shared.length > 0 && (
        <section className="space-y-3">
          <div className="flex items-baseline gap-2">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Shared by every workspace
            </h2>
            <span className="hidden text-xs text-muted-foreground/70 sm:block">
              One company, one public site and one roster — changing these changes them everywhere.
            </span>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {shared.map((s) => (
              <Link
                key={s.key}
                href={s.href!}
                className="group flex items-center gap-3 rounded-2xl border border-border bg-card p-4 transition-colors hover:border-gold/40"
              >
                <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-muted text-muted-foreground transition-colors group-hover:bg-gold/12 group-hover:text-gold">
                  <s.icon className="size-[18px]" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium leading-tight">{s.title}</span>
                  <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                    {inventory[s.key]?.label}
                  </span>
                </span>
                <ArrowRight className="size-4 shrink-0 text-muted-foreground/40 transition-all group-hover:translate-x-0.5 group-hover:text-gold" />
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

/**
 * One unfinished setting, with the way to finish it.
 *
 * The hint is the part worth keeping: it says what actually goes wrong today —
 * "a deal cannot be quoted on this partner" — rather than "no rows found".
 */
function GapCard({ gap }: { gap: SetupGap }) {
  const section = SETTINGS_SECTIONS.find((s) => s.key === gap.key);
  const Icon = section?.icon ?? AlertTriangle;
  const blocking = gap.severity === "blocking";

  return (
    <Link
      href={gap.href}
      className={cn(
        "group flex flex-col rounded-2xl border p-4 transition-colors",
        blocking
          ? "border-destructive/35 bg-destructive/[0.03] hover:border-destructive/60"
          : "border-amber-500/35 bg-amber-500/[0.04] hover:border-amber-500/60"
      )}
    >
      <div className="flex items-start gap-3">
        <span
          className={cn(
            "grid size-10 shrink-0 place-items-center rounded-xl",
            blocking
              ? "bg-destructive/15 text-destructive"
              : "bg-amber-500/15 text-amber-600 dark:text-amber-400"
          )}
        >
          <Icon className="size-[18px]" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="truncate font-medium leading-tight">{gap.label}</h3>
            {blocking && (
              <span className="shrink-0 rounded-full bg-destructive/15 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-destructive">
                Blocking
              </span>
            )}
          </div>
          <p className="mt-1 text-sm leading-snug text-muted-foreground">{gap.hint}</p>
        </div>
      </div>
      <span
        className={cn(
          "mt-3 flex items-center gap-1 self-end text-sm font-medium",
          blocking ? "text-destructive" : "text-amber-700 dark:text-amber-400"
        )}
      >
        Set it up
        <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" />
      </span>
    </Link>
  );
}
