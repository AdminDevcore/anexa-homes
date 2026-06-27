import Image from "next/image";
import Link from "next/link";
import { Check, AlertTriangle, ArrowUpRight, ImageIcon } from "lucide-react";
import { COMPANY } from "@/lib/site";
import { serviceContent, serviceFor } from "@/lib/service-content";
import { PageHero } from "./page-hero";
import { Section, SectionHeading } from "./ui";
import { Reveal } from "./reveal";
import { FaqAccordion } from "./faq-section";
import { ContactForm } from "./contact-form";
import { CtaBand } from "./home-sections";

export function ServicePage({ slug }: { slug: string }) {
  const service = serviceFor(slug);
  const c = serviceContent(slug);
  const ctaLabel = service.ctaLabel ?? "Request Free Estimate";
  const ctaHref = `/contact?service=${service.slug}`;
  const isClaim = slug === "insurance-claims";

  return (
    <>
      <PageHero
        eyebrow={service.title}
        title={
          <>
            {c.heroLead}
            <span className="gold-gradient-text">{c.heroHighlight}</span>
            {c.heroTail}
          </>
        }
        description={c.heroDescription}
        image={service.image}
        imagePosition={c.heroPosition}
        primaryCta={{ label: ctaLabel, href: ctaHref }}
        secondaryCta={{ label: `Call ${COMPANY.phone}`, href: COMPANY.phoneHref }}
      />

      {/* Overview + feature checklist */}
      <Section>
        <div className="grid items-center gap-12 lg:grid-cols-2">
          <div>
            <SectionHeading eyebrow="Overview" title={c.overviewTitle} description={c.overviewBody} />
            <ul className="mt-7 grid gap-3 sm:grid-cols-2">
              {service.features.map((f) => (
                <li key={f} className="flex items-center gap-2.5 text-sm font-medium">
                  <span className="grid size-6 shrink-0 place-items-center rounded-full bg-[var(--metal)]/[0.15] text-metal-dim">
                    <Check className="size-3.5" />
                  </span>
                  {f}
                </li>
              ))}
            </ul>
          </div>
          <Reveal delay={1}>
            <div className="relative">
              <div className="absolute -inset-4 rounded-[2rem] bg-white/[0.06] blur-2xl" />
              <div className="relative aspect-[4/3] overflow-hidden rounded-3xl border border-border shadow-xl shadow-black/10">
                <Image
                  src={service.image}
                  alt={`${service.title} by Anexa Homes`}
                  fill
                  sizes="(min-width: 1024px) 45vw, 100vw"
                  className="object-cover"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/35 to-transparent" />
              </div>
            </div>
          </Reveal>
        </div>
      </Section>

      {/* Pain points */}
      <Section className="bg-[#0B0B0C] text-white">
        <SectionHeading invert eyebrow="The Problem" title={c.problemsTitle} description={c.problemsIntro} />
        <div className="mt-12 grid gap-5 md:grid-cols-3">
          {c.problems.map((p, i) => (
            <Reveal key={p.title} delay={i % 3}>
              <div className="h-full rounded-2xl border border-white/10 bg-white/[0.03] p-7">
                <span className="grid size-10 place-items-center rounded-lg bg-amber-400/15 text-amber-300">
                  <AlertTriangle className="size-5" />
                </span>
                <h3 className="mt-5 font-display text-lg font-semibold text-white">{p.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-white/55">{p.body}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </Section>

      {/* What Anexa does — benefits */}
      <Section className="bg-muted/40">
        <SectionHeading
          eyebrow="What Anexa Does"
          title={`What sets our ${service.title.toLowerCase()} service apart.`}
        />
        <div className="mt-12 grid gap-5 md:grid-cols-3">
          {c.benefits.map((b, i) => (
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

      {/* Step-by-step process */}
      <Section>
        <SectionHeading
          eyebrow="Our Process"
          title="A clear, documented path from start to finish."
          description="Every step is transparent, photographed, and handled by our team — so you always know what's happening next."
        />
        <div className="mt-12 grid gap-px overflow-hidden rounded-2xl border bg-border md:grid-cols-2 lg:grid-cols-3">
          {c.process.map((p, i) => (
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

      {/* Project gallery (placeholders — clearly replaceable) */}
      <Section className="bg-muted/40">
        <SectionHeading
          eyebrow="Real Projects"
          title="See the difference in the details."
          description="A look at the kind of work we deliver. Replace these with your own project photos any time."
        />
        <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {c.gallery.map((caption, i) => (
            <Reveal key={caption} delay={i % 4}>
              <figure className="group relative aspect-[4/5] overflow-hidden rounded-2xl border border-border">
                <Image
                  src={service.image}
                  alt={caption}
                  fill
                  sizes="(min-width: 1024px) 23vw, (min-width: 640px) 45vw, 100vw"
                  className="object-cover opacity-90 transition-transform duration-500 group-hover:scale-105"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/15 to-transparent" />
                <span className="absolute right-3 top-3 inline-flex items-center gap-1 rounded-full bg-black/55 px-2 py-1 text-[10px] font-medium uppercase tracking-wider text-white/80 backdrop-blur">
                  <ImageIcon className="size-3" /> Sample
                </span>
                <figcaption className="absolute bottom-3 left-4 right-4 text-sm font-medium text-white">
                  {caption}
                </figcaption>
              </figure>
            </Reveal>
          ))}
        </div>
      </Section>

      {/* FAQs */}
      <Section>
        <div className="grid gap-12 lg:grid-cols-[0.85fr_1.15fr]">
          <SectionHeading
            eyebrow="FAQ"
            title={`${service.title} questions, answered.`}
            description="Don't see your question? Reach out — a specialist will walk you through it."
          />
          <FaqAccordion items={c.faqs} />
        </div>
      </Section>

      {/* CTA form */}
      <Section className="bg-[#0B0B0C] text-white">
        <div className="grid items-start gap-12 lg:grid-cols-2">
          <SectionHeading
            invert
            eyebrow="Get Started"
            title={isClaim ? "Start your insurance claim support." : `Request your free ${service.title.toLowerCase()} estimate.`}
            description={
              isClaim
                ? "Tell us about your storm damage and a claim specialist will reach out within 24 hours."
                : `Tell us about your project and a specialist will reach out within 24 hours.`
            }
          />
          <ContactForm
            defaultType={isClaim ? "claim" : "inspection"}
            defaultService={service.slug}
            hideService
            submitLabel={ctaLabel}
            messageLabel="Tell us about your project"
            messagePlaceholder={`A few details about your ${service.title.toLowerCase()} needs…`}
          />
        </div>
      </Section>

      {/* Related services */}
      <Section>
        <SectionHeading eyebrow="Explore More" title="One team for your whole home." />
        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {c.related.map((rs) => {
            const r = serviceFor(rs);
            return (
              <Link
                key={rs}
                href={r.href}
                className="group flex items-center justify-between gap-3 rounded-2xl border border-border bg-card p-5 transition-colors hover:border-[var(--metal)]/40"
              >
                <span className="flex items-center gap-3">
                  <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-foreground text-background transition-colors group-hover:bg-gold group-hover:text-gold-foreground">
                    <r.icon className="size-5" />
                  </span>
                  <span className="font-medium">{r.title}</span>
                </span>
                <ArrowUpRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
              </Link>
            );
          })}
        </div>
      </Section>

      <CtaBand
        title={isClaim ? "Don't navigate your claim alone." : `Ready to move forward with ${service.title.toLowerCase()}?`}
        subtitle={
          isClaim
            ? "Get a free, no-obligation damage inspection and let our specialists handle the claim."
            : `Get a free, no-obligation ${service.title.toLowerCase()} estimate from our specialists.`
        }
        ctaLabel={ctaLabel}
        ctaHref={ctaHref}
      />
    </>
  );
}
