"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { PhoneCall, Loader2, Copy, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogTrigger,
} from "@/components/ui/dialog";
import { sendWelcomeCallAction } from "@/server/modules/welcome-call/actions";

type Template = { id: string; name: string };

export function SendWelcomeCallButton({ leadId, templates }: { leadId: string; templates: Template[] }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [templateId, setTemplateId] = React.useState(templates[0]?.id ?? "");
  const [busy, setBusy] = React.useState(false);
  const [result, setResult] = React.useState<{ url: string; emailed: boolean } | null>(null);

  async function send() {
    if (!templateId) return toast.error("Pick a template.");
    setBusy(true);
    const res = await sendWelcomeCallAction(leadId, templateId);
    setBusy(false);
    if (!res.ok) return toast.error(res.error);
    setResult({ url: res.url!, emailed: !!res.emailed });
    toast.success(res.emailed ? "Welcome call sent to the customer" : "Welcome call link ready");
    router.refresh();
  }

  function reset() {
    setResult(null);
    setOpen(false);
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setResult(null); }}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <PhoneCall className="size-4" /> Welcome Call
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Send Welcome Call</DialogTitle>
          <DialogDescription>
            The customer gets a link to review and confirm their project details.
          </DialogDescription>
        </DialogHeader>

        {result ? (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-sm text-emerald-600">
              <CheckCircle2 className="size-4" />
              {result.emailed ? "Emailed to the customer." : "No email on file — copy the link and send it manually."}
            </div>
            <div className="flex items-center gap-2">
              <input readOnly value={result.url} className="h-9 flex-1 rounded-md border border-border bg-muted/40 px-2 text-xs" />
              <Button size="sm" variant="outline" onClick={() => { navigator.clipboard?.writeText(result.url); toast.success("Link copied"); }}>
                <Copy className="size-4" /> Copy
              </Button>
            </div>
            <DialogFooter>
              <Button onClick={reset}>Done</Button>
            </DialogFooter>
          </div>
        ) : templates.length === 0 ? (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              No welcome-call templates yet. Create one in Settings → Welcome Call Templates first.
            </p>
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)}>Close</Button>
            </DialogFooter>
          </div>
        ) : (
          <div className="space-y-3">
            <label className="text-sm font-medium">Template</label>
            <select
              value={templateId}
              onChange={(e) => setTemplateId(e.target.value)}
              className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm"
            >
              {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
            <DialogFooter>
              <Button onClick={send} disabled={busy} className="bg-gold text-gold-foreground hover:bg-gold/90">
                {busy ? <Loader2 className="size-4 animate-spin" /> : <PhoneCall className="size-4" />} Send
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
