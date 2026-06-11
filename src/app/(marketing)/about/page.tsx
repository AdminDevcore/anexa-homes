import type { Metadata } from "next";
import { PageHero } from "@/components/marketing/page-hero";
import { Section, SectionHeading } from "@/components/marketing/ui";
import { Reveal } from "@/components/marketing/reveal";
import { CtaBand } from "@/components/marketing/home-sections";
import { STATS, WHY_ANEXA } from "@/lib/site";

export const metadata: Metadata = {
  title: "About Anexa Homes",
  description:
    "Anexa Homes is North Texas' premium roofing and home improvement company — combining craftsmanship, insurance expertise, and a modern customer experience.",
};

export default function AboutPage() {
  return (
    <>
      <PageHero
        eyebrow="About Anexa Homes"
        title={
          <>
            Built on craftsmanship. <span className="gold-gradient-text">Driven by trust.</span>
          </>
        }
        description="Anexa Homes was founded to raise the standard for roofing and home improvement in North Texas — pairing elite craftsmanship with genuine, transparent service."
        image="/img/home-dusk.jpg"
      />

      <Section>
        <div className="grid items-start gap-12 lg:grid-cols-2">
          <SectionHeading
            eyebrow="Our Story"
            title="A different kind of home improvement company."
            description="We started Anexa Homes because homeowners deserved better — better workmanship, better communication, and a partner who actually fights for them through the insurance process."
          />
          <Reveal delay={1}>
            <div className="space-y-4 text-muted-foreground">
              <p>
                What began as a roofing crew with an obsession for doing things right has grown into a
                full-service home improvement company trusted by hundreds of North Texas families.
              </p>
              <p>
                Roofing remains our craft and our focus — but our mission is bigger: to protect homes,
                restore them after storms, and power better living through solar, HVAC, and clean water.
              </p>
              <p>
                Every project is backed by certified crews, premium materials, a modern customer portal,
                and warranties that mean something.
              </p>
            </div>
          </Reveal>
        </div>
      </Section>

      <Section className="bg-[#0B0B0C] text-white">
        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-white/10 bg-white/10 md:grid-cols-4">
          {STATS.map((s) => (
            <div key={s.label} className="bg-[#0B0B0C] p-8 text-center">
              <div className="font-display text-3xl font-semibold text-gold">{s.value}</div>
              <div className="mt-1 text-xs uppercase tracking-wider text-white/50">{s.label}</div>
            </div>
          ))}
        </div>
      </Section>

      <Section>
        <SectionHeading
          align="center"
          eyebrow="Our Values"
          title="The principles behind every project."
        />
        <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {WHY_ANEXA.map((w, i) => (
            <Reveal key={w.title} delay={i % 3}>
              <div className="h-full rounded-2xl border border-border bg-card p-7">
                <h3 className="font-display text-lg font-semibold">{w.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{w.body}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </Section>

      <CtaBand />
    </>
  );
}
