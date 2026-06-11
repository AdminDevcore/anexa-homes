import Image from "next/image";
import { Check } from "lucide-react";
import { COMPANY, type Service } from "@/lib/site";
import { PageHero } from "./page-hero";
import { Section, SectionHeading } from "./ui";
import { Reveal } from "./reveal";
import { CtaBand } from "./home-sections";

export type ServicePageProps = {
  service: Service;
  heroTitle: React.ReactNode;
  heroDescription: string;
  overviewTitle: string;
  overviewBody: string;
  benefits: { title: string; body: string }[];
  claimSupport?: boolean;
};

export function ServicePage({
  service,
  heroTitle,
  heroDescription,
  overviewTitle,
  overviewBody,
  benefits,
}: ServicePageProps) {
  const ctaLabel = service.ctaLabel ?? "Request Free Estimate";
  const ctaHref = `/contact?service=${service.slug}`;
  const isRoofingFamily = service.slug === "roofing";
  return (
    <>
      <PageHero
        eyebrow={service.title}
        title={heroTitle}
        description={heroDescription}
        image={service.image}
        primaryCta={{ label: ctaLabel, href: ctaHref }}
        secondaryCta={{ label: `Call ${COMPANY.phone}`, href: COMPANY.phoneHref }}
      />

      <Section>
        <div className="grid items-center gap-12 lg:grid-cols-2">
          <div>
            <SectionHeading eyebrow="Overview" title={overviewTitle} description={overviewBody} />
            <ul className="mt-7 grid gap-3 sm:grid-cols-2">
              {service.features.map((f) => (
                <li key={f} className="flex items-center gap-2.5 text-sm font-medium">
                  <span className="grid size-6 shrink-0 place-items-center rounded-full bg-gold/15 text-gold-muted">
                    <Check className="size-3.5" />
                  </span>
                  {f}
                </li>
              ))}
            </ul>
          </div>
          <Reveal delay={1}>
            <div className="relative aspect-[4/3] overflow-hidden rounded-3xl border border-border shadow-xl shadow-black/10">
              <Image
                src={service.image}
                alt={`${service.title} by Anexa Homes`}
                fill
                sizes="(min-width: 1024px) 45vw, 100vw"
                className="object-cover"
              />
            </div>
          </Reveal>
        </div>
      </Section>

      <Section className="bg-muted/40">
        <SectionHeading
          eyebrow="Why Choose Anexa"
          title={`What sets our ${service.title.toLowerCase()} service apart.`}
        />
        <div className="mt-12 grid gap-5 md:grid-cols-3">
          {benefits.map((b, i) => (
            <Reveal key={b.title} delay={i % 3}>
              <div className="h-full rounded-2xl border border-border bg-card p-7">
                <span className="grid size-11 place-items-center rounded-xl bg-foreground text-background">
                  <service.icon className="size-5" />
                </span>
                <h3 className="mt-5 font-display text-lg font-semibold">{b.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{b.body}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </Section>

      <CtaBand
        title={
          isRoofingFamily
            ? "Ready for a roof that protects what matters most?"
            : `Ready to upgrade your home with ${service.title.toLowerCase()}?`
        }
        subtitle={
          isRoofingFamily
            ? "Schedule your free, no-obligation inspection today."
            : `Get a free, no-obligation ${service.title.toLowerCase()} estimate from our specialists.`
        }
        ctaLabel={ctaLabel}
        ctaHref={ctaHref}
      />
    </>
  );
}
