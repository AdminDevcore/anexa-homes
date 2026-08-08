"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Send, FileSignature, Plus, X, Copy, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import { sendDocumentsAction } from "@/server/modules/esign/actions";
import { InPersonSignButton } from "@/components/esign/in-person-sign-button";

export type SendDocsTemplate = { id: string; name: string; type: string };

export type SendDocsDefaults = {
  customerName: string;
  customerEmail: string;
  coOwnerName: string | null;
  repName: string;
  repEmail: string;
};

type SentDoc = { templateId: string; title: string; packageId: string; links: { name: string; url: string }[] };

/**
 * "Send docs" from the proposal. Same e-sign engine as the Documents page, minus
 * the lead picker — the deal is already known here, so the rep only chooses WHICH
 * documents. Each checked template goes out as its own envelope with its own
 * signing link.
 */
export function SendDocsDialog({
  leadId,
  templates,
  defaults,
  trigger,
}: {
  leadId: string;
  templates: SendDocsTemplate[];
  defaults: SendDocsDefaults;
  trigger: React.ReactNode;
}) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [checked, setChecked] = React.useState<string[]>([]);
  const [signerName, setSignerName] = React.useState(defaults.customerName);
  const [signerEmail, setSignerEmail] = React.useState(defaults.customerEmail);
  // Co-borrower signs in parallel with the customer; the company rep counter-signs after.
  const [coOpen, setCoOpen] = React.useState(false);
  const [coName, setCoName] = React.useState(defaults.coOwnerName ?? "");
  const [coEmail, setCoEmail] = React.useState("");
  const [repOpen, setRepOpen] = React.useState(false);
  const [repName, setRepName] = React.useState(defaults.repName);
  const [repEmail, setRepEmail] = React.useState(defaults.repEmail);
  const [pending, setPending] = React.useState(false);
  const [result, setResult] = React.useState<{ sent: SentDoc[]; failed: { templateId: string; error: string }[] } | null>(
    null,
  );

  const byId = React.useMemo(() => new Map(templates.map((t) => [t.id, t])), [templates]);

  function toggle(id: string) {
    setChecked((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id]));
  }

  async function send() {
    if (checked.length === 0) return;
    if (!signerName.trim()) {
      toast.error("Enter the customer's name.");
      return;
    }
    if (coOpen && !coName.trim()) {
      toast.error("Enter the co-borrower's name, or remove them.");
      return;
    }
    if (repOpen && !repName.trim()) {
      toast.error("Enter the company rep's name, or remove them.");
      return;
    }

    type Signer = {
      role: "customer" | "co_customer" | "company_rep" | "witness";
      name: string;
      email: string;
      order: number;
    };
    const signers: Signer[] = [
      { role: "customer", name: signerName.trim(), email: signerEmail.trim(), order: 1 },
    ];
    if (coOpen && coName.trim()) {
      signers.push({ role: "co_customer", name: coName.trim(), email: coEmail.trim(), order: 1 });
    }
    if (repOpen && repName.trim()) {
      signers.push({ role: "company_rep", name: repName.trim(), email: repEmail.trim(), order: 2 });
    }

    setPending(true);
    // Keep the order the rep checked them in, not click order.
    const templateIds = templates.filter((t) => checked.includes(t.id)).map((t) => t.id);
    const res = await sendDocumentsAction({ leadId, templateIds, signers });
    setPending(false);

    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    setResult({ sent: res.sent, failed: res.failed });
    if (res.sent.length > 0) {
      toast.success(res.sent.length === 1 ? "Document sent for signature." : `${res.sent.length} documents sent.`);
      router.refresh();
    }
    if (res.sent.length === 0) toast.error("Nothing could be sent — see the reasons listed.");
  }

  function reset() {
    setChecked([]);
    setResult(null);
    setSignerName(defaults.customerName);
    setSignerEmail(defaults.customerEmail);
    setCoOpen(false);
    setCoName(defaults.coOwnerName ?? "");
    setCoEmail("");
    setRepOpen(false);
    setRepName(defaults.repName);
    setRepEmail(defaults.repEmail);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) reset();
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileSignature className="size-5 text-[#F4631E]" /> Send documents
          </DialogTitle>
          <DialogDescription>
            Each document you check is sent to {defaults.customerName || "the customer"} for signature with its own
            private link.
          </DialogDescription>
        </DialogHeader>

        {templates.length === 0 ? (
          // A button that opens onto nothing is worse than an explanation.
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              There are no contract templates in this workspace yet. Add one in Documents, map its fields to auto-fill
              from the deal, and it will show up here.
            </p>
            <DialogFooter>
              <Link href="/portal/documents">
                <Button className="bg-[#F4631E] text-white hover:bg-[#F4631E]/90">Go to Documents</Button>
              </Link>
            </DialogFooter>
          </div>
        ) : result ? (
          <div className="space-y-4">
            {result.sent.map((doc) => (
              <div key={doc.packageId} data-testid="sent-doc" className="space-y-2 rounded-lg border border-border p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium">{doc.title}</span>
                  {/* Customer standing right there? Hand them this device. */}
                  <InPersonSignButton packageId={doc.packageId} label="Sign in person" />
                </div>
                {doc.links.map((l) => (
                  <div key={l.url} className="space-y-1">
                    <Label className="text-xs text-muted-foreground">{l.name}</Label>
                    <div className="flex gap-2">
                      <Input readOnly value={l.url} className="text-xs" onFocus={(e) => e.currentTarget.select()} />
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        aria-label={`Copy signing link for ${l.name}`}
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
              </div>
            ))}

            {result.failed.map((f) => (
              <div
                key={f.templateId}
                className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm"
              >
                <AlertCircle className="mt-0.5 size-4 shrink-0 text-destructive" />
                <span>
                  <strong>{byId.get(f.templateId)?.name ?? "Document"}</strong> didn&apos;t send — {f.error}
                </span>
              </div>
            ))}

            {result.sent.length > 0 && (
              <p className="text-xs text-muted-foreground">
                Each signer with an email already has their link. These links are private — don&apos;t forward them.
              </p>
            )}

            <DialogFooter>
              <Button onClick={() => setOpen(false)}>Done</Button>
            </DialogFooter>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Documents to send</Label>
              <ul className="divide-y divide-border rounded-lg border border-border">
                {templates.map((t) => (
                  <li key={t.id}>
                    <label className="flex cursor-pointer items-center gap-3 px-3 py-2.5">
                      <Checkbox checked={checked.includes(t.id)} onCheckedChange={() => toggle(t.id)} />
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium">{t.name}</span>
                        <span className="block text-xs capitalize text-muted-foreground">{t.type.replace(/_/g, " ")}</span>
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            </div>

            {/* Primary signer — already known, since this is that customer's deal. */}
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="send-docs-name">Signer name</Label>
                <Input id="send-docs-name" value={signerName} onChange={(e) => setSignerName(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="send-docs-email">Signer email</Label>
                <Input id="send-docs-email" value={signerEmail} onChange={(e) => setSignerEmail(e.target.value)} />
              </div>
            </div>

            {coOpen ? (
              <div className="space-y-3 rounded-lg border border-border p-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">Co-borrower</span>
                  <Button type="button" variant="ghost" size="xs" onClick={() => setCoOpen(false)}>
                    <X className="size-3.5" /> Remove
                  </Button>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label>Name</Label>
                    <Input placeholder="Co-borrower name" value={coName} onChange={(e) => setCoName(e.target.value)} />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Email</Label>
                    <Input placeholder="Co-borrower email" value={coEmail} onChange={(e) => setCoEmail(e.target.value)} />
                  </div>
                </div>
              </div>
            ) : (
              <Button type="button" variant="outline" size="sm" onClick={() => setCoOpen(true)}>
                <Plus className="size-4" /> Add co-borrower
              </Button>
            )}

            {repOpen ? (
              <div className="space-y-3 rounded-lg border border-border p-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">Company rep (counter-signs last)</span>
                  <Button type="button" variant="ghost" size="xs" onClick={() => setRepOpen(false)}>
                    <X className="size-3.5" /> Remove
                  </Button>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label>Name</Label>
                    <Input placeholder="Company rep name" value={repName} onChange={(e) => setRepName(e.target.value)} />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Email</Label>
                    <Input placeholder="Company rep email" value={repEmail} onChange={(e) => setRepEmail(e.target.value)} />
                  </div>
                </div>
              </div>
            ) : (
              <Button type="button" variant="outline" size="sm" onClick={() => setRepOpen(true)}>
                <Plus className="size-4" /> Add company rep
              </Button>
            )}

            <DialogFooter>
              <Button
                onClick={send}
                disabled={pending || checked.length === 0}
                className="bg-[#F4631E] text-white hover:bg-[#F4631E]/90"
              >
                {pending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
                {checked.length <= 1 ? "Send document" : `Send ${checked.length} documents`}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
