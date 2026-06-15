import Link from "next/link";
import Image from "next/image";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Eyebrow } from "./ui";

export function PageHero({
  eyebrow,
  title,
  description,
  image,
  primaryCta = { label: "Request Free Inspection", href: "/contact" },
  secondaryCta,
}: {
  eyebrow: string;
  title: React.ReactNode;
  description: string;
  image?: string;
  primaryCta?: { label: string; href: string };
  secondaryCta?: { label: string; href: string };
}) {
  return (
    <section className="relative overflow-hidden bg-[#0B0B0C] text-white">
      {image ? (
        <>
          <Image
            src={image}
            alt=""
            fill
            priority
            sizes="100vw"
            className="object-cover opacity-40"
          />
          <div className="absolute inset-0 bg-gradient-to-r from-[#0B0B0C] via-[#0B0B0C]/85 to-[#0B0B0C]/40" />
          <div className="absolute inset-0 bg-gradient-to-t from-[#0B0B0C] to-transparent" />
        </>
      ) : (
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute -top-32 right-0 size-[36rem] rounded-full bg-white/[0.06] blur-[120px]" />
        </div>
      )}
      <div className="container-anexa relative py-24 sm:py-32">
        <Eyebrow>{eyebrow}</Eyebrow>
        <h1 className="mt-5 max-w-3xl font-display text-4xl font-semibold leading-[1.08] tracking-tight sm:text-5xl md:text-6xl">
          {title}
        </h1>
        <p className="mt-5 max-w-2xl text-lg leading-relaxed text-white/70">{description}</p>
        <div className="mt-8 flex flex-col gap-3 sm:flex-row">
          <Button asChild size="lg" className="group bg-gold text-gold-foreground hover:bg-gold/90">
            <Link href={primaryCta.href}>
              {primaryCta.label}
              <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
            </Link>
          </Button>
          {secondaryCta && (
            <Button
              asChild
              size="lg"
              variant="outline"
              className="border-white/25 bg-white/5 text-white hover:bg-white/10 hover:text-white"
            >
              <Link href={secondaryCta.href}>{secondaryCta.label}</Link>
            </Button>
          )}
        </div>
      </div>
    </section>
  );
}
