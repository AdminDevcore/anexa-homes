"use client";

import * as React from "react";
import { Check, Copy } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Copy one value to the clipboard.
 *
 * Icon-only, so it carries a real `aria-label` naming WHAT it copies ("Copy
 * phone"), not just "Copy" — a screen-reader user hitting six of these in a
 * contact card otherwise hears the same word six times.
 *
 * Success is shown on the button itself for a beat rather than as a toast: at
 * this size a toast is louder than the action.
 */
export function CopyButton({
  value,
  label,
  className,
}: {
  value: string;
  /** What is being copied, e.g. "phone". Used for the accessible name. */
  label: string;
  className?: string;
}) {
  const [copied, setCopied] = React.useState(false);
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  // Without this, copying and then navigating away sets state on an unmounted
  // component (and leaves the timer running).
  React.useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      return; // Denied permission / insecure origin — fail quietly, not loudly.
    }
    setCopied(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 1500);
  }

  return (
    <button
      type="button"
      onClick={copy}
      aria-label={copied ? `${label} copied` : `Copy ${label}`}
      className={cn(
        "shrink-0 rounded-md p-1 text-muted-foreground transition-colors",
        "hover:bg-muted hover:text-foreground",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
        className
      )}
    >
      {copied ? (
        <Check className="size-3.5 text-emerald-600" />
      ) : (
        <Copy className="size-3.5" />
      )}
    </button>
  );
}
