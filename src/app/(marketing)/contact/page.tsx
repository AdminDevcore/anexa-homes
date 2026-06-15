import type { Metadata } from "next";
import { Phone, Mail, MapPin, Clock } from "lucide-react";
import { PageHero } from "@/components/marketing/page-hero";
import { Section } from "@/components/marketing/ui";
import { ContactForm } from "@/components/marketing/contact-form";
import { COMPANY, SERVICES } from "@/lib/site";

export const metadata: Metadata = {
  title: "Contact & Request Estimate",
  description:
    "Request your free roof inspection, estimate, or insurance claim support with Anexa Homes. We respond within 24 hours.",
};

export default async function ContactPage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string; service?: string }>;
}) {
  const { type, service } = await searchParams;
  const isClaim = type === "claim";
  const svc = service ? SERVICES.find((s) => s.slug === service) : undefined;
  const isRoofingFamily = !svc || svc.slug === "roofing";

  const word = isRoofingFamily ? "inspection" : "estimate";
  const submitLabel = isClaim
    ? "Start Claim Support"
    : svc?.ctaLabel ?? "Request Free Inspection";

  const heroTitle = isClaim ? (
    <>Start your <span className="gold-gradient-text">insurance claim</span> support.</>
  ) : svc && !isRoofingFamily ? (
    <>Request your free <span className="gold-gradient-text">{svc.title.toLowerCase()}</span> estimate.</>
  ) : (
    <>Request your <span className="gold-gradient-text">free {word}.</span></>
  );

  return (
    <>
      <PageHero
        eyebrow={isClaim ? "Insurance Claim Support" : svc ? svc.title : "Request Estimate"}
        title={heroTitle}
        description={
          isClaim
            ? "Tell us about your storm damage and our claim specialists will guide you through the entire process."
            : `Tell us about your property and a specialist will reach out within 24 hours${isRoofingFamily ? " to schedule your free inspection" : " with your free estimate"}.`
        }
        image={svc?.image ?? (isClaim ? "/img/storm.jpg" : "/img/hero-roof.jpg")}
        primaryCta={{ label: `Call ${COMPANY.phone}`, href: COMPANY.phoneHref }}
      />

      <Section>
        <div className="grid items-start gap-12 lg:grid-cols-[1fr_1.2fr]">
          <div className="space-y-6">
            <h2 className="font-display text-2xl font-semibold">Get in touch</h2>
            <p className="text-muted-foreground">
              Prefer to talk to a person? Our team is here to help with inspections, estimates, claims, and any
              questions about your home.
            </p>
            <ul className="space-y-4">
              <ContactRow icon={Phone} label="Phone" value={COMPANY.phone} href={COMPANY.phoneHref} />
              <ContactRow icon={Mail} label="Email" value={COMPANY.email} href={`mailto:${COMPANY.email}`} />
              <ContactRow icon={MapPin} label="Office" value={COMPANY.address} />
              <ContactRow icon={Clock} label="Hours" value="Mon–Sat, 8am – 7pm" />
            </ul>
            <div className="rounded-2xl border border-[var(--metal)]/30 bg-white/[0.05] p-5 text-sm">
              <p className="font-semibold text-metal-dim">Emergency storm damage?</p>
              <p className="mt-1 text-muted-foreground">
                Call us now at{" "}
                <a href={COMPANY.phoneHref} className="font-medium text-foreground underline">
                  {COMPANY.phone}
                </a>{" "}
                for priority response.
              </p>
            </div>
          </div>

          <ContactForm
            defaultType={isClaim ? "claim" : "inspection"}
            defaultService={svc?.slug}
            submitLabel={submitLabel}
            messagePlaceholder={
              isClaim
                ? "Describe the storm and any visible damage…"
                : isRoofingFamily
                  ? "Tell us about your roof or recent storm damage…"
                  : `Tell us what you're looking for with ${svc?.title.toLowerCase()}…`
            }
            successText={
              isClaim
                ? "Your claim support request has been received. A claims specialist will contact you within 24 hours."
                : `Your request has been received. An Anexa Homes specialist will contact you within 24 hours${isRoofingFamily ? " to schedule your free inspection" : " with your free estimate"}.`
            }
          />
        </div>
      </Section>
    </>
  );
}

function ContactRow({
  icon: Icon,
  label,
  value,
  href,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  href?: string;
}) {
  const content = (
    <div className="flex items-start gap-3">
      <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-foreground/5 text-metal">
        <Icon className="size-5" />
      </span>
      <div>
        <div className="text-xs uppercase tracking-wider text-muted-foreground">{label}</div>
        <div className="font-medium">{value}</div>
      </div>
    </div>
  );
  return <li>{href ? <a href={href} className="block hover:opacity-80">{content}</a> : content}</li>;
}
