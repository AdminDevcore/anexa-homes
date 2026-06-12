"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Send, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { resendDocumentAction } from "@/server/modules/esign/actions";

/**
 * Re-issues fresh signing links for every not-yet-signed signer, emails them,
 * and surfaces the new links so staff can also share them directly. The old
 * links are invalidated server-side.
 */
export function ResendButton({ packageId }: { packageId: string }) {
  const router = useRouter();
  const [pending, setPending] = React.useState(false);
  const [open, setOpen] = React.useState(false);
  const [links, setLinks] = React.useState<{ name: string; url: string }[]>([]);

  async function resend() {
    setPending(true);
    const res = await resendDocumentAction(packageId);
    setPending(false);
    if (res.ok) {
      setLinks(res.links);
      setOpen(true);
      toast.success("Reminder emailed");
      router.refresh();
    } else {
      toast.error(res.error);
    }
  }

  return (
    <>
      <Button type="button" size="sm" variant="outline" onClick={resend} disabled={pending}>
        {pending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
        Resend
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Reminder sent</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              A fresh signing link was emailed to each pending signer (the previous link no longer
              works). You can also share these links directly:
            </p>
            {links.map((l) => (
              <div key={l.url} className="space-y-1">
                <Label className="text-xs">{l.name}</Label>
                <div className="flex gap-2">
                  <Input readOnly value={l.url} className="text-xs" />
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    onClick={() => {
                      navigator.clipboard.writeText(l.url);
                      toast.success("Link copied");
                    }}
                  >
                    <Copy className="size-4" />
                  </Button>
                </div>
              </div>
            ))}
            <DialogFooter>
              <Button onClick={() => setOpen(false)}>Done</Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
