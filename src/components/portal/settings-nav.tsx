"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { ArrowUpRight, ChevronLeft, Search, X } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  visibleSettingsGroups,
  type ResolvedSettingsSection,
  type SettingsSectionKey,
} from "@/lib/settings-sections";
import type { SettingsInventory } from "@/server/modules/settings/inventory";
import type { ActiveVertical } from "@/lib/vertical";

export const SETTINGS_ROOT = "/portal/settings";

/** The screen Settings was opened from, so there is somewhere to go back to. */
const LAST_APP_PATH = "anexa.last-app-path";

/** Called by the shell on every screen that is not a settings screen. */
export function rememberAppPath(pathname: string) {
  try {
    window.sessionStorage.setItem(LAST_APP_PATH, pathname);
  } catch {
    // Private browsing, or storage denied. Back goes to the dashboard.
  }
}

function lastAppPath(): string {
  try {
    return window.sessionStorage.getItem(LAST_APP_PATH) || "/portal/dashboard";
  } catch {
    return "/portal/dashboard";
  }
}

/**
 * Settings does not get a navigation column of its own — it takes over the one
 * that is already there.
 *
 * Before this, opening a settings screen stacked three navigation columns
 * between a person and the thing they came to edit: the dark app sidebar, a
 * light "All settings" rail, and the screen's own list of lenders or providers.
 * Two of the three carried a search box. The middle one was the problem: it
 * existed only because Settings had nowhere else to put its directory.
 *
 * It does have somewhere. While you are inside Settings the app sidebar *is* the
 * settings directory, with a way back at the top; leaving restores it. That
 * costs nothing, and what it buys is that every settings screen is an ordinary
 * two-column master-detail page instead of a fourth panel squeezed in beside
 * three menus.
 */

// ───────────────────────────────────────────────────────────────────────────
// What is configured behind each section
// ───────────────────────────────────────────────────────────────────────────

export type SettingsNavData = {
  inventory: SettingsInventory;
  /** Sections this workspace has never set up. Plain strings — icons stay client-side. */
  gapKeys: string[];
};

const EMPTY: SettingsNavData = { inventory: {}, gapKeys: [] };

/**
 * Fetched, rather than handed down from the layout that renders Settings.
 *
 * Two things rule that out. The sidebar belongs to the portal layout, one level
 * ABOVE the settings layout that knows these numbers — and a Next layout does
 * not re-render when you navigate between its children, so anything passed in
 * on the way into Settings would still say "3 sources" after you added a fourth.
 *
 * The menu itself never waits for this: it is built from the static registry and
 * is complete in the first paint. Only the counts and the amber dots arrive with
 * the response, and they refresh whenever a settings screen is returned to.
 */
function useSettingsInventory(): SettingsNavData {
  const { data } = useQuery<SettingsNavData>({
    queryKey: ["settings-inventory"],
    queryFn: async () => {
      const res = await fetch("/api/settings/inventory");
      if (!res.ok) return EMPTY;
      return res.json();
    },
    // Polled, because the thing being counted is the thing being edited: a save
    // calls router.refresh(), which re-renders the screen but knows nothing
    // about this cache, so without a poll the menu would still read "None yet"
    // beside the lender you had just created. The query only exists while the
    // settings menu is mounted, which is only while Settings is open.
    staleTime: 10_000,
    refetchInterval: 20_000,
    refetchOnWindowFocus: false,
  });
  return data ?? EMPTY;
}

// ───────────────────────────────────────────────────────────────────────────
// The nav
// ───────────────────────────────────────────────────────────────────────────

/**
 * The settings directory, dressed for the dark sidebar.
 *
 * Each row carries what is actually configured behind it — "28 stages", "None
 * yet", "3 awaiting approval" — so the menu doubles as the status board the hub
 * grid used to be, and a section this workspace has never set up wears an amber
 * dot in the place you would go to fix it.
 */
export function SettingsSidebarNav({
  vertical,
  pathname,
  onNavigate,
}: {
  vertical: ActiveVertical;
  pathname: string;
  /** Closes the mobile sheet. Absent on the desktop sidebar, which never closes. */
  onNavigate?: () => void;
}) {
  const router = useRouter();
  const { inventory, gapKeys } = useSettingsInventory();
  const groups = React.useMemo(() => visibleSettingsGroups(vertical), [vertical]);
  const gaps = React.useMemo(() => new Set(gapKeys), [gapKeys]);

  const [q, setQ] = React.useState("");
  const inputRef = React.useRef<HTMLInputElement>(null);

  // "/" focuses the box, matching the list views the reps already use. Only
  // while Settings is open, and never out of a field somebody is typing in.
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
    .map((g) => ({ ...g, sections: g.sections.filter((s) => matches(s, g.label, needle)) }))
    .filter((g) => g.sections.length > 0);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="space-y-2 px-3 pb-2">
        {/* A button, not a link: the destination is whatever screen this tab was
            on before, which is only known at the moment it is pressed. */}
        <button
          type="button"
          onClick={() => {
            onNavigate?.();
            router.push(lastAppPath());
          }}
          className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-white/55 transition-colors hover:bg-white/[0.04] hover:text-white/90"
        >
          <ChevronLeft className="size-4 shrink-0" />
          Back to app
        </button>

        <div className="relative">
          <Search
            aria-hidden
            className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-white/40"
          />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && setQ("")}
            placeholder="Find a setting"
            aria-label="Find a setting"
            className="h-9 w-full rounded-lg border border-white/10 bg-white/[0.04] pl-8 pr-8 text-sm text-white placeholder:text-white/35 focus:border-white/25 focus:outline-none"
          />
          {q !== "" && (
            <button
              type="button"
              onClick={() => setQ("")}
              aria-label="Clear search"
              className="absolute right-2 top-1/2 -translate-y-1/2 text-white/40 hover:text-white"
            >
              <X className="size-3.5" />
            </button>
          )}
        </div>
      </div>

      <nav
        aria-label="Settings sections"
        className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 pb-4"
      >
        {shown.map((g) => (
          <div key={g.key} className="space-y-0.5">
            <p className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-white/35">
              {g.label}
            </p>
            {g.sections.map((s) => (
              <SettingsNavLink
                key={s.key}
                section={s}
                active={isActive(pathname, s.href)}
                status={inventory[s.key]}
                gap={gaps.has(s.key)}
                onNavigate={onNavigate}
              />
            ))}
          </div>
        ))}

        {shown.length === 0 && (
          <p className="px-3 py-4 text-xs text-white/45">Nothing matches &ldquo;{q}&rdquo;.</p>
        )}
      </nav>
    </div>
  );
}

/**
 * One section.
 *
 * Off-site rows — Document Templates lives at /portal/documents, solar rep pay
 * on the Team roster — carry an arrow, because following one leaves Settings and
 * the sidebar turns back into the app menu behind you.
 */
function SettingsNavLink({
  section,
  active,
  status,
  gap,
  onNavigate,
}: {
  section: ResolvedSettingsSection;
  active: boolean;
  status?: { label: string; tone?: string };
  gap: boolean;
  onNavigate?: () => void;
}) {
  const away = section.href != null && !section.href.startsWith(SETTINGS_ROOT);
  const Icon = section.icon;

  return (
    <Link
      href={section.href ?? SETTINGS_ROOT}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={cn(
        "relative flex items-center gap-2.5 rounded-lg px-3 py-1.5 transition-colors",
        active
          ? "bg-white/[0.08] text-white before:absolute before:inset-y-1.5 before:-left-1 before:w-[3px] before:rounded-full before:bg-gold"
          : "text-white/55 hover:bg-white/[0.04] hover:text-white/90"
      )}
    >
      <Icon className={cn("size-4 shrink-0", active ? "text-gold" : "text-current")} />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1">
          <span className="truncate text-[13px] font-medium leading-tight">{section.title}</span>
          {away && <ArrowUpRight className="size-3 shrink-0 opacity-60" />}
        </span>
        {status && (
          <span
            className={cn(
              "block truncate text-[11px] leading-tight",
              status.tone === "attention" ? "text-amber-400" : "text-white/40"
            )}
          >
            {status.label}
          </span>
        )}
      </span>
      {gap && (
        <span
          className="size-1.5 shrink-0 rounded-full bg-amber-400"
          aria-label="Never set up"
          role="img"
        />
      )}
    </Link>
  );
}

/**
 * Screens that belong to a section without sitting under its path.
 *
 * The cost and supplement template libraries are opened from the Scope of Work
 * catalog and are part of it, but they are siblings in the route tree — without
 * this the menu would highlight nothing while you were inside one, which reads
 * as "you have left Settings".
 */
const ADOPTED: Record<string, string[]> = {
  "/portal/settings/scope-template": [
    "/portal/settings/scope-cost-templates",
    "/portal/settings/scope-supplement-templates",
  ],
};

function isActive(pathname: string, href?: string) {
  if (!href) return false;
  if (pathname === href) return true;
  if (href !== SETTINGS_ROOT && pathname.startsWith(`${href}/`)) return true;
  return (ADOPTED[href] ?? []).some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

function matches(s: ResolvedSettingsSection, group: string, needle: string) {
  if (needle === "") return true;
  return [s.title, s.body, group, ...(s.keywords ?? [])]
    .join(" ")
    .toLowerCase()
    .includes(needle);
}

export type { SettingsSectionKey };
