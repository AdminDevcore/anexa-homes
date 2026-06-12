"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Send, Copy, FileSignature, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { sendDocumentAction } from "@/server/modules/esign/actions";

type Template = { id: string; name: string };
type Lead = { id: string; name: string; email: string };

export function SendDocumentDialog({
  templates,
  leads,
}: {
  templates: Template[];
  leads: Lead[];
}) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [templateId, setTemplateId] = React.useState("");
  const [leadId, setLeadId] = React.useState("");
  const [signerName, setSignerName] = React.useState("");
  const [signerEmail, setSignerEmail] = React.useState("");
  // Optional co-borrower (signs in parallel with the customer).
  const [coOpen, setCoOpen] = React.useState(false);
  const [coName, setCoName] = React.useState("");
  const [coEmail, setCoEmail] = React.useState("");
  // Optional company rep (counter-signs after the customers).
  const [repOpen, setRepOpen] = React.useState(false);
  const [repName, setRepName] = React.useState("");
  const [repEmail, setRepEmail] = React.useState("");
  const [pending, setPending] = React.useState(false);
  const [links, setLinks] = React.useState<{ name: string; url: string }[] | null>(null);

  function onSelectLead(id: string) {
    setLeadId(id);
    const lead = leads.find((l) => l.id === id);
    if (lead) {
      setSignerName(lead.name);
      setSignerEmail(lead.email);
    }
  }

  async function send() {
    if (!templateId || !leadId || !signerName.trim()) {
      toast.error("Choose a template, a lead, and a signer.");
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

    // Customer + co-borrower share order 1 (either may sign first); the company
    // rep is order 2 so they counter-sign after both customers.
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
    const res = await sendDocumentAction({ templateId, leadId, signers });
    setPending(false);
    if (res.ok) {
      setLinks(res.links);
      toast.success("Document sent for signature.");
      router.refresh();
    } else {
      toast.error(res.error);
    }
  }

  function reset() {
    setLinks(null);
    setTemplateId("");
    setLeadId("");
    setSignerName("");
    setSignerEmail("");
    setCoOpen(false);
    setCoName("");
    setCoEmail("");
    setRepOpen(false);
    setRepName("");
    setRepEmail("");
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button className="bg-gold text-gold-foreground hover:bg-gold/90">
          <Send className="size-4" /> Send for Signature
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileSignature className="size-5 text-gold" /> Send Document for Signature
          </DialogTitle>
        </DialogHeader>

        {links ? (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Document sent. A signing link was emailed to each signer with an email — you can also
              share these secure links directly:
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
        ) : (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Template</Label>
              <Select value={templateId} onValueChange={setTemplateId}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Choose a document" />
                </SelectTrigger>
                <SelectContent>
                  {templates.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Lead / Customer</Label>
              <Select value={leadId} onValueChange={onSelectLead}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Choose a lead" />
                </SelectTrigger>
                <SelectContent>
                  {leads.map((l) => (
                    <SelectItem key={l.id} value={l.id}>
                      {l.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Primary signer */}
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Signer name</Label>
                <Input value={signerName} onChange={(e) => setSignerName(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Signer email</Label>
                <Input value={signerEmail} onChange={(e) => setSignerEmail(e.target.value)} />
              </div>
            </div>

            {/* Co-borrower */}
            {coOpen ? (
              <div className="space-y-3 rounded-lg border border-border p-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">Co-borrower</span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="xs"
                    onClick={() => {
                      setCoOpen(false);
                      setCoName("");
                      setCoEmail("");
                    }}
                  >
                    <X className="size-3.5" /> Remove
                  </Button>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label>Name</Label>
                    <Input
                      placeholder="Co-borrower name"
                      value={coName}
                      onChange={(e) => setCoName(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Email</Label>
                    <Input
                      placeholder="Co-borrower email"
                      value={coEmail}
                      onChange={(e) => setCoEmail(e.target.value)}
                    />
                  </div>
                </div>
              </div>
            ) : (
              <Button type="button" variant="outline" size="sm" onClick={() => setCoOpen(true)}>
                <Plus className="size-4" /> Add co-borrower
              </Button>
            )}

            {/* Company rep */}
            {repOpen ? (
              <div className="space-y-3 rounded-lg border border-border p-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">Company rep (counter-signs last)</span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="xs"
                    onClick={() => {
                      setRepOpen(false);
                      setRepName("");
                      setRepEmail("");
                    }}
                  >
                    <X className="size-3.5" /> Remove
                  </Button>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label>Name</Label>
                    <Input
                      placeholder="Company rep name"
                      value={repName}
                      onChange={(e) => setRepName(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Email</Label>
                    <Input
                      placeholder="Company rep email"
                      value={repEmail}
                      onChange={(e) => setRepEmail(e.target.value)}
                    />
                  </div>
                </div>
              </div>
            ) : (
              <Button type="button" variant="outline" size="sm" onClick={() => setRepOpen(true)}>
                <Plus className="size-4" /> Add company rep
              </Button>
            )}

            <DialogFooter>
              <Button onClick={send} disabled={pending} className="bg-gold text-gold-foreground hover:bg-gold/90">
                {pending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
                Send
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
