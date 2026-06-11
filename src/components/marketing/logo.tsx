import Link from "next/link";
import Image from "next/image";
import { cn } from "@/lib/utils";

// The "ANEXA HOMES" lockup. White on dark surfaces (.dark or invert), black on
// light. No orange, no separate text — one monochrome wordmark everywhere.
const SIZES = { md: "h-9", lg: "h-11", xl: "h-12" } as const;

// Intrinsic lockup dimensions (for aspect ratio); display size is set by height.
const LOCKUP_W = 1454;
const LOCKUP_H = 329;

export function Logo({
  className,
  invert = false,
  href = "/",
  size = "md",
}: {
  className?: string;
  invert?: boolean;
  href?: string;
  size?: keyof typeof SIZES;
}) {
  const h = SIZES[size];
  return (
    <Link href={href} className={cn("group inline-flex items-center", className)} aria-label="Anexa Homes home">
      {/* Black lockup on light surfaces; white on dark (.dark) surfaces or when inverted. */}
      <Image
        src="/anexa-lockup-dark.png"
        alt="Anexa Homes"
        width={LOCKUP_W}
        height={LOCKUP_H}
        priority
        className={cn(h, "w-auto object-contain", invert ? "hidden" : "dark:hidden")}
      />
      <Image
        src="/anexa-lockup.png"
        alt="Anexa Homes"
        width={LOCKUP_W}
        height={LOCKUP_H}
        priority
        className={cn(h, "w-auto object-contain", invert ? "block" : "hidden dark:block")}
      />
    </Link>
  );
}
