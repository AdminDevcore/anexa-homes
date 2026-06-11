import { Section, SectionHeading } from "./ui";
import { Reveal } from "./reveal";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { FAQS } from "@/lib/site";

export function FaqSection() {
  return (
    <Section id="faq">
      <div className="grid items-start gap-12 lg:grid-cols-[0.9fr_1.1fr]">
        <SectionHeading
          eyebrow="Questions"
          title="Answers before you ever pick up the phone."
          description="Still unsure about something? Reach out — a North Texas specialist is happy to walk you through it."
        />
        <Reveal>
          <Accordion type="single" collapsible className="rounded-2xl border border-border bg-card px-5">
            {FAQS.map((f, i) => (
              <AccordionItem key={i} value={`faq-${i}`}>
                <AccordionTrigger className="text-left text-base font-semibold hover:no-underline">
                  {f.q}
                </AccordionTrigger>
                <AccordionContent className="text-[15px] leading-relaxed text-muted-foreground">
                  {f.a}
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </Reveal>
      </div>
    </Section>
  );
}
