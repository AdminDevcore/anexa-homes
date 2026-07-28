import type { MetadataRoute } from "next";
import { COMPANY } from "@/lib/site";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: `${COMPANY.name} — Roofing & Home Improvement`,
    short_name: COMPANY.name,
    description:
      "Premium roofing, HVAC, water filtration, windows, gutters & solar panel installation across North Texas.",
    start_url: "/",
    display: "standalone",
    background_color: "#0B0B0C",
    theme_color: "#F4631E",
    icons: [
      { src: "/anexa-mark.png", sizes: "any", type: "image/png", purpose: "any" },
      { src: "/anexa-mark.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
