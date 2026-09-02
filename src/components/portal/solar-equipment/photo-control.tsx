"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ImagePlus, Loader2, Trash2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Hint, Panel } from "@/components/portal/settings-kit";
import {
  uploadSolarEquipmentPhotoAction,
  removeSolarEquipmentPhotoAction,
} from "@/server/modules/solar/equipment-photo-actions";
import type { Item } from "./types";

/**
 * The product shot a homeowner sees beside this component on their proposal.
 *
 * Shown at a size worth checking — big enough to notice the wrong product, or a
 * screenshot with a white border baked into it, which is the mistake this
 * control exists to catch. On the old catalogue it was a 48px tile at the head
 * of a dense row, where both of those looked fine.
 */
export function PhotoControl({ item, canEdit }: { item: Item; canEdit: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  const input = React.useRef<HTMLInputElement>(null);

  async function upload(file: File) {
    setBusy(true);
    try {
      const res = await uploadSolarEquipmentPhotoAction(item.id, file2fd(file));
      if (!res.ok) return toast.error(res.error);
      toast.success("Photo updated");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function clear() {
    setBusy(true);
    try {
      const res = await removeSolarEquipmentPhotoAction(item.id);
      if (!res.ok) return toast.error(res.error);
      toast.success("Photo removed");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel title="Product photo">
      <div className="flex flex-wrap items-start gap-4">
        <span className="grid size-24 shrink-0 place-items-center overflow-hidden rounded-xl border border-border bg-white">
          {item.photoUrl ? (
            /* eslint-disable-next-line @next/next/no-img-element -- served from a
               route, not the image pipeline. */
            <img src={item.photoUrl} alt="" className="size-full object-contain p-2" />
          ) : (
            <ImagePlus className="size-6 text-muted-foreground/40" aria-hidden />
          )}
        </span>

        <div className="min-w-0 flex-1 space-y-2">
          <Hint>
            Shown to the customer beside this component on their proposal. PNG, JPG or WebP. A shot
            with a white border baked in will print with that border.
          </Hint>
          {canEdit && (
            <div className="flex flex-wrap gap-2">
              <input
                ref={input}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  // Cleared so picking the SAME file again still fires a change
                  // event — which is exactly what somebody does after
                  // re-exporting a bad crop.
                  e.target.value = "";
                  if (f) void upload(f);
                }}
              />
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => input.current?.click()}
              >
                {busy ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
                {item.photoUrl ? "Replace" : "Upload"}
              </Button>
              {item.photoUrl && (
                <Button size="sm" variant="ghost" disabled={busy} onClick={clear}>
                  <Trash2 className="size-4" /> Remove
                </Button>
              )}
            </div>
          )}
        </div>
      </div>
    </Panel>
  );
}

function file2fd(file: File) {
  const fd = new FormData();
  fd.append("file", file);
  return fd;
}
