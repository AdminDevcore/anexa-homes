"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ArrowUpRight,
  ChevronLeft,
  LayoutGrid,
  Menu,
  PanelLeft,
  Search,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import {
  visibleSettingsGroups,
  type ResolvedSettingsSection,
  type SettingsSectionKey,
} from "@/lib/settings-sections";
import type { SettingsInventory } from "@/server/modules/settings/inventory";
import type { ActiveVertical } from "@/lib/vertical";

const HUB = "/portal/settings";
const COLLAPSED_KEY = "anexa.settings-rail-collapsed";
/** Fired on this tab when the rail folds, so every reader re-renders. */
const COLLAPSED_EVENT = "anexa:settings-rail";

/**
 * Whether the rail is folded, remembered per browser.
 *
 * Through `useSyncExternalStore` rather than state seeded from `localStorage`:
 * the server has no storage, so seeding during render produces markup the
 * client disagrees with, which React reports as a hydration mismatch and
 * repairs by throwing the page away. The server snapshot is "expanded", the
 * client's is whatever was stored, and React reconciles the difference itself.
 */
function useCollapsed(): [boolean, () => void] {
  const collapsed = React.useSyncExternalStore(
    (onChange) => {
      window.addEventListener(COLLAPSED_EVENT, onChange);
      window.addEventListener("storage", onChange);
      return () => {
        window.removeEventListener(COLLAPSED_EVENT, onChange);
        window.removeEventListener("storage", onChange);
      };
    },
    () => {
      try {
        return window.localStorage.getItem(COLLAPSED_KEY) === "1";
      } catch {
        // Private browsing, or storage denied. Expanded is fine.
        return false;
      }
    },
    () => false
  );

  const toggle = React.useCallback(() => {
    try {
      window.localStorage.setItem(COLLAPSED_KEY, collapsed ? "0" : "1");
    } catch {
      // Not worth failing a click over — but then it will not be remembered.
    }
    window.dispatchEvent(new Event(COLLAPSED_EVENT));
  }, [collapsed]);

  return [collapsed, toggle];
}

/**
 * The rail that follows you around Settings.
 *
 * Settings used to be a hub and twenty dead ends: every screen opened full
 * width with a "← Back to settings" link at the top, so moving from Branding to
 * Automations meant going back to the menu and finding the card again — and
 * once you were inside a screen there was nothing on the page to say what else
 * Settings even held.
 *
 * This is the lenders screen's rail one level up. The sections are the things
 * being picked; the screen you are on is the panel. Each row carries what is
 * actually configured behind it — "12 sources", "None yet", "3 awaiting
 * approval" — so the rail doubles as the status board the hub grid became, and
 * a section this workspace has never set up wears the same amber dot a lender
 * with no rate sheet does.
 *
 * The hub itself keeps the full window: it is the search-and-browse view, and
 * putting a list of every section beside a grid of every section would say the
 * same thing twice.
 */
export function SettingsChrome({
  vertical,
  inventory,
  gapKeys,
  children,
}: {
  vertical: ActiveVertical;
  inventory: SettingsInventory;
  /** Sections this workspace has never set up. Plain strings — icons stay client-side. */
  gapKeys: string[];
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [collapsed, toggle] = useCollapsed();

  // The hub is the one screen the rail would only repeat.
  if (pathname === HUB) return <>{children}</>;

  return (
    // FOLDED IS FOLDED: one column, and the screen gets the whole window.
    // Folding used to leave a 3.5rem strip of unlabelled icons standing where
    // the rail had been — twenty settings sections as twenty anonymous glyphs,
    // which is not a menu anybody can read and not the width somebody folding
    // the rail was asking for.
    <div
      className={cn(
        collapsed ? "lg:block" : "lg:grid lg:grid-cols-[auto_minmax(0,1fr)] lg:gap-6"
      )}
    >
      <SettingsRail
        vertical={vertical}
        inventory={inventory}
        gapKeys={gapKeys}
        pathname={pathname}
        collapsed={collapsed}
        onToggle={toggle}
      />
      <div className="min-w-0">{children}</div>
    </div>
  );
}

function SettingsRail({
  vertical,
  inventory,
  gapKeys,
  pathname,
  collapsed,
  onToggle,
}: {
  vertical: ActiveVertical;
  inventory: SettingsInventory;
  gapKeys: string[];
  pathname: string;
  collapsed: boolean;
  onToggle: () => void;
}) {
  return (
    <>
      {/* ── Narrow: the rail is a sheet, opened from the crumb line ─────── */}
      <div className="mb-4 flex items-center gap-2 lg:hidden">
        <Sheet>
          <SheetTrigger asChild>
            <Button variant="outline" size="sm">
              <Menu className="size-4" /> All settings
            </Button>
          </SheetTrigger>
          <SheetContent side="left" className="w-[19rem] overflow-y-auto p-4">
            <SheetTitle className="mb-3 font-display text-base">Settings</SheetTitle>
            <RailBody
              vertical={vertical}
              inventory={inventory}
              gapKeys={gapKeys}
              pathname={pathname}
            />
          </SheetContent>
        </Sheet>
      </div>

      {/* ── Wide and folded: one labelled button, on its own line ───────── */}
      {collapsed && (
        <div className="mb-4 hidden lg:block">
          <Button variant="outline" size="sm" onClick={onToggle}>
            <PanelLeft className="size-4" /> Settings menu
          </Button>
        </div>
      )}

      {/* ── Wide and open: sticky beside the panel ──────────────────────── */}
      {!collapsed && (
        <aside className="hidden shrink-0 lg:sticky lg:top-20 lg:block lg:w-[13.5rem] lg:self-start xl:w-[15rem]">
          <RailBody
            vertical={vertical}
            inventory={inventory}
            gapKeys={gapKeys}
            pathname={pathname}
            onToggle={onToggle}
          />
        </aside>
      )}
    </>
  );
}

function RailBody({
  vertical,
  inventory,
  gapKeys,
  pathname,
  onToggle,
}: {
  vertical: ActiveVertical;
  inventory: SettingsInventory;
  gapKeys: string[];
  pathname: string;
  /** Absent inside the narrow sheet, which folds by closing rather than by button. */
  onToggle?: () => void;
}) {
  const groups = React.useMemo(() => visibleSettingsGroups(vertical), [vertical]);
  const gaps = React.useMemo(() => new Set(gapKeys), [gapKeys]);
  const [q, setQ] = React.useState("");

  const needle = q.trim().toLowerCase();
  const shown = groups
    .map((g) => ({ ...g, sections: g.sections.filter((s) => matches(s, g.label, needle)) }))
    .filter((g) => g.sections.length > 0);

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1">
        <Link
          href={HUB}
          className="flex min-w-0 flex-1 items-center gap-2 rounded-lg border border-transparent px-2.5 py-2 text-sm font-medium transition-colors hover:border-border hover:bg-muted/50"
          title="All settings"
        >
          <LayoutGrid className="size-4 shrink-0 text-muted-foreground" />
          <span className="truncate">All settings</span>
        </Link>
        {onToggle && (
          <button
            type="button"
            onClick={onToggle}
            aria-label="Hide settings menu"
            className="grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <ChevronLeft className="size-4" />
          </button>
        )}
      </div>

      <div className="relative">
          <Search
            aria-hidden
            className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && setQ("")}
            placeholder="Find a setting"
            aria-label="Find a setting"
            className="h-8 pl-8 pr-8"
          />
        {q !== "" && (
          <button
            type="button"
            onClick={() => setQ("")}
            aria-label="Clear search"
            className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          >
            <X className="size-3.5" />
          </button>
        )}
      </div>

      <nav
        aria-label="Settings sections"
        className="space-y-3 overflow-y-auto pr-1 lg:max-h-[calc(100vh-11rem)]"
      >
        {shown.map((g) => (
          <div key={g.key} className="space-y-0.5">
            <p className="px-2.5 pb-0.5 pt-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/80">
              {g.label}
            </p>
            {g.sections.map((s) => (
              <RailLink
                key={s.key}
                section={s}
                active={isActive(pathname, s.href)}
                status={inventory[s.key]}
                gap={gaps.has(s.key)}
              />
            ))}
          </div>
        ))}

        {shown.length === 0 && (
          <p className="px-2.5 py-4 text-xs text-muted-foreground">
            Nothing matches &ldquo;{q}&rdquo;.
          </p>
        )}
      </nav>
    </div>
  );
}

/**
 * One section in the rail.
 *
 * Off-site rows — Document Templates lives at /portal/documents, solar rep pay
 * on the Team roster — carry an arrow, because following one leaves Settings
 * and takes the rail with it.
 */
function RailLink({
  section,
  active,
  status,
  gap,
}: {
  section: ResolvedSettingsSection;
  active: boolean;
  status?: { label: string; tone?: string };
  gap: boolean;
}) {
  const away = section.href != null && !section.href.startsWith(HUB);
  const Icon = section.icon;

  return (
    <Link
      href={section.href ?? HUB}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex items-center gap-2.5 rounded-lg border px-2.5 py-1.5 transition-colors",
        active
          ? "border-gold/50 bg-gold/[0.08]"
          : "border-transparent hover:border-border hover:bg-muted/50"
      )}
    >
      <Icon className={cn("size-4 shrink-0", active ? "text-gold" : "text-muted-foreground")} />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1">
          <span className="truncate text-[13px] font-medium leading-tight">{section.title}</span>
          {away && <ArrowUpRight className="size-3 shrink-0 text-muted-foreground/70" />}
        </span>
        {status && (
          <span
            className={cn(
              "block truncate text-[11px] leading-tight",
              status.tone === "attention"
                ? "text-amber-600 dark:text-amber-400"
                : "text-muted-foreground"
            )}
          >
            {status.label}
          </span>
        )}
      </span>
      {gap && (
        <span
          className="size-1.5 shrink-0 rounded-full bg-amber-500"
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
 * this the rail would highlight nothing while you were inside one, which reads
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
  if (href !== HUB && pathname.startsWith(`${href}/`)) return true;
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
