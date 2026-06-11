import type { Metadata } from "next";
import { SERVICES } from "@/lib/site";
import { ServicePage } from "@/components/marketing/service-page";

export const metadata: Metadata = {
  title: "Water Filtration",
  description:
    "Whole-home water filtration and softening from Anexa Homes for cleaner, healthier water at every tap.",
};

const service = SERVICES.find((s) => s.slug === "water-filtration")!;

export default function WaterFiltrationPage() {
  return (
    <ServicePage
      service={service}
      heroTitle={
        <>
          Cleaner water at <span className="gold-gradient-text">every tap.</span>
        </>
      }
      heroDescription="Anexa Homes installs whole-home filtration and softening systems that remove contaminants and hard minerals — for better water you can taste and feel."
      overviewTitle="Whole-home water systems tailored to your supply."
      overviewBody="We test your water and recommend the right combination of filtration, softening, and reverse osmosis. The result is cleaner drinking water, softer skin and hair, and protected appliances and plumbing."
      benefits={[
        { title: "Whole-Home Filtration", body: "Removes sediment, chlorine, and contaminants at the source." },
        { title: "Water Softening", body: "Eliminates hard-water scale that damages plumbing and appliances." },
        { title: "Reverse Osmosis", body: "Ultra-pure drinking water right from your kitchen tap." },
      ]}
    />
  );
}
