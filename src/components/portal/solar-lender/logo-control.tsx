"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Upload, Globe, ImageOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { LenderMark } from "@/components/ui/lender-mark";
import {
  uploadSolarLenderLogoAction,
  fetchSolarLenderLogoAction,
  removeSolarLenderLogoAction,
} from "@/server/modules/solar/lender-logo-actions";
import type { LenderRow } from "./types";
import { Hint } from "./fields";

/**
 * Giving a lender its logo.
 *
 * Two ways in, because both are the fastest way in different situations. Most
 * partners already publish a perfectly good mark on their own website, so one
 * button reads it off there — and when that fails, or when the marketing team
 * hands you the proper asset, the file picker is right beside it.
 *
 * Saves immediately rather than joining the panel's draft: the file is uploaded
 * and stored the moment it is picked, so there is nothing for a Discard to
 * undo. Its own row at the top of the Details tab, laid out sideways — the old
 * version stacked mark, buttons and the website box down a third of a grid
 * column, which is most of why that panel read as a wall.
 */
export function LogoControl({ lender }: { lender: LenderRow }) {
  const router = useRouter();
  const [busy, setBusy] = React.useState<null | "upload" | "fetch" | "remove">(null);
  const [site, setSite] = React.useState("");
  const fileRef = React.useRef<HTMLInputElement>(null);
  const anyBusy = busy !== null;

  async function upload(file: File) {
    setBusy("upload");
    const fd = new FormData();
    fd.set("file", file);
    const res = await uploadSolarLenderLogoAction(lender.id, fd);
    setBusy(null);
    if (!res.ok) return toast.error(res.error);
    toast.success("Logo updated");
    router.refresh();
  }

  async function grab() {
    setBusy("fetch");
    const res = await fetchSolarLenderLogoAction(lender.id, site.trim() || null);
    setBusy(null);
    // A refusal here explains where we looked and what we found, so it needs
    // long enough to read before it disappears.
    if (!res.ok) return toast.error(res.error, { duration: 9000 });
    toast.success(`Took ${res.source} from ${res.from}`);
    setSite("");
    router.refresh();
  }

  async function remove() {
    setBusy("remove");
    const res = await removeSolarLenderLogoAction(lender.id);
    setBusy(null);
    if (!res.ok) return toast.error(res.error);
    toast.success("Logo removed");
    router.refresh();
  }

  const spinner = (which: typeof busy) =>
    busy === which ? <Loader2 className="size-4 animate-spin" /> : null;

  return (
    <div className="flex flex-wrap items-start gap-4 rounded-xl border border-border bg-card p-4">
      <LenderMark name={lender.name} logoUrl={lender.logoUrl} size="lg" className="size-14 rounded-xl" />
      <div className="min-w-0 flex-1 space-y-2">
        <div>
          <p className="text-sm font-semibold">Logo</p>
          <Hint>
            {lender.logoUrl
              ? "Shown next to this lender everywhere, including the customer's proposal."
              : "None yet — this lender wears its initials until one is set."}
          </Hint>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="hidden"
            aria-label={`Logo file for ${lender.name}`}
            onChange={(e) => {
              const f = e.target.files?.[0];
              // Reset first: picking the same file twice must fire onChange twice.
              e.target.value = "";
              if (f) void upload(f);
            }}
          />
          <Button size="sm" variant="outline" disabled={anyBusy} onClick={() => fileRef.current?.click()}>
            {spinner("upload") ?? <Upload className="size-4" />} Upload
          </Button>
          <Button size="sm" variant="outline" disabled={anyBusy} onClick={grab}>
            {spinner("fetch") ?? <Globe className="size-4" />} Grab from website
          </Button>
          {lender.logoUrl && (
            <Button size="sm" variant="ghost" disabled={anyBusy} onClick={remove}>
              {spinner("remove") ?? <ImageOff className="size-4" />} Remove
            </Button>
          )}
          <Input
            value={site}
            placeholder="goodleap.com — only if the links below are not the right site"
            aria-label={`Website to take ${lender.name}'s logo from`}
            onChange={(e) => setSite(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void grab();
              }
            }}
            className="h-8 min-w-[16rem] flex-1"
          />
        </div>
        <Hint>
          PNG, JPG or WebP, up to 5MB. Left blank, &ldquo;Grab from website&rdquo; uses the customer
          application link, or the dealer portal if there is no application link.
        </Hint>
      </div>
    </div>
  );
}
