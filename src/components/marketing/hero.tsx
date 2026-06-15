"use client";

import * as React from "react";
import Link from "next/link";
import Image from "next/image";
import { motion, useScroll, useTransform, useReducedMotion } from "framer-motion";
import { ArrowRight, ShieldCheck, Star, Phone } from "lucide-react";
import { GlassButton } from "./glass";
import { TiltCard } from "./tilt-card";
import { COMPANY, STATS } from "@/lib/site";

export function Hero() {
  const ref = React.useRef<HTMLElement>(null);
  const reduce = useReducedMotion();
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start start", "end start"] });
  // Different depths -> different scroll rates
  const yGlow = useTransform(scrollYProgress, [0, 1], [0, reduce ? 0 : 110]);
  const yImage = useTransform(scrollYProgress, [0, 1], [0, reduce ? 0 : -70]);
  const yText = useTransform(scrollYProgress, [0, 1], [0, reduce ? 0 : 40]);

  return (
    <section ref={ref} className="relative overflow-hidden bg-[#0B0B0C] text-white">
      {/* Background parallax layers */}
      <div className="pointer-events-none absolute inset-0">
        <motion.div style={{ y: yGlow }} className="absolute inset-0">
          <div className="absolute -top-40 left-1/4 size-[40rem] -translate-x-1/2 rounded-full bg-white/[0.06] blur-[130px]" />
          <div className="absolute bottom-0 right-0 size-[28rem] rounded-full bg-[var(--metal)]/[0.05] blur-[110px]" />
        </motion.div>
        {/* Faint brushed-metal brand watermark */}
        <Image
          src="/anexa-metal.png"
          alt=""
          aria-hidden
          width={760}
          height={760}
          className="pointer-events-none absolute left-1/2 top-1/2 w-[34rem] max-w-none -translate-x-1/2 -translate-y-1/2 opacity-[0.16] mix-blend-screen sm:w-[44rem]"
        />
        <div
          className="absolute inset-0 opacity-[0.035]"
          style={{
            backgroundImage:
              "linear-gradient(to right, white 1px, transparent 1px), linear-gradient(to bottom, white 1px, transparent 1px)",
            backgroundSize: "64px 64px",
          }}
        />
        {/* Keep text legible over the watermark */}
        <div className="absolute inset-0 bg-gradient-to-r from-[#0B0B0C] via-[#0B0B0C]/70 to-transparent" />
      </div>

      <div className="container-anexa relative">
        <div className="grid items-center gap-12 py-20 sm:py-24 lg:grid-cols-[1.05fr_0.95fr] lg:py-28">
          <motion.div style={{ y: yText }}>
            <div className="flex flex-col items-start">
              <span
                className="reveal-up inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-4 py-1.5 text-xs font-medium text-white/80 backdrop-blur"
                style={{ animationDelay: "0.05s" }}
              >
                <ShieldCheck className="size-3.5 text-metal" />
                Insurance Claim Specialists · Licensed &amp; Insured
              </span>

              <h1
                className="reveal-up mt-6 max-w-2xl font-display text-[2.6rem] font-semibold leading-[1.04] tracking-tight sm:text-6xl"
                style={{ animationDelay: "0.13s" }}
              >
                Protecting Homes.{" "}
                <span className="gold-gradient-text">Restoring Roofs.</span>{" "}
                Powering Better Living.
              </h1>

              <p
                className="reveal-up mt-6 max-w-xl text-lg leading-relaxed text-white/60"
                style={{ animationDelay: "0.21s" }}
              >
                Roofing, solar, water filtration &amp; windows — North Texas&rsquo;
                trusted home-improvement team, handling your project end to end.
              </p>

              <div
                className="reveal-up mt-9 flex flex-col gap-3 sm:flex-row sm:flex-wrap"
                style={{ animationDelay: "0.29s" }}
              >
                <GlassButton href="/contact" variant="gold" size="lg">
                  Request Free Roof Inspection
                  <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
                </GlassButton>
                <GlassButton href="/contact?type=claim" variant="dark" size="lg">
                  Start Insurance Claim Support
                </GlassButton>
              </div>

              <div
                className="reveal-up mt-7 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-white/55"
                style={{ animationDelay: "0.37s" }}
              >
                <span className="flex items-center gap-1.5">
                  <span className="flex">
                    {Array.from({ length: 5 }).map((_, i) => (
                      <Star key={i} className="size-4 fill-[var(--metal-bright)] text-[var(--metal-bright)]" />
                    ))}
                  </span>
                  4.9/5 · 600+ homeowners
                </span>
                <a href={COMPANY.phoneHref} className="inline-flex items-center gap-1.5 hover:text-white">
                  <Phone className="size-4 text-metal" />
                  {COMPANY.phone}
                </a>
                <Link href="/login" className="font-medium text-white/70 hover:text-white">
                  Login →
                </Link>
              </div>
            </div>
          </motion.div>

          {/* Hero image (parallax + entrance + tilt) */}
          <motion.div style={{ y: yImage }} className="relative hidden lg:block">
            <div className="reveal-scale relative">
              <div className="absolute -inset-6 rounded-[2rem] bg-white/[0.07] blur-2xl" />
              <TiltCard max={7} radius="rounded-[1.75rem]">
                <div className="relative aspect-[4/5] overflow-hidden rounded-[1.75rem] border border-white/15 shadow-2xl shadow-black/50">
                  <Image
                    src="/img/home-dusk.jpg"
                    alt="A premium North Texas home improved by Anexa Homes"
                    fill
                    priority
                    sizes="(min-width: 1024px) 45vw, 100vw"
                    className="object-cover"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />
                  <div className="absolute bottom-5 left-5 right-5 flex items-center justify-between rounded-2xl border border-white/15 bg-black/40 px-5 py-3.5 backdrop-blur-md">
                    <div>
                      <div className="font-display text-2xl font-semibold">1,200+</div>
                      <div className="text-xs text-white/60">Home projects completed in North Texas</div>
                    </div>
                    <ShieldCheck className="size-8 text-metal" />
                  </div>
                </div>
              </TiltCard>
            </div>
          </motion.div>
        </div>
      </div>

      {/* Stats strip */}
      <div className="relative border-t border-white/10 bg-white/[0.02]">
        <div className="container-anexa grid grid-cols-2 divide-x divide-white/10 md:grid-cols-4">
          {STATS.map((s) => (
            <div key={s.label} className="px-2 py-8 text-center">
              <div className="font-display text-2xl font-semibold text-white sm:text-3xl">{s.value}</div>
              <div className="mt-1 text-xs uppercase tracking-wider text-white/50">{s.label}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
