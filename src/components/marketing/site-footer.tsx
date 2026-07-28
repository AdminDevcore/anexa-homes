import Link from "next/link";
import { Phone, Mail, MapPin } from "lucide-react";
import { Logo } from "./logo";
import { COMPANY, NAV_LINKS, SERVICES } from "@/lib/site";

export function SiteFooter() {
  return (
    <footer className="mt-auto border-t border-white/10 bg-[#0B0B0C] text-white">
      <div className="container-anexa grid gap-12 py-16 md:grid-cols-2 lg:grid-cols-4">
        <div className="space-y-4">
          <Logo invert />
          <p className="max-w-xs text-sm leading-relaxed text-white/60">
            {COMPANY.tagline}
          </p>
          <p className="text-xs text-white/40">
            Premium roofing, solar, and home improvement across North Texas.
          </p>
        </div>

        <div>
          <h4 className="mb-4 text-sm font-semibold uppercase tracking-wider text-metal">
            Services
          </h4>
          <ul className="space-y-2.5 text-sm">
            {SERVICES.map((s) => (
              <li key={s.slug}>
                <Link href={s.href} className="text-white/65 transition-colors hover:text-white">
                  {s.title}
                </Link>
              </li>
            ))}
          </ul>
        </div>

        <div>
          <h4 className="mb-4 text-sm font-semibold uppercase tracking-wider text-metal">
            Company
          </h4>
          <ul className="space-y-2.5 text-sm">
            {NAV_LINKS.filter((l) => ["/about", "/careers"].includes(l.href)).map(
              (l) => (
                <li key={l.href}>
                  <Link href={l.href} className="text-white/65 transition-colors hover:text-white">
                    {l.label}
                  </Link>
                </li>
              )
            )}
            <li>
              <Link href="/reviews" className="text-white/65 transition-colors hover:text-white">
                Reviews
              </Link>
            </li>
            <li>
              <Link href="/contact" className="text-white/65 transition-colors hover:text-white">
                Request Inspection
              </Link>
            </li>
            <li>
              <Link href="/login" className="text-white/65 transition-colors hover:text-white">
                Login
              </Link>
            </li>
          </ul>
        </div>

        <div>
          <h4 className="mb-4 text-sm font-semibold uppercase tracking-wider text-metal">
            Contact
          </h4>
          <ul className="space-y-3 text-sm text-white/65">
            <li className="flex items-center gap-2.5">
              <Phone className="size-4 text-metal" />
              <a href={COMPANY.phoneHref} className="hover:text-white">
                {COMPANY.phone}
              </a>
            </li>
            <li className="flex items-center gap-2.5">
              <Mail className="size-4 text-metal" />
              <a href={`mailto:${COMPANY.email}`} className="hover:text-white">
                {COMPANY.email}
              </a>
            </li>
            <li className="flex items-start gap-2.5">
              <MapPin className="mt-0.5 size-4 text-metal" />
              <span>{COMPANY.address}</span>
            </li>
          </ul>
        </div>
      </div>

      <div className="border-t border-white/10">
        <div className="container-anexa flex flex-col items-center justify-between gap-3 py-6 text-xs text-white/40 sm:flex-row">
          <p>© {new Date().getFullYear()} {COMPANY.name}. All rights reserved.</p>
          <p className="flex items-center gap-1.5">
            Licensed & Insured · TX
          </p>
        </div>
      </div>
    </footer>
  );
}
