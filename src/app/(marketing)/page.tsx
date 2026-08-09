import { Hero } from "@/components/marketing/hero";
import { Marquee } from "@/components/marketing/marquee";
import {
  ServicesSection,
  ProcessSection,
  InsuranceHelpSection,
  StormWarningSignsSection,
  StayInformedSection,
  FinancingSection,
  WhyAnexaSection,
  TestimonialsSection,
  ServiceAreaSection,
  CtaBand,
} from "@/components/marketing/home-sections";
import { FaqSection } from "@/components/marketing/faq-section";
import { Section, SectionHeading } from "@/components/marketing/ui";
import { ContactForm } from "@/components/marketing/contact-form";

export default function HomePage() {
  return (
    <>
      <Hero />
      <Marquee />
      <ServicesSection />
      <WhyAnexaSection />
      <StormWarningSignsSection />
      <InsuranceHelpSection />
      <ProcessSection />
      <StayInformedSection />
      <FinancingSection />
      <TestimonialsSection />
      <ServiceAreaSection />
      <FaqSection />
      <Section id="contact">
        <div className="grid items-start gap-12 lg:grid-cols-2">
          <SectionHeading
            eyebrow="Request Inspection"
            title="Get your free home inspection."
            description="Tell us about your property and a specialist will reach out within 24 hours. Most inspections are scheduled within 48 hours."
          />
          <ContactForm defaultType="inspection" />
        </div>
      </Section>
      <CtaBand />
    </>
  );
}
