import type { Metadata } from "next";
import { SERVICES } from "@/lib/site";
import { ServicePage } from "@/components/marketing/service-page";

export const metadata: Metadata = {
  title: "Windows — Energy-Efficient Replacement",
  description:
    "Premium replacement windows from Anexa Homes — better curb appeal, comfort, and energy efficiency.",
};

const service = SERVICES.find((s) => s.slug === "windows")!;

export default function WindowsPage() {
  return (
    <ServicePage
      service={service}
      heroTitle={
        <>
          Beautiful windows that <span className="gold-gradient-text">save energy.</span>
        </>
      }
      heroDescription="Upgrade to premium replacement windows that boost your home's comfort, curb appeal, and efficiency — professionally installed by Anexa Homes."
      overviewTitle="Replacement windows tailored to your home."
      overviewBody="We help you choose the right styles and energy-efficient glass for your home, then install with precision and a clean job site. Better insulation, lower bills, and a fresh look — guaranteed."
      benefits={[
        { title: "Energy Efficient", body: "Low-E, double-pane glass that keeps your home comfortable and lowers bills." },
        { title: "Custom Fit", body: "Made-to-measure windows for a perfect, draft-free installation." },
        { title: "Professional Install", body: "Expert installation with workmanship and manufacturer warranties." },
      ]}
    />
  );
}
