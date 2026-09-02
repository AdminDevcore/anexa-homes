"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Send, FileSignature, Plus, X, Copy, Layers } from "lucide-react";
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
  coOwnerEmail: string | null;
  /**
   * Who signs for the company, and their title — named so the rep can see
   * whose signature is about to go on the document. Null when nobody is set
   * up, which is also the state in which a document with a company signature
   * block refuses to send.
   */
  companySigner: { name: string; title: string } | null;
};

type SentEnvelope = { title: string; packageId: string; links: { name: string; url: string }[] };

/**
 * "Send docs" from the proposal. Same e-sign engine as the Documents page, minus
 * the lead picker — the deal is already known here, so the rep only chooses WHICH
 * documents.
 *
 * Everything checked goes out as ONE envelope: one email, one signing link, one
 * signature, and one merged PDF filed on the deal. A customer buying one job
 * should not have to sign three times because the office keeps three templates.
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
  // The co-owner signs in parallel with the customer. Opened by default when
  // the deal has one, because a spouse on the title is on the contract — having
  // to remember to tick them is how they end up on one document and not the
  // next. Our own half is applied by the send; there is nothing to type for it.
  const [coOpen, setCoOpen] = React.useState(!!defaults.coOwnerName);
  const [coName, setCoName] = React.useState(defaults.coOwnerName ?? "");
  const [coEmail, setCoEmail] = React.useState(defaults.coOwnerEmail ?? "");
  const [pending, setPending] = React.useState(false);
  const [result, setResult] = React.useState<SentEnvelope | null>(null);

  const byId = React.useMemo(() => new Map(templates.map((t) => [t.id, t])), [templates]);

  // CHECK order, which is what `checked` already holds. It is the only order the
  // rep can actually control, and in one envelope order is meaningful — the
  // agreement should print before the certificate that follows it. The picker
  // shows it back so nobody has to guess.
  const bundleIds = React.useMemo(() => checked.filter((id) => byId.has(id)), [checked, byId]);
  const bundleOrder = bundleIds.map((id) => byId.get(id)!.name);

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
      toast.error("Enter the co-owner's name, or remove them.");
      return;
    }
    if (coOpen && coName.trim() && !coEmail.trim()) {
      toast.error("The co-owner needs an email to be sent a link, or remove them.");
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
    if (coOpen && coName.trim() && coEmail.trim()) {
      signers.push({ role: "co_customer", name: coName.trim(), email: coEmail.trim(), order: 1 });
    }

    setPending(true);
    const res = await sendDocumentsAction({ leadId, templateIds: bundleIds, signers });
    setPending(false);

    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    setResult({ title: res.title, packageId: res.packageId, links: res.links });
    toast.success(
      bundleIds.length === 1
        ? "Document sent for signature."
        : `${bundleIds.length} documents sent as one signature request.`,
    );
    router.refresh();
  }

  function reset() {
    setChecked([]);
    setResult(null);
    setSignerName(defaults.customerName);
    setSignerEmail(defaults.customerEmail);
    setCoOpen(!!defaults.coOwnerName);
    setCoName(defaults.coOwnerName ?? "");
    setCoEmail(defaults.coOwnerEmail ?? "");
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
            Everything you check goes to {defaults.customerName || "the customer"} as one signature request — a single
            private link covering all of it.
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
            <div data-testid="sent-doc" className="space-y-2 rounded-lg border border-border p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium">{result.title}</span>
                {/* Customer standing right there? Hand them this device. */}
                <InPersonSignButton packageId={result.packageId} label="Sign in person" />
              </div>
              {result.links.map((l) => (
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

            <p className="text-xs text-muted-foreground">
              One link covers every document — the signer scrolls through them and signs once. Each signer with an
              email already has theirs. These links are private; don&apos;t forward them.
            </p>

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
              {checked.length > 1 && (
                <p className="flex items-start gap-1.5 rounded-lg bg-muted/50 px-2.5 py-2 text-xs text-muted-foreground">
                  <Layers className="mt-0.5 size-3.5 shrink-0" />
                  <span>
                    Sent as one signature request, in this order:{" "}
                    <strong className="text-foreground">{bundleOrder.join(" → ")}</strong>
                  </span>
                </p>
              )}
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
                  <span className="text-sm font-medium">Co-owner</span>
                  <Button type="button" variant="ghost" size="xs" onClick={() => setCoOpen(false)}>
                    <X className="size-3.5" /> Remove
                  </Button>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label>Name</Label>
                    <Input placeholder="Co-owner name" value={coName} onChange={(e) => setCoName(e.target.value)} />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Email</Label>
                    <Input placeholder="Co-owner email" value={coEmail} onChange={(e) => setCoEmail(e.target.value)} />
                  </div>
                </div>
              </div>
            ) : (
              <Button type="button" variant="outline" size="sm" onClick={() => setCoOpen(true)}>
                <Plus className="size-4" /> Add co-owner
              </Button>
            )}

            {/* Our half of the document. Stated, not asked for. */}
            <div className="rounded-lg border border-border bg-muted/30 p-3">
              {defaults.companySigner ? (
                <>
                  <p className="text-sm">
                    Signed for us by{" "}
                    <span className="font-medium">{defaults.companySigner.name}</span>
                    {defaults.companySigner.title ? ` — ${defaults.companySigner.title}` : ""}
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Applied automatically on any document with a company signature block. Changed
                    in Settings → Authorised signers.
                  </p>
                </>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Nobody is set up to sign on the company&apos;s behalf. Documents with a company
                  signature block cannot be sent until somebody is added in Settings → Authorised
                  signers.
                </p>
              )}
            </div>

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
