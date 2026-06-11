import Link from "next/link";
import Image from "next/image";
import {
  ArrowUpRight,
  Check,
  ShieldCheck,
  FileCheck2,
  Handshake,
  MapPin,
  Phone,
} from "lucide-react";
import { Section, SectionHeading } from "./ui";
import { Reveal } from "./reveal";
import { TiltCard } from "./tilt-card";
import { TestimonialsCarousel } from "./testimonials-carousel";
import { Button } from "@/components/ui/button";
import { GlassButton } from "./glass";
import {
  SERVICES,
  ROOFING_PROCESS,
  WHY_ANEXA,
  COMPANY,
} from "@/lib/site";

export function ServicesSection() {
  return (
    <Section id="services" className="bg-gradient-to-b from-muted/60 to-background">
      <SectionHeading
        eyebrow="What We Do"
        title="Complete home protection, under one trusted roof."
        description="Roofing is our craft — but Anexa Homes is your partner for everything that keeps a home safe, efficient, and comfortable."
      />
      <div className="mt-14 grid items-stretch gap-6 sm:grid-cols-2 lg:grid-cols-4">
        {SERVICES.map((s, i) => (
          <Reveal key={s.slug} delay={i % 4} className="h-full">
            <TiltCard className="h-full">
            <Link
              href={s.href}
              className="group flex h-full flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-sm transition-colors hover:border-gold/40 hover:shadow-xl hover:shadow-black/10"
            >
              <div className="relative aspect-[16/10] overflow-hidden">
                <Image
                  src={s.image}
                  alt={s.title}
                  fill
                  sizes="(min-width: 1024px) 23vw, (min-width: 640px) 45vw, 100vw"
                  className="object-cover transition-transform duration-500 group-hover:scale-105"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/55 via-black/10 to-transparent" />
                <span className="absolute left-4 top-4 grid size-11 place-items-center rounded-xl bg-background/90 text-gold-muted shadow-sm backdrop-blur">
                  <s.icon className="size-5" />
                </span>
                {s.primary && (
                  <span className="absolute right-4 top-4 rounded-full bg-gold px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-gold-foreground">
                    Core
                  </span>
                )}
                <h3 className="absolute bottom-3 left-4 font-display text-xl font-semibold text-white">
                  {s.title}
                </h3>
              </div>
              <div className="flex flex-1 flex-col p-6">
                <p className="flex-1 text-sm leading-relaxed text-muted-foreground">{s.description}</p>
                <span className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-gold-muted">
                  Learn more
                  <ArrowUpRight className="size-4 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
                </span>
              </div>
            </Link>
            </TiltCard>
          </Reveal>
        ))}
      </div>
    </Section>
  );
}

export function ProcessSection() {
  return (
    <Section className="bg-muted/40">
      <SectionHeading
        eyebrow="The Anexa Process"
        title="A roofing experience engineered to be effortless."
        description="From the first inspection to your final warranty, every step is documented, transparent, and handled by our team."
      />
      <div className="mt-14 grid gap-px overflow-hidden rounded-2xl border bg-border md:grid-cols-2 lg:grid-cols-3">
        {ROOFING_PROCESS.map((p, i) => (
          <Reveal key={p.step} delay={i % 3}>
            <div className="group h-full bg-card p-7 transition-colors hover:bg-card/60">
              <div className="flex items-center gap-3">
                <span className="font-display text-3xl font-semibold text-gold">{p.step}</span>
                <span className="h-px flex-1 bg-border" />
              </div>
              <h3 className="mt-4 font-display text-lg font-semibold">{p.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{p.body}</p>
            </div>
          </Reveal>
        ))}
      </div>
    </Section>
  );
}

export function InsuranceHelpSection() {
  const points = [
    { icon: ShieldCheck, title: "Free Damage Inspection", body: "We document hail and wind damage with photos and a detailed report." },
    { icon: Handshake, title: "We Meet Your Adjuster", body: "Our specialists attend the adjuster meeting to advocate for a fair scope." },
    { icon: FileCheck2, title: "Supplements & Depreciation", body: "We handle supplements and recover your depreciation so you pay only your deductible." },
  ];
  return (
    <Section className="bg-muted/40">
      <div className="grid items-center gap-12 lg:grid-cols-2">
        <Reveal>
          <div className="relative">
            <div className="absolute -inset-4 rounded-[2rem] bg-gold/10 blur-2xl" />
            <div className="relative aspect-[5/4] overflow-hidden rounded-3xl border border-border shadow-xl shadow-black/10">
              <Image
                src="/img/storm.jpg"
                alt="Storm-damaged home restored by Anexa Homes"
                fill
                sizes="(min-width: 1024px) 45vw, 100vw"
                className="object-cover"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/40 to-transparent" />
              <div className="absolute bottom-5 left-5 rounded-2xl border border-white/20 bg-black/45 px-5 py-3 text-white backdrop-blur-md">
                <div className="font-display text-2xl font-semibold">$18M+</div>
                <div className="text-xs text-white/70">recovered in insurance claims</div>
              </div>
            </div>
          </div>
        </Reveal>
        <div>
          <SectionHeading
            eyebrow="Storm & Insurance"
            title="Your claim, handled by people who do this every day."
            description="A new roof after a storm shouldn't mean fighting your insurance company alone. We manage the entire claim — start to finish."
          />
          <div className="mt-7 space-y-3">
            {points.map((p, i) => (
              <Reveal key={p.title} delay={i}>
                <div className="flex gap-4 rounded-2xl border border-border bg-card p-5">
                  <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-gold/12 text-gold-muted">
                    <p.icon className="size-5" />
                  </span>
                  <div>
                    <h3 className="font-semibold">{p.title}</h3>
                    <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{p.body}</p>
                  </div>
                </div>
              </Reveal>
            ))}
          </div>
          <Button asChild size="lg" className="mt-7 w-fit bg-gold text-gold-foreground hover:bg-gold/90">
            <Link href="/contact?type=claim">Start Your Claim Support</Link>
          </Button>
        </div>
      </div>
    </Section>
  );
}

export function WhyAnexaSection() {
  return (
    <Section className="bg-[#0B0B0C] text-white">
      <SectionHeading
        invert
        eyebrow="Why Anexa Homes"
        title="The standard for premium roofing in North Texas."
        description="We combine craftsmanship, insurance expertise, and a modern customer experience that other contractors simply can't match."
      />
      <div className="mt-14 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {WHY_ANEXA.map((w, i) => (
          <Reveal key={w.title} delay={i % 3}>
            <TiltCard className="h-full" max={7}>
              <div className="h-full rounded-2xl border border-white/10 bg-white/[0.03] p-7 transition-colors hover:border-gold/40">
                <span className="grid size-10 place-items-center rounded-lg bg-gold/15 text-gold">
                  <Check className="size-5" />
                </span>
                <h3 className="mt-5 font-display text-lg font-semibold text-white">{w.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-white/55">{w.body}</p>
              </div>
            </TiltCard>
          </Reveal>
        ))}
      </div>
    </Section>
  );
}

export function TestimonialsSection() {
  return (
    <Section>
      <SectionHeading
        align="center"
        eyebrow="Homeowner Reviews"
        title="Trusted by hundreds of North Texas families."
      />
      <div className="mt-14">
        <TestimonialsCarousel />
      </div>
    </Section>
  );
}

export function ServiceAreaSection() {
  return (
    <Section className="bg-muted/40">
      <div className="grid items-center gap-12 lg:grid-cols-2">
        <SectionHeading
          eyebrow="Service Area"
          title="Proudly serving the Dallas–Fort Worth metroplex."
          description="If a storm rolled through your neighborhood, we're likely already there. Don't see your city? Reach out — we're expanding fast."
        />
        <Reveal delay={1}>
          <div className="rounded-2xl border border-border bg-card p-7">
            <div className="flex flex-wrap gap-2.5">
              {COMPANY.serviceAreas.map((city) => (
                <span
                  key={city}
                  className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-3.5 py-1.5 text-sm font-medium"
                >
                  <MapPin className="size-3.5 text-gold" />
                  {city}
                </span>
              ))}
            </div>
            <div className="mt-6 flex items-center gap-3 rounded-xl bg-foreground/5 p-4">
              <Phone className="size-5 text-gold" />
              <div>
                <div className="text-sm text-muted-foreground">Talk to a specialist</div>
                <a href={COMPANY.phoneHref} className="font-display text-lg font-semibold">
                  {COMPANY.phone}
                </a>
              </div>
            </div>
          </div>
        </Reveal>
      </div>
    </Section>
  );
}

export function CtaBand({
  title = "Ready for a roof that protects what matters most?",
  subtitle = "Schedule your free, no-obligation inspection today. Most inspections are completed within 48 hours.",
  ctaLabel = "Request Free Inspection",
  ctaHref = "/contact",
}: {
  title?: string;
  subtitle?: string;
  ctaLabel?: string;
  ctaHref?: string;
}) {
  return (
    <section className="bg-gold">
      <div className="container-anexa flex flex-col items-center gap-6 py-16 text-center text-gold-foreground sm:py-20">
        <Reveal>
          <h2 className="max-w-3xl font-display text-3xl font-semibold tracking-tight sm:text-4xl">
            {title}
          </h2>
        </Reveal>
        <Reveal delay={1}>
          <p className="max-w-xl text-gold-foreground/80">{subtitle}</p>
        </Reveal>
        <Reveal delay={2}>
          <div className="flex flex-col items-center gap-3 sm:flex-row">
            <GlassButton href={ctaHref} variant="dark" size="lg">
              {ctaLabel}
            </GlassButton>
            <Button
              asChild
              size="lg"
              variant="outline"
              className="border-gold-foreground/30 bg-transparent text-gold-foreground hover:bg-gold-foreground/10"
            >
              <a href={COMPANY.phoneHref}>Call {COMPANY.phone}</a>
            </Button>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
