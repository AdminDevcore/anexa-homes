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
  CloudLightning,
  Droplet,
  Layers,
  Home as HomeIcon,
  Wind as WindIcon,
  CalendarClock,
  Smartphone,
  FileSignature,
  Images,
  MessageSquare,
  BellRing,
  Wallet,
  BadgeCheck,
  CircleDollarSign,
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
  TESTIMONIALS,
  COMPANY,
} from "@/lib/site";
import { getPublicReviews, getPublicReviewStats } from "@/server/modules/reviews/public";
import type { CarouselReview } from "./testimonials-carousel";

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
              className="group flex h-full flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-sm transition-colors hover:border-[var(--metal)]/40 hover:shadow-xl hover:shadow-black/10"
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
                <span className="absolute left-4 top-4 grid size-11 place-items-center rounded-xl bg-background/90 text-metal-dim shadow-sm backdrop-blur">
                  <s.icon className="size-5" />
                </span>
                {s.primary && (
                  <span className="metal-fill absolute right-4 top-4 rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider">
                    Core
                  </span>
                )}
                <h3 className="absolute bottom-3 left-4 font-display text-xl font-semibold text-white">
                  {s.title}
                </h3>
              </div>
              <div className="flex flex-1 flex-col p-6">
                <p className="flex-1 text-sm leading-relaxed text-muted-foreground">{s.description}</p>
                <span className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-metal-dim">
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
                <span className="font-display text-3xl font-semibold text-metal">{p.step}</span>
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
            <div className="absolute -inset-4 rounded-[2rem] bg-white/[0.06] blur-2xl" />
            <div className="relative aspect-[5/4] overflow-hidden rounded-3xl border border-border shadow-xl shadow-black/10">
              <Image
                src="/img/storm-restoration.jpg"
                alt="Storm-damaged home documented and restored by Anexa Homes"
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
                  <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-[var(--metal)]/[0.12] text-metal-dim">
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

export function StormWarningSignsSection() {
  const signs = [
    { icon: Layers, title: "Missing or curling shingles", body: "Wind lifts and tears shingles, leaving gaps where water gets in." },
    { icon: Droplet, title: "Granules in your gutters", body: "Shingle granules washing out is an early sign of hail or aging damage." },
    { icon: CloudLightning, title: "Dented vents & flashing", body: "Soft-metal dents on vents and flashing usually mean hail hit your roof too." },
    { icon: HomeIcon, title: "Interior stains or leaks", body: "Ceiling spots and attic moisture point to a roof that's already failing." },
    { icon: CalendarClock, title: "A roof 15+ years old", body: "Older roofs are far more vulnerable to storms and overdue for inspection." },
    { icon: WindIcon, title: "Neighbors getting roofs", body: "If a storm hit your street, your roof was likely affected too." },
  ];
  return (
    <Section className="bg-muted/40">
      <SectionHeading
        align="center"
        eyebrow="Storm Damage"
        title="Warning signs your roof needs a look."
        description="Storm damage is rarely obvious from the ground. If any of these sound familiar, a free inspection is worth it — and there's often a claim deadline."
      />
      <div className="mt-14 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {signs.map((s, i) => (
          <Reveal key={s.title} delay={i % 3}>
            <div className="flex h-full gap-4 rounded-2xl border border-border bg-card p-6">
              <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-amber-400/15 text-amber-600 dark:text-amber-400">
                <s.icon className="size-5" />
              </span>
              <div>
                <h3 className="font-semibold">{s.title}</h3>
                <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{s.body}</p>
              </div>
            </div>
          </Reveal>
        ))}
      </div>
      <div className="mt-10 flex justify-center">
        <GlassButton href="/contact" variant="gold" size="lg">
          Schedule a Free Inspection
        </GlassButton>
      </div>
    </Section>
  );
}

export function DigitalPortalSection() {
  const features = [
    { icon: FileSignature, title: "Sign from your phone", body: "Review and sign your agreement digitally — no printing, no waiting." },
    { icon: Images, title: "Every photo, organized", body: "Inspection and install photos documented and saved to your project." },
    { icon: MessageSquare, title: "Message your team", body: "Questions get answered fast, with everything in one thread." },
    { icon: BellRing, title: "Real-time status", body: "Know exactly what's happening — from inspection to final walkthrough." },
  ];
  return (
    <Section className="bg-[#0B0B0C] text-white">
      <div className="grid items-center gap-12 lg:grid-cols-2">
        <div>
          <SectionHeading
            invert
            eyebrow="Digital Customer Portal"
            title="Your whole project, in your pocket."
            description="Home upgrades should feel organized from inspection to completion. Our customer portal keeps your documents, photos, and project status in one place — so you always know what's happening next."
          />
          <Button asChild size="lg" className="mt-7 w-fit bg-gold text-gold-foreground hover:bg-gold/90">
            <Link href="/contact">Get Started</Link>
          </Button>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          {features.map((f, i) => (
            <Reveal key={f.title} delay={i % 2}>
              <TiltCard className="h-full" max={7}>
                <div className="h-full rounded-2xl border border-white/10 bg-white/[0.03] p-6">
                  <span className="grid size-10 place-items-center rounded-lg bg-[var(--metal)]/[0.15] text-metal">
                    <f.icon className="size-5" />
                  </span>
                  <h3 className="mt-4 font-semibold text-white">{f.title}</h3>
                  <p className="mt-1.5 text-sm leading-relaxed text-white/55">{f.body}</p>
                </div>
              </TiltCard>
            </Reveal>
          ))}
        </div>
      </div>
    </Section>
  );
}

export function FinancingSection() {
  const options = [
    { icon: Wallet, title: "Flexible Financing", body: "Affordable monthly plans for qualified homeowners — upgrade now, pay over time." },
    { icon: BadgeCheck, title: "Insurance-Friendly", body: "On approved storm claims, your out-of-pocket is typically just your deductible." },
    { icon: CircleDollarSign, title: "Transparent Pricing", body: "Clear, line-item quotes with no hidden fees and no surprise change orders." },
  ];
  return (
    <Section>
      <SectionHeading
        align="center"
        eyebrow="Financing & Payment"
        title="Options that make it easy to say yes."
        description="From insurance claims to flexible financing, we make premium home improvement affordable and straightforward."
      />
      <div className="mt-14 grid gap-5 md:grid-cols-3">
        {options.map((o, i) => (
          <Reveal key={o.title} delay={i % 3}>
            <div className="h-full rounded-2xl border border-border bg-card p-7 text-center">
              <span className="mx-auto grid size-12 place-items-center rounded-xl bg-gold/12 text-gold-muted">
                <o.icon className="size-6" />
              </span>
              <h3 className="mt-5 font-display text-lg font-semibold">{o.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{o.body}</p>
            </div>
          </Reveal>
        ))}
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
              <div className="h-full rounded-2xl border border-white/10 bg-white/[0.03] p-7 transition-colors hover:border-[var(--metal)]/40">
                <span className="grid size-10 place-items-center rounded-lg bg-[var(--metal)]/[0.15] text-metal">
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

export async function TestimonialsSection() {
  // Show ONLY real approved reviews once any exist (so the count badge matches
  // and we never present placeholder testimonials as real). Seed quotes are a
  // last-resort filler only when there are zero real reviews yet.
  const [approved, stats] = await Promise.all([getPublicReviews(12), getPublicReviewStats()]);
  const seed: CarouselReview[] = TESTIMONIALS.map((t) => ({
    name: t.name,
    location: t.location,
    service: null,
    rating: t.rating,
    quote: t.quote,
  }));
  const items: CarouselReview[] = approved.length > 0 ? approved : seed;

  return (
    <Section>
      <SectionHeading
        align="center"
        eyebrow="Homeowner Reviews"
        title="Trusted by hundreds of North Texas families."
        description="Real reviews from homeowners across the Dallas–Fort Worth metroplex."
      />
      <div className="mt-14">
        <TestimonialsCarousel items={items} stats={stats} />
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
                  <MapPin className="size-3.5 text-metal" />
                  {city}
                </span>
              ))}
            </div>
            <div className="mt-6 flex items-center gap-3 rounded-xl bg-foreground/5 p-4">
              <Phone className="size-5 text-metal" />
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
