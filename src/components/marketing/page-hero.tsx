"use client";

import * as React from "react";
import Link from "next/link";
import Image from "next/image";
import { motion, useScroll, useTransform, useReducedMotion } from "framer-motion";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Eyebrow } from "./ui";

export function PageHero({
  eyebrow,
  title,
  description,
  image,
  imagePosition = "center 40%",
  primaryCta = { label: "Request Free Inspection", href: "/contact" },
  secondaryCta,
}: {
  eyebrow: string;
  title: React.ReactNode;
  description: string;
  image?: string;
  // Focal point for object-cover. Defaults bias slightly upward so rooflines
  // (and rooftop solar) stay visible on short, wide hero crops.
  imagePosition?: string;
  primaryCta?: { label: string; href: string };
  secondaryCta?: { label: string; href: string };
}) {
  const ref = React.useRef<HTMLElement>(null);
  const reduce = useReducedMotion();
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start start", "end start"] });
  // Slight parallax: the background drifts a touch slower than the page.
  const y = useTransform(scrollYProgress, [0, 1], [0, reduce ? 0 : 50]);

  return (
    <section ref={ref} className="relative isolate overflow-hidden bg-[#0B0B0C] text-white">
      {image ? (
        <>
          {/* Parallax frame is over-tall so the drift never reveals an edge.
              It wraps the fade-in + Ken Burns layer (CSS) so the JS translate
              and the CSS scale stay on separate elements and never conflict. */}
          <motion.div
            style={{ y }}
            className="pointer-events-none absolute inset-x-0 -top-[10%] -z-10 h-[120%]"
          >
            <div className="hero-bg-anim relative h-full w-full">
              <Image
                src={image}
                alt=""
                fill
                priority
                quality={90}
                sizes="100vw"
                className="object-cover"
                style={{ objectPosition: imagePosition }}
              />
            </div>
          </motion.div>
          {/* Dark overlay behind the text — strong enough on the left for
              legibility (paired with the headline text-shadow) but lighter
              across the rest so the photo subject stays visible. */}
          <div className="absolute inset-0 -z-10 bg-gradient-to-r from-[#0B0B0C]/85 via-[#0B0B0C]/45 to-[#0B0B0C]/15" />
          <div className="absolute inset-0 -z-10 bg-gradient-to-t from-[#0B0B0C] via-[#0B0B0C]/10 to-transparent" />
        </>
      ) : (
        <div className="pointer-events-none absolute inset-0 -z-10">
          <div className="absolute -top-32 right-0 size-[36rem] rounded-full bg-white/[0.06] blur-[120px]" />
        </div>
      )}

      <div className="container-anexa relative py-24 sm:py-32">
        <Eyebrow>{eyebrow}</Eyebrow>
        <h1 className="mt-5 max-w-3xl font-display text-4xl font-semibold leading-[1.08] tracking-tight [text-shadow:0_2px_30px_rgba(0,0,0,0.5)] sm:text-5xl md:text-6xl">
          {title}
        </h1>
        <p className="mt-5 max-w-2xl text-lg leading-relaxed text-white/75 [text-shadow:0_1px_16px_rgba(0,0,0,0.5)]">
          {description}
        </p>
        <div className="mt-8 flex flex-col gap-3 sm:flex-row">
          <Button asChild size="lg" className="group bg-gold text-gold-foreground hover:bg-gold/90">
            <Link href={primaryCta.href}>
              {primaryCta.label}
              <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
            </Link>
          </Button>
          {secondaryCta && (
            <Button
              asChild
              size="lg"
              variant="outline"
              className="border-white/25 bg-white/5 text-white hover:bg-white/10 hover:text-white"
            >
              <Link href={secondaryCta.href}>{secondaryCta.label}</Link>
            </Button>
          )}
        </div>
      </div>
    </section>
  );
}
