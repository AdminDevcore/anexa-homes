import type { Metadata } from "next";
import { SERVICES } from "@/lib/site";
import { ServicePage } from "@/components/marketing/service-page";

export const metadata: Metadata = {
  title: "Roofing — Replacement & Repair",
  description:
    "Premium roof replacement and repair from Anexa Homes. Certified crews, top-tier materials, and lifetime workmanship warranties across North Texas.",
};

const service = SERVICES.find((s) => s.slug === "roofing")!;

export default function RoofingPage() {
  return (
    <ServicePage
      service={service}
      heroTitle={
        <>
          Roofing built to <span className="gold-gradient-text">protect</span> and to last.
        </>
      }
      heroDescription="From full roof replacement to precise repairs, Anexa Homes delivers craftsmanship that stands up to Texas storms — backed by manufacturer and workmanship warranties."
      overviewTitle="Roof replacement and repair, done right the first time."
      overviewBody="We install industry-leading shingle systems with meticulous attention to ventilation, flashing, and underlayment — the details that determine how long a roof truly lasts. Every project includes a thorough inspection, transparent scope, and a clean, respectful job site."
      benefits={[
        { title: "Certified Installers", body: "Manufacturer-certified crews follow strict installation specs to protect your warranty." },
        { title: "Premium Materials", body: "GAF, Owens Corning, and other top systems engineered for high-wind and hail resistance." },
        { title: "Lifetime Warranty", body: "Workmanship plus manufacturer warranties give you decades of protection and peace of mind." },
      ]}
    />
  );
}
