"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, LogIn } from "lucide-react";
import { cn } from "@/lib/utils";
import { NAV_LINKS, COMPANY, SERVICES } from "@/lib/site";
import { Logo } from "./logo";
import { AnimatedLogo } from "./animated-logo";
import { GlassButton } from "./glass";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
  SheetClose,
} from "@/components/ui/sheet";

export function SiteHeader() {
  const [scrolled, setScrolled] = React.useState(false);
  const [productsOpen, setProductsOpen] = React.useState(false);
  const pathname = usePathname();
  const closeTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  React.useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 16);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  function openProducts() {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    setProductsOpen(true);
  }
  function scheduleClose() {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => setProductsOpen(false), 120);
  }

  return (
    <header
      className={cn(
        "sticky top-0 z-50 w-full transition-all duration-300",
        scrolled
          ? "border-b border-border/70 bg-background/85 backdrop-blur-xl"
          : "border-b border-transparent bg-transparent"
      )}
    >
      <div className="container-anexa flex h-20 items-center justify-between gap-4 py-3 lg:h-24">
        <AnimatedLogo />

        {/* Right cluster: nav links, then login + CTA (logo stays far left). */}
        <div className="hidden items-center gap-6 lg:flex">
        <nav className="flex items-center gap-1">
          {/* Products hover mega-menu (no arrow) */}
          <div className="relative" onMouseEnter={openProducts} onMouseLeave={scheduleClose}>
            <button
              type="button"
              onClick={() => setProductsOpen((v) => !v)}
              className={cn(
                "rounded-md px-3 py-2 text-sm font-medium transition-colors",
                productsOpen ? "text-foreground" : "text-muted-foreground hover:text-foreground"
              )}
              aria-expanded={productsOpen}
            >
              Products
            </button>

            <div
              className={cn(
                // Anchored to the button's right edge so the wide (46rem) panel
                // expands leftward into open space instead of off the right edge
                // of the viewport (which created a horizontal-overflow gutter).
                "absolute right-0 top-full pt-3 transition-all duration-150",
                productsOpen
                  ? "pointer-events-auto translate-y-0 opacity-100"
                  : "pointer-events-none -translate-y-1 opacity-0"
              )}
            >
              <div className="w-[34rem] xl:w-[46rem] rounded-2xl border border-border bg-background p-3 shadow-xl shadow-black/5">
                <div className="grid grid-cols-3 gap-1">
                  {SERVICES.map((s) => (
                    <Link
                      key={s.slug}
                      href={s.href}
                      onClick={() => setProductsOpen(false)}
                      className="group flex items-start gap-3 rounded-xl p-3 transition-colors hover:bg-muted"
                    >
                      <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-foreground text-background transition-colors group-hover:bg-gold group-hover:text-gold-foreground">
                        <s.icon className="size-5" />
                      </span>
                      <span className="flex flex-col">
                        <span className="text-sm font-semibold">{s.title}</span>
                        <span className="text-xs text-muted-foreground">{s.short}</span>
                      </span>
                    </Link>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {NAV_LINKS.map((link) => {
            const active = pathname === link.href;
            return (
              <Link
                key={link.href}
                href={link.href}
                className={cn(
                  "rounded-md px-3 py-2 text-sm font-medium transition-colors",
                  active ? "text-foreground" : "text-muted-foreground hover:text-foreground"
                )}
              >
                {link.label}
              </Link>
            );
          })}
        </nav>

        <div className="flex items-center gap-2">
          <Button asChild variant="ghost" size="sm" className="gap-1.5">
            <Link href="/login">
              <LogIn className="size-4" />
              Login
            </Link>
          </Button>

          <GlassButton href="/contact" variant="gold" size="sm">
            Free Estimate
          </GlassButton>
        </div>
        </div>

        {/* Mobile */}
        <div className="flex items-center gap-2 lg:hidden">
          <GlassButton href="/contact" variant="gold" size="sm">
            Free Estimate
          </GlassButton>
          <Sheet>
            <SheetTrigger asChild>
              <Button variant="outline" size="icon" aria-label="Open menu">
                <Menu className="size-5" />
              </Button>
            </SheetTrigger>
            <SheetContent side="right" className="dark w-[88vw] max-w-sm overflow-y-auto bg-background text-foreground">
              <SheetHeader>
                <SheetTitle>
                  <Logo />
                </SheetTitle>
              </SheetHeader>
              <div className="px-4">
                <p className="px-3 pb-1 pt-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Products
                </p>
                <div className="flex flex-col">
                  {SERVICES.map((s) => (
                    <SheetClose asChild key={s.slug}>
                      <Link
                        href={s.href}
                        className="flex items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium hover:bg-muted"
                      >
                        <s.icon className="size-4 text-metal" />
                        {s.title}
                      </Link>
                    </SheetClose>
                  ))}
                </div>
              </div>
              <div className="mt-2 flex flex-col gap-1 border-t px-4 pt-3">
                {NAV_LINKS.map((link) => (
                  <SheetClose asChild key={link.href}>
                    <Link href={link.href} className="rounded-md px-3 py-2.5 text-base font-medium hover:bg-muted">
                      {link.label}
                    </Link>
                  </SheetClose>
                ))}
              </div>
              <div className="mt-2 border-t px-4 pt-4">
                <SheetClose asChild>
                  <Link href="/login" className="flex items-center gap-2.5 rounded-md px-3 py-2.5 text-sm font-medium hover:bg-muted">
                    <LogIn className="size-4 text-metal" />
                    Login
                  </Link>
                </SheetClose>
              </div>
              <div className="mt-4 border-t p-4">
                <a href={COMPANY.phoneHref} className="text-sm font-medium text-muted-foreground">
                  Call us: <span className="text-foreground">{COMPANY.phone}</span>
                </a>
              </div>
            </SheetContent>
          </Sheet>
        </div>
      </div>
    </header>
  );
}
