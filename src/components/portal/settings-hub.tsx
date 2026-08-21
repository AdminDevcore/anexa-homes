"use client";

import * as React from "react";
import Link from "next/link";
import { ChevronRight, Search, SearchX, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { visibleSettingsGroups, type ResolvedSettingsSection } from "@/lib/settings-sections";
import type { ActiveVertical } from "@/lib/vertical";
import { cn } from "@/lib/utils";

/**
 * The Settings hub's card grid.
 *
 * Twenty near-identical cards in one flat grid is a wall — nothing tells you
 * where to look, so every visit is a linear scan. The cards are banded by what
 * they configure, and a search box filters across every band at once (matching
 * the hidden `keywords` too, so "payout" finds Commission Rules and "logo"
 * finds Branding).
 *
 * The band list comes from the shared catalog rather than being restated here,
 * so a card added for one vertical lands in the right band in both.
 */
export function SettingsHub({ vertical }: { vertical: ActiveVertical }) {
  const groups = React.useMemo(() => visibleSettingsGroups(vertical), [vertical]);
  const [q, setQ] = React.useState("");
  const [band, setBand] = React.useState<string | null>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);

  // "/" focuses search from anywhere on the page, the way every list view the
  // reps already use behaves. Never steal the key from a field being typed in.
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
    .filter((g) => !band || g.key === band)
    .map((g) => ({
      ...g,
      sections: g.sections.filter((s) => matches(s, g.label, needle)),
    }))
    .filter((g) => g.sections.length > 0);

  const total = shown.reduce((n, g) => n + g.sections.length, 0);
  const filtering = needle.length > 0 || band !== null;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="relative w-full lg:max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
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
                  <SectionCard key={s.title} section={s} />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

function matches(s: ResolvedSettingsSection, groupLabel: string, needle: string) {
  if (!needle) return true;
  const hay = `${s.title} ${s.body} ${groupLabel} ${(s.keywords ?? []).join(" ")}`.toLowerCase();
  return needle.split(/\s+/).every((word) => hay.includes(word));
}

function SectionCard({ section: s }: { section: ResolvedSettingsSection }) {
  const inner = (
    <>
      <span
        className={cn(
          "grid size-10 shrink-0 place-items-center rounded-xl transition-colors",
          s.href
            ? "bg-gold/10 text-gold group-hover:bg-gold/20"
            : "bg-muted text-muted-foreground"
        )}
      >
        <s.icon className="size-[18px]" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block font-medium leading-tight">{s.title}</span>
        <span className="mt-1 block text-sm leading-snug text-muted-foreground">{s.body}</span>
        {!s.href && (
          <span className="mt-2 inline-block rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            Next phase
          </span>
        )}
      </span>
      {s.href && (
        <ChevronRight className="mt-0.5 size-4 shrink-0 text-muted-foreground/40 transition-all group-hover:translate-x-0.5 group-hover:text-gold" />
      )}
    </>
  );

  const base =
    "flex items-start gap-3.5 rounded-2xl border border-border bg-card p-4 text-left";

  return s.href ? (
    <Link
      href={s.href}
      className={cn(
        base,
        "group transition-all duration-200 hover:-translate-y-0.5 hover:border-gold/40 hover:shadow-md hover:shadow-black/[0.05] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
      )}
    >
      {inner}
    </Link>
  ) : (
    <div className={cn(base, "opacity-70")}>{inner}</div>
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
