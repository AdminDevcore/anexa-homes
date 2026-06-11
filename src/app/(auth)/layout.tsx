import Link from "next/link";
import Image from "next/image";
import { Star } from "lucide-react";
import { headers } from "next/headers";
import { Logo } from "@/components/marketing/logo";
import { COMPANY } from "@/lib/site";
import { brandingForHost } from "@/server/branding/resolve";

export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  const host = (await headers()).get("host");
  const branding = await brandingForHost(host);
  const companyName = branding?.companyName ?? "Anexa Homes";
  const logoUrl = branding?.logoUrl ?? null;
  const removePoweredBy = branding?.removePoweredBy ?? false;

  return (
    <div className="dark grid min-h-screen bg-background text-foreground lg:grid-cols-2">
      {/* Brand panel */}
      <div className="relative hidden overflow-hidden bg-[#0B0B0C] text-white lg:flex lg:flex-col">
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute -top-32 left-1/3 size-[36rem] rounded-full bg-gold/10 blur-[120px]" />
        </div>
        <div className="relative flex items-center p-10">
          <Logo invert />
        </div>
        {/* Hero emblem — the "A" mark, with the wordmark stacked underneath. */}
        <div className="relative flex flex-1 flex-col items-center justify-center gap-6 px-10">
          {logoUrl ? (
            <Image
              src={logoUrl}
              alt={companyName}
              width={305}
              height={329}
              priority
              className="h-44 w-auto object-contain opacity-95 xl:h-56"
            />
          ) : (
            <Image
              src="/anexa-mark.png"
              alt="Anexa Homes"
              width={305}
              height={329}
              priority
              className="h-44 w-auto object-contain opacity-95 xl:h-56"
            />
          )}
          <span className="font-display text-2xl font-semibold uppercase tracking-[0.35em] text-white/90 xl:text-3xl">
            {companyName}
          </span>
        </div>
        <div className="relative p-10">
          <h2 className="max-w-md font-display text-3xl font-semibold leading-tight">
            {COMPANY.tagline}
          </h2>
          <p className="mt-4 max-w-md text-white/55">
            The secure portal for Anexa Homes customers and team members — projects, documents,
            and signatures in one place.
          </p>
          <div className="mt-8 flex items-center gap-2 text-sm text-white/55">
            <span className="flex">
              {Array.from({ length: 5 }).map((_, i) => (
                <Star key={i} className="size-4 fill-gold text-gold" />
              ))}
            </span>
            Trusted by 600+ homeowners
          </div>
          {!removePoweredBy && (
            <div className="mt-8 text-xs text-white/40">
              Powered by Anexa
            </div>
          )}
        </div>
      </div>

      {/* Form panel */}
      <div className="flex flex-col">
        <div className="flex items-center justify-between p-6 lg:hidden">
          <Logo />
        </div>
        <div className="flex flex-1 items-center justify-center p-6 sm:p-10">
          <div className="w-full max-w-md">{children}</div>
        </div>
        <div className="p-6 text-center text-xs text-muted-foreground">
          <Link href="/" className="hover:text-foreground">
            ← Back to anexahomes.com
          </Link>
        </div>
      </div>
    </div>
  );
}
