"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

/** Pointer-driven 3D tilt with a moving light glare. Respects reduced motion. */
export function TiltCard({
  children,
  className,
  max = 9,
  radius = "rounded-2xl",
  glare = true,
}: {
  children: React.ReactNode;
  className?: string;
  max?: number;
  radius?: string;
  glare?: boolean;
}) {
  const [transform, setTransform] = React.useState("rotateX(0deg) rotateY(0deg)");
  const [glareStyle, setGlareStyle] = React.useState<React.CSSProperties>({ opacity: 0 });
  const reduced = React.useRef(false);

  React.useEffect(() => {
    reduced.current = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
  }, []);

  function onMove(e: React.MouseEvent<HTMLDivElement>) {
    if (reduced.current) return;
    const r = e.currentTarget.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width;
    const py = (e.clientY - r.top) / r.height;
    const rx = (0.5 - py) * max * 2;
    const ry = (px - 0.5) * max * 2;
    setTransform(`rotateX(${rx.toFixed(2)}deg) rotateY(${ry.toFixed(2)}deg)`);
    setGlareStyle({
      opacity: 1,
      background: `radial-gradient(circle at ${(px * 100).toFixed(0)}% ${(py * 100).toFixed(0)}%, rgba(255,255,255,0.16), rgba(255,255,255,0) 55%)`,
    });
  }
  function onLeave() {
    setTransform("rotateX(0deg) rotateY(0deg)");
    setGlareStyle({ opacity: 0 });
  }

  return (
    <div className={cn("[perspective:1100px]", className)} onMouseMove={onMove} onMouseLeave={onLeave}>
      <div
        className="relative h-full transition-transform duration-200 ease-out [transform-style:preserve-3d] will-change-transform"
        style={{ transform }}
      >
        {children}
        {glare && (
          <div
            className={cn("pointer-events-none absolute inset-0 z-10 transition-opacity duration-200", radius)}
            style={glareStyle}
          />
        )}
      </div>
    </div>
  );
}
