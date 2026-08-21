import { cn } from "@/lib/utils";
import { lenderInitials, lenderMarkColor } from "@/lib/lender-mark";

const SIZES = {
  sm: { box: "size-6 rounded-md", text: "text-[10px]" },
  md: { box: "size-8 rounded-lg", text: "text-xs" },
  lg: { box: "size-10 rounded-lg", text: "text-sm" },
} as const;

/**
 * A financing partner, as a mark.
 *
 * The logo when there is one, the lender's initials in a colour derived from
 * its name when there is not — never a generic bank glyph, which made every
 * partner look like the same partner and made the settings screen read as a
 * placeholder.
 *
 * Decorative by design: every placement renders the lender's name immediately
 * beside it, so an alt text here would only make a screen reader say the name
 * twice.
 *
 * No "use client": it is pure markup, so the server-rendered proposal and the
 * interactive settings screen can both use it.
 */
export function LenderMark({
  name,
  logoUrl,
  size = "md",
  className,
}: {
  name: string;
  logoUrl?: string | null;
  size?: keyof typeof SIZES;
  className?: string;
}) {
  const s = SIZES[size];

  if (logoUrl) {
    return (
      // A white tile under the logo, always. Most banks publish a dark mark on
      // transparency, which vanishes on a dark background — and this renders on
      // a customer's screen in whatever theme they happen to use.
      <span
        className={cn(
          "flex shrink-0 items-center justify-center overflow-hidden bg-white p-0.5 ring-1 ring-black/10",
          s.box,
          className
        )}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- served from a
            route, not the image pipeline, and rendered on the public proposal
            where next/image's optimiser is not in play. */}
        <img src={logoUrl} alt="" className="size-full object-contain" loading="lazy" decoding="async" />
      </span>
    );
  }

  const { bg, fg } = lenderMarkColor(name);
  return (
    <span
      aria-hidden
      style={{ backgroundColor: bg, color: fg }}
      className={cn(
        "flex shrink-0 items-center justify-center font-semibold tracking-tight",
        s.box,
        s.text,
        className
      )}
    >
      {lenderInitials(name)}
    </span>
  );
}
