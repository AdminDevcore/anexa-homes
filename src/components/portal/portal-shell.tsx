"use client";

import * as React from "react";
import Link, { useLinkStatus } from "next/link";
import { usePathname } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Menu, Phone, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { PORTAL_NAV, navRoutes, type NavItem } from "@/lib/nav";
import { Logo } from "@/components/marketing/logo";
import type { Branding } from "@/server/branding/defaults";
import { UserMenu } from "./user-menu";
import { NotificationBell } from "./notification-bell";
import { CommandPalette } from "./command-palette";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetTrigger, SheetTitle } from "@/components/ui/sheet";
import { WorkspaceSwitcher } from "./workspace-switcher";
import { rememberAppPath, SettingsSidebarNav, SETTINGS_ROOT } from "./settings-nav";
import { VERTICAL_ACCENT, type ActiveVertical } from "@/lib/vertical";

export type ShellUser = {
  name: string;
  email: string;
  roleLabel: string;
};

/**
 * The spinner on the nav item you just clicked.
 *
 * `useLinkStatus` reports the pending state of the enclosing Link, so this has
 * to render inside one. Feedback lands on the exact row the user pressed —
 * which is the question they are asking ("did that register?") — rather than as
 * a bar at the top of the window that answers a different one.
 */
function NavPending() {
  const { pending } = useLinkStatus();
  if (!pending) return null;
  return <Loader2 className="size-3.5 shrink-0 animate-spin text-white/70" aria-hidden />;
}

/**
 * The app menu: every section this user is allowed to open.
 *
 * Module level rather than declared inside the shell — a component created
 * during render is a new type on every render, so React throws the subtree away
 * and rebuilds it instead of updating in place, which loses focus and any state
 * inside it.
 */
/**
 * How specifically an item claims this path: the length of the longest route it
 * owns that the path sits under, or -1 for no claim at all.
 */
function matchLength(item: NavItem, pathname: string): number {
  return Math.max(
    -1,
    ...navRoutes(item)
      .filter((href) => pathname === href || pathname.startsWith(href + "/"))
      .map((href) => href.length)
  );
}

function AppNavList({
  items,
  pathname,
  unread,
  onNavigate,
}: {
  items: typeof PORTAL_NAV;
  pathname: string;
  unread: number;
  onNavigate?: () => void;
}) {
  return (
    <nav className="flex flex-col gap-1 px-3">
      {items.map((item) => {
        // Longest matching href wins, so a parent route (Settings) doesn't also
        // highlight on a child owned by another item (Reviews lives at
        // /portal/settings/reviews). An item's tab routes count as its own:
        // standing on Contractor Pay lights up Commissions, which is where the
        // tab that opened it lives.
        const mine = matchLength(item, pathname);
        const active = mine >= 0 && !items.some((o) => matchLength(o, pathname) > mine);
        const badge = item.href === "/portal/chat" && unread > 0 ? unread : null;
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            className={cn(
              "relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
              // Active is a lifted surface, not a slab of brand colour, with a
              // thin orange rule at the leading edge. The eye still lands on it
              // instantly, and the orange stays available for the button that
              // actually wants pressing.
              active
                ? "bg-white/[0.08] text-white before:absolute before:inset-y-1.5 before:-left-1 before:w-[3px] before:rounded-full before:bg-gold"
                : "text-white/55 hover:bg-white/[0.04] hover:text-white/90"
            )}
          >
            <item.icon className="size-[18px] shrink-0" />
            <span className="flex-1">{item.label}</span>
            <NavPending />
            {badge !== null && (
              <Badge
                className={cn(
                  "h-5 min-w-5 justify-center rounded-full px-1.5 tabular-nums",
                  active && "bg-background text-foreground"
                )}
              >
                {badge}
              </Badge>
            )}
          </Link>
        );
      })}
    </nav>
  );
}

export function PortalShell({
  user,
  allowedHrefs,
  branding,
  vertical,
  availableVerticals,
  settingsVertical,
  children,
}: {
  user: ShellUser;
  allowedHrefs: string[];
  branding: Branding;
  /** Active workspace. Null when the multi-vertical experience is switched off. */
  vertical: ActiveVertical | null;
  availableVerticals: ActiveVertical[];
  /**
   * The workspace the settings menu answers for. Unlike `vertical` this is never
   * null — with the switcher off there is still exactly one workspace, and the
   * menu still has to know which sections belong to it.
   */
  settingsVertical: ActiveVertical;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const items = PORTAL_NAV.filter((i) => allowedHrefs.includes(i.href));

  // Settings takes the sidebar over rather than adding a second one beside it.
  // Read from the pathname rather than published on mount, because `usePathname`
  // resolves during the server render of a client component: the right menu is
  // in the first paint instead of swapping in after hydration.
  const inSettings = pathname === SETTINGS_ROOT || pathname.startsWith(`${SETTINGS_ROOT}/`);

  // Remember the screen you opened Settings from, so "Back to app" returns to
  // it rather than dumping everyone on the dashboard. In session storage rather
  // than in state: nothing renders it — it is read once, when the control is
  // pressed — and storing it survives a reload, which a ref would not.
  React.useEffect(() => {
    if (inSettings) return;
    rememberAppPath(pathname);
  }, [inSettings, pathname]);
  const chatEnabled = allowedHrefs.includes("/portal/chat");

  const { data: chatUnread } = useQuery<{ count: number }>({
    queryKey: ["chat-unread"],
    queryFn: async () => {
      const res = await fetch("/api/chat/unread");
      if (!res.ok) return { count: 0 };
      return res.json();
    },
    enabled: chatEnabled,
    refetchInterval: 10000,
    refetchOnWindowFocus: true,
  });
  const unread = chatUnread?.count ?? 0;

  // An element rather than a component, so the desktop sidebar and the mobile
  // sheet share one definition without declaring a component mid-render.
  const sidebarNav = inSettings ? (
    <SettingsSidebarNav vertical={settingsVertical} pathname={pathname} />
  ) : (
    <AppNavList items={items} pathname={pathname} unread={unread} />
  );

  return (
    <div className="portal-root flex min-h-screen bg-muted/30">
      {/* Desktop sidebar. The shell is workspace furniture: when someone prints
          a page from inside the portal they want the document on it, not the
          navigation around it. */}
      <aside className="dark fixed inset-y-0 left-0 hidden w-64 flex-col border-r border-shell-border bg-shell text-foreground lg:flex print:hidden">
        <div className="flex h-16 items-center border-b border-shell-border px-5">
          <Link href="/portal/dashboard" className="group inline-flex items-center">
            <div className="flex items-center gap-2">
              {branding.logoUrl ? (
                <>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={branding.logoUrl} alt={branding.companyName} className="h-10 w-auto" />
                  <span className="font-display text-lg font-semibold tracking-tight">
                    {branding.companyName}
                  </span>
                </>
              ) : (
                // Default brand: full Anexa lockup (mark + wordmark) — white, for the dark sidebar.
                // eslint-disable-next-line @next/next/no-img-element
                <img src="/anexa-lockup.png" alt={branding.companyName} className="h-11 w-auto" />
              )}
            </div>
          </Link>
        </div>
        {/* The settings menu scrolls its own list beneath a pinned search box,
            so it needs the height rather than the overflow. */}
        <div
          className={cn(
            "flex min-h-0 flex-1 flex-col",
            inSettings ? "py-3" : "overflow-y-auto py-4"
          )}
        >
          {sidebarNav}
        </div>
        <div className="border-t border-border p-4">
          {branding.supportPhone && (
            <a
              href={`tel:${branding.supportPhone.replace(/[^0-9+]/g, "")}`}
              className="flex items-center gap-2 rounded-lg bg-muted px-3 py-2.5 text-xs text-muted-foreground hover:text-foreground"
            >
              <Phone className="size-4" />
              Support: {branding.supportPhone}
            </a>
          )}
        </div>
      </aside>

      {/* Main column — min-w-0 lets it shrink below content width so wide tables
          scroll inside their own container instead of pushing the page (and the
          header actions) past the viewport's right edge. */}
      <div className="flex min-w-0 flex-1 flex-col lg:pl-64 print:pl-0">
        <header className="dark sticky top-0 z-30 flex h-16 relative items-center justify-between gap-3 border-b border-shell-border bg-shell px-4 text-foreground sm:px-6 print:hidden">
          <div className="flex items-center gap-3">
            {/* Mobile menu */}
            <Sheet>
              <SheetTrigger asChild>
                <Button variant="outline" size="icon" className="lg:hidden" aria-label="Open menu">
                  <Menu className="size-5" />
                </Button>
              </SheetTrigger>
              <SheetContent
                side="left"
                className="dark flex w-72 flex-col bg-shell p-0 text-foreground"
              >
                <SheetTitle className="sr-only">
                  {inSettings ? "Settings" : "Navigation"}
                </SheetTitle>
                <div className="flex h-16 shrink-0 items-center border-b border-shell-border px-5">
                  <Logo href="/portal/dashboard" />
                </div>
                <div
                  className={cn(
                    "flex min-h-0 flex-1 flex-col",
                    inSettings ? "py-3" : "overflow-y-auto py-4"
                  )}
                >
                  {sidebarNav}
                </div>
              </SheetContent>
            </Sheet>
            <div className="lg:hidden">
              <Logo href="/portal/dashboard" />
            </div>
          </div>

          <div className="flex items-center gap-3">
            <CommandPalette allowedHrefs={allowedHrefs} activeVertical={vertical} />
            {vertical && (
              <WorkspaceSwitcher active={vertical} available={availableVerticals} />
            )}
            <span className="hidden text-sm text-muted-foreground sm:inline">
              {user.roleLabel}
            </span>
            <NotificationBell />
            <UserMenu name={user.name} email={user.email} roleLabel={user.roleLabel} />
          </div>
          {/* Full-width accent strip in the active workspace's colour. Peripheral
              but always in view, so nobody works a whole session in the wrong one. */}
          {vertical && (
            <span
              aria-hidden
              className="pointer-events-none absolute inset-x-0 bottom-0 h-0.5"
              style={{ background: VERTICAL_ACCENT[vertical] }}
            />
          )}
        </header>

        <main className="min-w-0 flex-1 p-4 sm:p-6 lg:p-8 print:p-0">{children}</main>
      </div>
    </div>
  );
}
