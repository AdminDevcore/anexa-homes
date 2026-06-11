import Image from "next/image";

// Real 3D thickness: stack many crisp copies of the logo silhouette along the
// Z-axis (shaded dark→light back-to-front) so the spinning emblem reads as a
// solid extruded object. Kept dim & subtle.
const COUNT = 24;
const STEP = 1.3; // px between layers  -> ~30px total depth

export function SpinningEmblem({ className }: { className?: string }) {
  return (
    <div className={`logo-3d-stage relative flex items-center justify-center ${className ?? ""}`}>
      <div className="pointer-events-none absolute size-[48%] rounded-full bg-[#F4631E]/12 blur-3xl" />
      <div
        className="logo-3d relative"
        style={{ width: "24rem", maxWidth: "82%", aspectRatio: "658 / 572", opacity: 0.82 }}
      >
        {Array.from({ length: COUNT }).map((_, i) => {
          const z = (i - (COUNT - 1) / 2) * STEP;
          const front = i === COUNT - 1;
          // back layers dark (the "side" of the extrusion), front face lit
          const brightness = 0.16 + (i / (COUNT - 1)) * 0.8;
          return (
            <Image
              key={i}
              src="/anexa-solid.png"
              alt={front ? "Anexa Homes" : ""}
              fill
              priority={front}
              sizes="(min-width: 1024px) 40vw, 80vw"
              className="object-contain"
              style={{ transform: `translateZ(${z}px)`, filter: `brightness(${brightness})` }}
            />
          );
        })}
      </div>
    </div>
  );
}
