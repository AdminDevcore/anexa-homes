import type { Metadata } from "next";
import { Briefcase, TrendingUp, HeartHandshake, Trophy } from "lucide-react";
import { PageHero } from "@/components/marketing/page-hero";
import { Section, SectionHeading } from "@/components/marketing/ui";
import { Reveal } from "@/components/marketing/reveal";
import { ContactForm } from "@/components/marketing/contact-form";

export const metadata: Metadata = {
  title: "Careers — Join Our Team",
  description:
    "Build your career with Anexa Homes. We're hiring sales reps, project managers, and crews across North Texas.",
};

const ROLES = [
  { title: "Roofing Sales Consultant", type: "Full-time · Commission", desc: "Help homeowners through inspections and insurance claims. Uncapped earning potential." },
  { title: "Project Manager", type: "Full-time", desc: "Own production from contract to closeout, coordinating crews and quality." },
  { title: "Installation Crew / Lead", type: "Full-time", desc: "Install premium roofing systems with our certified production teams." },
  { title: "Office Coordinator", type: "Full-time", desc: "Keep operations running smoothly — scheduling, documents, and customer care." },
];

const PERKS = [
  { icon: TrendingUp, title: "Uncapped Growth", body: "Top performers earn six figures with clear paths to leadership." },
  { icon: HeartHandshake, title: "Real Support", body: "Best-in-class tools, training, and a team that has your back." },
  { icon: Trophy, title: "Win Together", body: "A culture that celebrates results, integrity, and craftsmanship." },
];

export default function CareersPage() {
  return (
    <>
      <PageHero
        eyebrow="Careers"
        title={
          <>
            Build your career with <span className="gold-gradient-text">Anexa Homes.</span>
          </>
        }
        description="We're growing fast and looking for driven people who care about quality and homeowners. If that's you, let's talk."
        image="/img/crew.jpg"
        primaryCta={{ label: "Apply Now", href: "#apply" }}
      />

      <Section>
        <SectionHeading
          align="center"
          eyebrow="Why Work Here"
          title="A place to do the best work of your career."
        />
        <div className="mt-12 grid gap-5 md:grid-cols-3">
          {PERKS.map((p, i) => (
            <Reveal key={p.title} delay={i}>
              <div className="h-full rounded-2xl border border-border bg-card p-7 text-center">
                <span className="mx-auto grid size-12 place-items-center rounded-xl bg-gold/12 text-gold-muted">
                  <p.icon className="size-6" />
                </span>
                <h3 className="mt-5 font-display text-lg font-semibold">{p.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{p.body}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </Section>

      <Section className="bg-muted/40">
        <SectionHeading eyebrow="Open Roles" title="Current openings." />
        <div className="mt-10 grid gap-4 md:grid-cols-2">
          {ROLES.map((r, i) => (
            <Reveal key={r.title} delay={i % 2}>
              <div className="flex h-full items-start gap-4 rounded-2xl border border-border bg-card p-6">
                <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-foreground text-background">
                  <Briefcase className="size-5" />
                </span>
                <div>
                  <h3 className="font-display text-lg font-semibold">{r.title}</h3>
                  <p className="text-xs font-medium uppercase tracking-wider text-gold-muted">{r.type}</p>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{r.desc}</p>
                </div>
              </div>
            </Reveal>
          ))}
        </div>
      </Section>

      <Section id="apply">
        <div className="grid items-start gap-12 lg:grid-cols-2">
          <SectionHeading
            eyebrow="Apply"
            title="Tell us about yourself."
            description="Submit your interest and our hiring team will be in touch. Mention the role you're interested in and a bit about your experience."
          />
          <ContactForm
            defaultType="careers"
            hideProperty
            hideService
            submitLabel="Submit Application"
            messageLabel="Role of interest & experience"
            messagePlaceholder="Which role are you applying for? Tell us about your experience…"
            successText="Thanks for your interest in Anexa Homes! Our hiring team will review your application and reach out soon."
          />
        </div>
      </Section>
    </>
  );
}
