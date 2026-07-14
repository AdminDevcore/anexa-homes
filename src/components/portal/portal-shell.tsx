"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Menu, Phone } from "lucide-react";
import { cn } from "@/lib/utils";
import { PORTAL_NAV } from "@/lib/nav";
import { Logo } from "@/components/marketing/logo";
import type { Branding } from "@/server/branding/defaults";
import { UserMenu } from "./user-menu";
import { NotificationBell } from "./notification-bell";
import { CommandPalette } from "./command-palette";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetTrigger, SheetTitle } from "@/components/ui/sheet";

export type ShellUser = {
  name: string;
  email: string;
  roleLabel: string;
};

export function PortalShell({
  user,
  allowedHrefs,
  branding,
  children,
}: {
  user: ShellUser;
  allowedHrefs: string[];
  branding: Branding;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const items = PORTAL_NAV.filter((i) => allowedHrefs.includes(i.href));
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

  const NavList = ({ onNavigate }: { onNavigate?: () => void }) => (
    <nav className="flex flex-col gap-1 px-3">
      {items.map((item) => {
        const matches = (href: string) => pathname === href || pathname.startsWith(href + "/");
        // Longest matching href wins, so a parent route (Settings) doesn't also
        // highlight on a child owned by another item (Reviews lives at
        // /portal/settings/reviews).
        const active = matches(item.href) && !items.some((o) => o.href.length > item.href.length && matches(o.href));
        const badge = item.href === "/portal/chat" && unread > 0 ? unread : null;
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            className={cn(
              "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
              active
                ? "bg-gold text-white shadow-sm"
                : "text-muted-foreground hover:bg-white/5 hover:text-foreground"
            )}
          >
            <item.icon className="size-[18px] shrink-0" />
            <span className="flex-1">{item.label}</span>
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

  return (
    <div className="portal-root flex min-h-screen bg-muted/30">
      {/* Desktop sidebar */}
      <aside className="dark fixed inset-y-0 left-0 hidden w-64 flex-col border-r border-white/10 bg-[#0c0c0e] text-foreground lg:flex">
        <div className="flex h-16 items-center border-b border-white/10 px-5">
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
        <div className="flex-1 overflow-y-auto py-4">
          <NavList />
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
      <div className="flex min-w-0 flex-1 flex-col lg:pl-64">
        <header className="dark sticky top-0 z-30 flex h-16 items-center justify-between gap-3 border-b border-white/10 bg-[#0c0c0e] px-4 text-foreground sm:px-6">
          <div className="flex items-center gap-3">
            {/* Mobile menu */}
            <Sheet>
              <SheetTrigger asChild>
                <Button variant="outline" size="icon" className="lg:hidden" aria-label="Open menu">
                  <Menu className="size-5" />
                </Button>
              </SheetTrigger>
              <SheetContent side="left" className="dark w-72 bg-[#0c0c0e] p-0 text-foreground">
                <SheetTitle className="sr-only">Navigation</SheetTitle>
                <div className="flex h-16 items-center border-b border-white/10 px-5">
                  <Logo href="/portal/dashboard" />
                </div>
                <div className="py-4">
                  <NavList />
                </div>
              </SheetContent>
            </Sheet>
            <div className="lg:hidden">
              <Logo href="/portal/dashboard" />
            </div>
          </div>

          <div className="flex items-center gap-3">
            <CommandPalette allowedHrefs={allowedHrefs} />
            <span className="hidden text-sm text-muted-foreground sm:inline">
              {user.roleLabel}
            </span>
            <NotificationBell />
            <UserMenu name={user.name} email={user.email} roleLabel={user.roleLabel} />
          </div>
        </header>

        <main className="min-w-0 flex-1 p-4 sm:p-6 lg:p-8">{children}</main>
      </div>
    </div>
  );
}
