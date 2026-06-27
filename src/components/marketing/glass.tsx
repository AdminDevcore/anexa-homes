import Link from "next/link";
import { cn } from "@/lib/utils";

const SIZES = {
  sm: "h-9 px-4 text-sm",
  md: "h-11 px-6 text-sm",
  lg: "h-[3.25rem] px-8 text-base",
} as const;

export function GlassButton({
  href,
  variant = "gold",
  size = "md",
  className,
  children,
}: {
  href: string;
  variant?: "gold" | "dark";
  size?: keyof typeof SIZES;
  className?: string;
  children: React.ReactNode;
}) {
  const cls = cn(
    "group inline-flex items-center justify-center gap-2 font-semibold tracking-tight",
    "transition-[transform,box-shadow] duration-200 will-change-transform hover:-translate-y-0.5",
    SIZES[size],
    variant === "gold" ? "glass-pill-gold" : "glass-pill",
    className
  );
  const external = /^(https?:|tel:|mailto:)/.test(href);
  if (external) {
    return (
      <a href={href} className={cls}>
        {children}
      </a>
    );
  }
  return (
    <Link href={href} className={cls}>
      {children}
    </Link>
  );
}
