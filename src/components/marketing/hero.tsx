"use client";

import * as React from "react";
import Image from "next/image";
import { motion, useScroll, useTransform, useReducedMotion } from "framer-motion";
import { ArrowRight, ShieldCheck, Check } from "lucide-react";
import { GlassButton } from "./glass";
import { STATS } from "@/lib/site";

const TRUST_BADGES = [
  "Licensed Where Required",
  "Insured",
  "Insurance Claim Support",
  "Local Texas Team",
  "Digital Contracts & Updates",
];

export function Hero() {
  const ref = React.useRef<HTMLElement>(null);
  const reduce = useReducedMotion();
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start start", "end start"] });
  // Very subtle parallax: the background drifts slower than the page scroll.
  const yImage = useTransform(scrollYProgress, [0, 1], [0, reduce ? 0 : 70]);

  return (
    <section ref={ref} className="relative isolate flex min-h-[100svh] flex-col overflow-hidden bg-[#0B0B0C] text-white">
      {/* Full-bleed background photo (slightly over-scaled so the parallax
          drift never reveals an edge). */}
      <motion.div style={{ y: yImage }} className="absolute inset-0 -z-10 scale-110">
        <Image
          src="/img/hero-home.jpg"
          alt="A premium stone home at dusk with rooftop solar, built and protected by Anexa Homes"
          fill
          priority
          quality={90}
          sizes="100vw"
          className="object-cover object-[center_42%] sm:object-center"
        />
      </motion.div>

      {/* Overlays — keep the LEFT dark for legible text while the home stays
          fully visible on the RIGHT. ~50% effective darkening. */}
      <div className="absolute inset-0 -z-10 bg-gradient-to-r from-[#0B0B0C]/92 via-[#0B0B0C]/55 to-[#0B0B0C]/15" />
      <div className="absolute inset-0 -z-10 bg-gradient-to-t from-[#0B0B0C] via-transparent to-[#0B0B0C]/35" />
      {/* Extra base scrim on small screens (text sits over the whole image). */}
      <div className="absolute inset-0 -z-10 bg-[#0B0B0C]/35 lg:bg-transparent" />

      {/* Content */}
      <div className="container-anexa relative flex flex-1 items-center pt-28 pb-14 sm:pt-32">
        <div className="flex max-w-xl flex-col items-start lg:max-w-2xl">
          <span
            className="reveal-up inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/[0.06] px-4 py-1.5 text-xs font-medium text-white/85 backdrop-blur-md"
            style={{ animationDelay: "0.05s" }}
          >
            <ShieldCheck className="size-3.5 text-metal" />
            Premium Roofing, Home Improvement &amp; Solar
          </span>

          <h1
            className="reveal-up mt-6 font-display text-[2.6rem] font-semibold leading-[1.05] tracking-tight [text-shadow:0_2px_30px_rgba(0,0,0,0.45)] sm:text-6xl"
            style={{ animationDelay: "0.13s" }}
          >
            Protect Your Home.
            <br />
            Restore What Matters.
            <br />
            Upgrade How You Live.
          </h1>

          <p
            className="reveal-up mt-6 max-w-xl text-lg leading-relaxed text-white/75 [text-shadow:0_1px_16px_rgba(0,0,0,0.5)]"
            style={{ animationDelay: "0.21s" }}
          >
            Roofing, HVAC, water filtration, windows, gutters, and solar —
            handled by one professional team.
          </p>

          <div
            className="reveal-up mt-9 flex flex-col gap-3 sm:flex-row sm:flex-wrap"
            style={{ animationDelay: "0.29s" }}
          >
            <GlassButton href="/contact" variant="gold" size="lg">
              Schedule Free Inspection
              <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
            </GlassButton>
            <GlassButton href="/#services" variant="dark" size="lg">
              Explore Services
            </GlassButton>
          </div>

          {/* Trust badges — each rises in, one at a time. */}
          <div className="mt-8 flex flex-wrap gap-2.5">
            {TRUST_BADGES.map((b, i) => (
              <span
                key={b}
                className="reveal-up inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/[0.06] px-3.5 py-1.5 text-xs font-medium text-white/80 backdrop-blur-md"
                style={{ animationDelay: `${0.45 + i * 0.1}s` }}
              >
                <Check className="size-3.5 text-metal" />
                {b}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* Stats strip — glassy band anchored to the bottom of the hero. */}
      <div className="relative border-t border-white/10 bg-black/30 backdrop-blur-md">
        <div className="container-anexa grid grid-cols-2 divide-x divide-white/10 md:grid-cols-4">
          {STATS.map((s) => (
            <div key={s.label} className="px-2 py-6 text-center sm:py-7">
              <div className="font-display text-2xl font-semibold text-white sm:text-3xl">{s.value}</div>
              <div className="mt-1 text-xs uppercase tracking-wider text-white/55">{s.label}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
