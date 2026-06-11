import type { Metadata } from "next";
import { SERVICES } from "@/lib/site";
import { ServicePage } from "@/components/marketing/service-page";

export const metadata: Metadata = {
  title: "Solar Energy Systems",
  description:
    "High-efficiency solar design and installation from Anexa Homes — lower your energy bills and increase your home's value.",
};

const service = SERVICES.find((s) => s.slug === "solar")!;

export default function SolarPage() {
  return (
    <ServicePage
      service={service}
      heroTitle={
        <>
          Power your home with <span className="gold-gradient-text">clean energy.</span>
        </>
      }
      heroDescription="Anexa Homes designs and installs premium solar systems that cut your energy bills, add home value, and pair perfectly with a new roof."
      overviewTitle="Solar that's engineered for your roof and your savings."
      overviewBody="We custom-design each system for your home's orientation and energy usage, using high-efficiency panels and optional battery storage. Because we're roofers first, your solar is installed with the roof's integrity and warranty fully protected."
      benefits={[
        { title: "Custom System Design", body: "Sized to your usage and roof for maximum production and ROI." },
        { title: "Battery Storage", body: "Keep the lights on during outages and store energy for peak hours." },
        { title: "Roof-Safe Install", body: "Installed by roofing experts so your roof warranty stays intact." },
      ]}
    />
  );
}
