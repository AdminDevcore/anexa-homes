"use client";

import * as React from "react";
import Link from "next/link";
import { AlertTriangle, ChevronRight, Search, SearchX, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import {
  visibleSettingsGroups,
  type ResolvedSettingsSection,
  type SettingsSectionKey,
} from "@/lib/settings-sections";
import type { SettingsInventory, SectionStatus } from "@/server/modules/settings/inventory";
import type { SetupGap } from "@/server/modules/settings/workspace-health";
import type { ActiveVertical } from "@/lib/vertical";
import { VERTICAL_LABEL } from "@/lib/vertical";
import { cn } from "@/lib/utils";

/**
 * The Settings hub.
 *
 * It used to be a menu: twenty near-identical doors in one flat grid, no way to
 * tell a configured setting from an empty one without opening it, and a separate
 * amber panel up top restating the empty ones a second time.
 *
 * Now every card carries its own count, so the same grid answers "what is set up
 * here?" at a glance; the cards are banded by what they configure; and a search
 * box filters across every band at once, matching hidden keywords as well as the
 * visible copy. A workspace's setup gaps are rendered on the cards they belong
 * to — the warning about lead sources sits on the Lead Sources card, where it
 * can be acted on — with one line at the top to say how many there are.
 */
export function SettingsHub({
  vertical,
  inventory,
  gaps,
}: {
  vertical: ActiveVertical;
  inventory: SettingsInventory;
  gaps: SetupGap[];
}) {
  const groups = React.useMemo(() => visibleSettingsGroups(vertical), [vertical]);

  // Only gaps that land on a card this workspace shows: a check whose card is
  // hidden here has nowhere to be fixed, so counting it would promise a card
  // that "Show them" could never produce.
  const gapByKey = React.useMemo(() => {
    const cards = new Set(groups.flatMap((g) => g.sections.map((s) => s.key)));
    return new Map(
      gaps
        .map((g) => [g.key as SettingsSectionKey, g] as const)
        .filter(([key]) => cards.has(key))
    );
  }, [gaps, groups]);
  const gapCount = gapByKey.size;

  const [q, setQ] = React.useState("");
  const [band, setBand] = React.useState<string | null>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);

  // "/" focuses search from anywhere on the page, the way the list views the
  // reps already use behave. Never steal the key from a field being typed in.
  React.useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const el = e.target as HTMLElement | null;
      const typing =
        el?.tagName === "INPUT" || el?.tagName === "TEXTAREA" || el?.isContentEditable;
      if (e.key === "/" && !typing && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        inputRef.current?.focus();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const needle = q.trim().toLowerCase();
  const shown = groups
    .map((g) => ({
      ...g,
      sections: g.sections.filter(
        (s) =>
          matches(s, g.label, needle) &&
          (band === null || (band === GAPS ? gapByKey.has(s.key) : g.key === band))
      ),
    }))
    .filter((g) => g.sections.length > 0);

  const total = shown.reduce((n, g) => n + g.sections.length, 0);
  const filtering = needle.length > 0 || band !== null;

  return (
    <div className="space-y-5">
      {gapCount > 0 && (
        <button
          type="button"
          onClick={() => {
            setBand(band === GAPS ? null : GAPS);
            setQ("");
          }}
          className={cn(
            "flex w-full items-center gap-3 rounded-xl border px-4 py-3 text-left transition-colors",
            band === GAPS
              ? "border-amber-500/50 bg-amber-500/[0.07]"
              : "border-amber-500/30 bg-amber-500/[0.04] hover:border-amber-500/50"
          )}
        >
          <AlertTriangle className="size-4 shrink-0 text-amber-600 dark:text-amber-400" />
          <span className="min-w-0 flex-1 text-sm">
            <span className="font-medium">
              {gapCount} setting{gapCount === 1 ? " in" : "s in"} {VERTICAL_LABEL[vertical]}{" "}
              {gapCount === 1 ? "has" : "have"} never been set up
            </span>
            <span className="ml-1.5 text-muted-foreground">
              — configuration does not carry across workspaces, and nothing below raises an error
              when it is empty.
            </span>
          </span>
          <span className="shrink-0 text-sm font-medium text-amber-700 dark:text-amber-400">
            {band === GAPS ? "Show all" : "Show them"}
          </span>
        </button>
      )}

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="relative w-full lg:max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            ref={inputRef}
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              if (band === GAPS) setBand(null);
            }}
            onKeyDown={(e) => e.key === "Escape" && setQ("")}
            placeholder="Search settings…"
            aria-label="Search settings"
            className="h-10 rounded-xl pl-9 pr-9"
          />
          {q ? (
            <button
              type="button"
              onClick={() => setQ("")}
              aria-label="Clear search"
              className="absolute right-2 top-1/2 grid size-6 -translate-y-1/2 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <X className="size-3.5" />
            </button>
          ) : (
            <kbd className="pointer-events-none absolute right-3 top-1/2 hidden -translate-y-1/2 rounded border border-border px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground sm:block">
              /
            </kbd>
          )}
        </div>

        <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1 lg:mx-0 lg:px-0 lg:pb-0">
          <Chip active={band === null} onClick={() => setBand(null)}>
            All
          </Chip>
          {groups.map((g) => (
            <Chip key={g.key} active={band === g.key} onClick={() => setBand(g.key)}>
              {g.label}
            </Chip>
          ))}
        </div>
      </div>

      {total === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-border bg-card/50 px-6 py-16 text-center">
          <span className="grid size-12 place-items-center rounded-full bg-muted text-muted-foreground">
            <SearchX className="size-6" />
          </span>
          <h3 className="font-medium">No setting matches “{q}”</h3>
          <p className="max-w-sm text-sm text-muted-foreground">
            Try a shorter word — search covers what each page does, not just its name.
          </p>
          <button
            type="button"
            onClick={() => {
              setQ("");
              setBand(null);
            }}
            className="text-sm font-medium text-gold-muted underline-offset-4 hover:underline"
          >
            Clear filters
          </button>
        </div>
      ) : (
        <div className="space-y-8">
          {filtering && (
            <p className="text-sm text-muted-foreground" aria-live="polite">
              {total} setting{total === 1 ? "" : "s"}
            </p>
          )}
          {shown.map((g) => (
            <section key={g.key} className="space-y-3">
              <div className="flex items-baseline gap-2">
                <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {g.label}
                </h2>
                <span className="hidden text-xs text-muted-foreground/70 sm:block">{g.body}</span>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {g.sections.map((s) => (
                  <SectionCard
                    key={s.key}
                    section={s}
                    status={inventory[s.key]}
                    gap={gapByKey.get(s.key)}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

/** Pseudo-band: the cards this workspace has never set up. */
const GAPS = "__gaps";

function matches(s: ResolvedSettingsSection, groupLabel: string, needle: string) {
  if (!needle) return true;
  const hay = `${s.title} ${s.body} ${groupLabel} ${(s.keywords ?? []).join(" ")}`.toLowerCase();
  return needle.split(/\s+/).every((word) => hay.includes(word));
}

function SectionCard({
  section: s,
  status,
  gap,
}: {
  section: ResolvedSettingsSection;
  status?: SectionStatus;
  gap?: SetupGap;
}) {
  const attention = Boolean(gap) || status?.tone === "attention";

  const inner = (
    <>
      <div className="flex items-start gap-3">
        <span
          className={cn(
            "grid size-10 shrink-0 place-items-center rounded-xl transition-colors",
            !s.href && "bg-muted text-muted-foreground",
            s.href && attention && "bg-amber-500/15 text-amber-600 dark:text-amber-400",
            s.href &&
              !attention &&
              "bg-muted text-muted-foreground group-hover:bg-gold/12 group-hover:text-gold"
          )}
        >
          <s.icon className="size-[18px]" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="truncate font-medium leading-tight">{s.title}</h3>
            {gap?.severity === "blocking" && (
              <span className="shrink-0 rounded-full bg-destructive/15 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-destructive">
                Blocking
              </span>
            )}
          </div>
          <p className="mt-1 text-sm leading-snug text-muted-foreground">{s.body}</p>
        </div>
        {s.href && (
          <ChevronRight className="mt-0.5 size-4 shrink-0 text-muted-foreground/40 transition-all group-hover:translate-x-0.5 group-hover:text-gold" />
        )}
      </div>

      {gap ? (
        // The warning belongs on the card you fix it from, not in a panel that
        // names the same eight settings a second time.
        <div className="mt-3 border-t border-amber-500/25 pt-2.5 sm:mt-auto">
          <div className="text-xs font-medium text-amber-700 dark:text-amber-400">Not set up yet</div>
          <p className="mt-0.5 text-xs leading-snug text-muted-foreground">{gap.hint}</p>
        </div>
      ) : (
        status && (
          <div className="mt-3 flex items-center gap-2 border-t border-border/70 pt-2.5 sm:mt-auto">
            <span
              className={cn(
                "size-1.5 shrink-0 rounded-full",
                status.tone === "attention" ? "bg-amber-500" : "bg-muted-foreground/35"
              )}
              aria-hidden
            />
            <span
              className={cn(
                "truncate text-xs",
                status.tone === "attention"
                  ? "font-medium text-amber-700 dark:text-amber-400"
                  : "text-muted-foreground"
              )}
            >
              {status.label}
            </span>
            {status.companyWide && (
              <span
                className="ml-auto shrink-0 text-[10px] uppercase tracking-wider text-muted-foreground/60"
                title="Shared by every workspace — one company, one public site and one roster."
              >
                Company-wide
              </span>
            )}
          </div>
        )
      )}
    </>
  );

  const base = "flex flex-col rounded-2xl border p-4 text-left";
  const tone = attention ? "border-amber-500/35 bg-amber-500/[0.03]" : "border-border bg-card";

  return s.href ? (
    <Link
      href={s.href}
      className={cn(
        base,
        tone,
        "group transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md hover:shadow-black/[0.05] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
        attention ? "hover:border-amber-500/60" : "hover:border-gold/40"
      )}
    >
      {inner}
    </Link>
  ) : (
    <div className={cn(base, tone, "opacity-70")}>{inner}</div>
  );
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "shrink-0 whitespace-nowrap rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
        active
          ? "border-gold/40 bg-gold/12 text-gold-muted"
          : "border-border bg-card text-muted-foreground hover:border-gold/30 hover:text-foreground"
      )}
    >
      {children}
    </button>
  );
}
