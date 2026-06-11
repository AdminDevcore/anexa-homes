import {
  Home,
  Sun,
  Droplets,
  AppWindow,
  type LucideIcon,
} from "lucide-react";

export const SITE_URL = "https://anexahomes.com";

export const COMPANY = {
  name: "Anexa Homes",
  tagline: "Protecting Homes. Restoring Roofs. Powering Better Living.",
  phone: "(555) 200-7663",
  phoneHref: "tel:+15552007663",
  // Internal/staff support line shown in the portal sidebar (can differ from the
  // public sales number). Override via env if you have a dedicated support line.
  supportPhone: process.env.NEXT_PUBLIC_SUPPORT_PHONE || "(555) 200-7663",
  supportPhoneHref: process.env.NEXT_PUBLIC_SUPPORT_PHONE_HREF || "tel:+15552007663",
  email: "hello@anexahomes.com",
  address: "1200 Summit Ridge Blvd, Dallas, TX 75201",
  // Structured address powers schema.org LocalBusiness markup.
  street: "1200 Summit Ridge Blvd",
  city: "Dallas",
  state: "TX",
  zip: "75201",
  country: "US",
  // Approx. Dallas centroid; refine with the real storefront geo when available.
  geo: { lat: 32.7831, lng: -96.8067 },
  priceRange: "$$",
  serviceAreas: [
    "Dallas",
    "Fort Worth",
    "Plano",
    "Frisco",
    "Arlington",
    "McKinney",
    "Irving",
    "Denton",
  ],
};

// Top-level nav (kept short on purpose — services live under the Products menu).
export const NAV_LINKS: { label: string; href: string }[] = [
  { label: "About", href: "/about" },
  { label: "Careers", href: "/careers" },
];

export type Service = {
  slug: string;
  title: string;
  short: string;
  description: string;
  icon: LucideIcon;
  href: string;
  image: string;
  features: string[];
  primary?: boolean;
  // CTA wording differs by trade: roofing/storm use "Inspection", others "Estimate".
  ctaLabel?: string;
};

export const SERVICES: Service[] = [
  {
    slug: "roofing",
    title: "Roofing",
    short: "Replacement & repair",
    description:
      "Premium roof replacement and repair using top-tier materials and certified crews. Built to last, backed by warranty.",
    icon: Home,
    href: "/roofing",
    image: "/img/hero-roof.jpg",
    features: ["Roof replacement", "Roof repair", "Inspections", "Manufacturer warranties"],
    primary: true,
    ctaLabel: "Request Free Inspection",
  },
  {
    slug: "solar",
    title: "Solar",
    short: "Clean energy systems",
    description:
      "Design and install high-efficiency solar systems that lower bills and increase home value.",
    icon: Sun,
    href: "/solar",
    image: "/img/solar.jpg",
    features: ["System design", "Premium panels", "Battery storage", "Net metering"],
    ctaLabel: "Request Free Solar Estimate",
  },
  {
    slug: "water-filtration",
    title: "Water Filtration",
    short: "Clean water systems",
    description:
      "Whole-home water filtration and softening for cleaner, healthier water at every tap.",
    icon: Droplets,
    href: "/water-filtration",
    image: "/img/water.jpg",
    features: ["Whole-home filtration", "Water softeners", "Reverse osmosis", "Testing"],
    ctaLabel: "Request Free Water Test",
  },
  {
    slug: "windows",
    title: "Windows",
    short: "Energy-efficient windows",
    description:
      "Premium replacement windows that boost curb appeal, comfort, and energy efficiency.",
    icon: AppWindow,
    href: "/windows",
    image: "/img/windows.jpg",
    features: ["Replacement windows", "Energy-efficient glass", "Custom sizing", "Professional install"],
    ctaLabel: "Request Free Window Estimate",
  },
];

export const ROOFING_PROCESS: { step: string; title: string; body: string }[] = [
  { step: "01", title: "Free Inspection", body: "We assess your roof for storm and wear damage and document everything with photos." },
  { step: "02", title: "Claim & Scope", body: "We help open your insurance claim and meet your adjuster to align on a fair scope." },
  { step: "03", title: "Agreement", body: "Choose your materials and sign your contract digitally — right from your phone." },
  { step: "04", title: "Production", body: "Our certified crews install with precision, daily updates, and a clean job site." },
  { step: "05", title: "QC & Closeout", body: "We complete a quality inspection, magnetic nail sweep, and final walkthrough." },
  { step: "06", title: "Warranty", body: "You receive workmanship and manufacturer warranties plus a digital closeout packet." },
];

export const WHY_ANEXA: { title: string; body: string }[] = [
  { title: "Insurance Experts", body: "We negotiate directly with carriers and adjusters to maximize your approved scope." },
  { title: "Certified Crews", body: "Manufacturer-certified installers and rigorous quality control on every project." },
  { title: "Premium Materials", body: "We install industry-leading shingles and components built to withstand severe weather." },
  { title: "Transparent Process", body: "A real-time customer portal with documents, photos, and project status at your fingertips." },
  { title: "Lifetime Warranties", body: "Workmanship and manufacturer warranties that protect your investment for the long haul." },
  { title: "Local & Trusted", body: "Hundreds of homeowners across North Texas trust Anexa Homes with their biggest asset." },
];

export const TESTIMONIALS: { name: string; location: string; quote: string; rating: number }[] = [
  {
    name: "Jennifer M.",
    location: "Frisco, TX",
    quote:
      "Anexa handled my entire insurance claim and the new roof looks incredible. They made a stressful process completely effortless.",
    rating: 5,
  },
  {
    name: "Robert & Lisa T.",
    location: "Plano, TX",
    quote:
      "Professional from start to finish. The portal kept us updated daily and the crew left our property spotless.",
    rating: 5,
  },
  {
    name: "Marcus D.",
    location: "Dallas, TX",
    quote:
      "They got my claim approved after another company told me I'd get nothing. Premium work and honest people.",
    rating: 5,
  },
  {
    name: "Priya & Sanjay R.",
    location: "McKinney, TX",
    quote:
      "We did our roof and solar with Anexa. One team, one point of contact, and the whole project ran on schedule.",
    rating: 5,
  },
  {
    name: "Tom B.",
    location: "Fort Worth, TX",
    quote:
      "Crew was on time, cleaned up every day, and the new windows made a huge difference in our energy bills.",
    rating: 5,
  },
  {
    name: "Alicia W.",
    location: "Arlington, TX",
    quote:
      "After the hail storm they handled everything with my insurance. Stress-free from inspection to final walkthrough.",
    rating: 5,
  },
];

export const FAQS: { q: string; a: string }[] = [
  {
    q: "Do you really handle the whole insurance claim?",
    a: "Yes. We document the damage, file the claim, meet your adjuster on-site, negotiate supplements, and recover your depreciation — so you typically only pay your deductible.",
  },
  {
    q: "How fast can you do my inspection?",
    a: "Most free inspections are scheduled within 48 hours. After a major storm we prioritize affected neighborhoods.",
  },
  {
    q: "What areas do you serve?",
    a: "The entire Dallas–Fort Worth metroplex, including Plano, Frisco, McKinney, Arlington, Irving, and Denton. Don't see your city? Reach out — we're expanding fast.",
  },
  {
    q: "Is Anexa Homes licensed and insured?",
    a: "Absolutely. We're fully licensed and insured, and our crews are manufacturer-certified for the systems we install.",
  },
  {
    q: "Besides roofing, what else can you do?",
    a: "We're a full home-improvement company: roofing, solar, water filtration, and replacement windows — often bundled into one coordinated project.",
  },
  {
    q: "What kind of warranty do I get?",
    a: "You receive both a workmanship warranty and the manufacturer's warranty, plus a digital closeout packet with all your documents and photos.",
  },
];

export const STATS: { value: string; label: string }[] = [
  { value: "1,200+", label: "Roofs Restored" },
  { value: "$18M+", label: "Claims Recovered" },
  { value: "4.9★", label: "Average Rating" },
  { value: "25-Yr", label: "Workmanship Warranty" },
];
