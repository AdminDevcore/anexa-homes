import { ShieldCheck, Star, Award, MapPin } from "lucide-react";
import { COMPANY } from "@/lib/site";

const BADGES: { icon: React.ComponentType<{ className?: string }>; label: string }[] = [
  { icon: ShieldCheck, label: "Licensed & Insured" },
  { icon: Award, label: "GAF Certified Installers" },
  { icon: Star, label: "4.9★ Rated by 600+ Homeowners" },
  { icon: Award, label: "25-Year Workmanship Warranty" },
  { icon: ShieldCheck, label: "Insurance Claim Specialists" },
];

export function Marquee() {
  const items = [
    ...BADGES.map((b) => ({ icon: b.icon, label: b.label })),
    ...COMPANY.serviceAreas.map((c) => ({ icon: MapPin, label: c })),
  ];
  // Two copies for a seamless loop.
  const loop = [...items, ...items];

  return (
    <div className="border-y border-white/10 bg-white/[0.02] py-4">
      <div className="marquee-mask overflow-hidden">
        <div className="animate-marquee flex w-max items-center gap-10 pr-10">
          {loop.map((it, i) => (
            <div key={i} className="flex shrink-0 items-center gap-2.5 text-sm font-medium text-white/55">
              <it.icon className="size-4 text-metal" />
              <span>{it.label}</span>
              <span className="ml-8 size-1 rounded-full bg-white/[0.05]0" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
