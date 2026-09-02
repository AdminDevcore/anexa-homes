"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import Link from "next/link";
import { updateTemplateAction } from "@/server/modules/esign/actions";

/** A folder this document can file into, already narrowed to one vertical. */
export type DestinationOption = { key: string; label: string };

/**
 * The closeout-packet control, or null on a vertical that does not send one.
 *
 * Null rather than `false` on purpose: roofing has no packet at all, and a
 * tick box nothing reads is worse than no tick box.
 */
export type FinalPacketState = {
  checked: boolean;
  /** 0-based place in the packet, or -1 when this document is not in it. */
  position: number;
  total: number;
};

/** The value the Select uses for "no destination chosen" — Radix rejects "". */
const NO_FOLDER = "__none__";
/** Likewise for "whoever the company's default signer is". */
const DEFAULT_SIGNER = "__default__";

/** An authorised signer, as the picker offers them. */
export type SignerOption = { id: string; name: string; title: string; isDefault: boolean };

/**
 * What this template is called and where its signed document goes.
 *
 * The name was unreachable before this: templates were created as "Untitled
 * contract" and nothing ever wrote the column, so a company with four documents
 * had four rows with the same name — and packages, which take their title from
 * here, inherited it. Naming and filing belong together, so they share a card.
 */
export function TemplateSettings({
  templateId,
  initialName,
  initialFolderKey,
  finalPacket,
  destinations,
  fallbackLabel,
  signers,
  initialCompanySignerId,
  hasCompanyFields,
}: {
  templateId: string;
  initialName: string;
  initialFolderKey: string | null;
  finalPacket: FinalPacketState | null;
  destinations: DestinationOption[];
  /** Where a document goes when no folder is chosen — Contract, in both verticals. */
  fallbackLabel: string;
  /** Everyone authorised to sign for the company. Empty until somebody is added. */
  signers: SignerOption[];
  initialCompanySignerId: string | null;
  /** True when this document actually has a company signature block to fill. */
  hasCompanyFields: boolean;
}) {
  const router = useRouter();
  const [name, setName] = React.useState(initialName);
  const [folderKey, setFolderKey] = React.useState(initialFolderKey ?? NO_FOLDER);
  const [inPacket, setInPacket] = React.useState(finalPacket?.checked ?? false);
  const [signerId, setSignerId] = React.useState(initialCompanySignerId ?? DEFAULT_SIGNER);
  const [pending, setPending] = React.useState(false);

  const dirty =
    name !== initialName ||
    (initialFolderKey ?? NO_FOLDER) !== folderKey ||
    (initialCompanySignerId ?? DEFAULT_SIGNER) !== signerId ||
    (finalPacket ? inPacket !== finalPacket.checked : false);

  async function save() {
    const trimmed = name.trim();
    if (!trimmed) {
      toast.error("Give the template a name.");
      return;
    }
    setPending(true);
    const res = await updateTemplateAction({
      id: templateId,
      name: trimmed,
      folderKey: folderKey === NO_FOLDER ? "" : folderKey,
      companySignerId: signerId === DEFAULT_SIGNER ? "" : signerId,
      // Left off entirely on a vertical with no packet, so the server keeps
      // whatever the column already held.
      ...(finalPacket ? { finalPacket: inPacket } : {}),
    });
    setPending(false);
    if (res.ok) {
      toast.success("Saved");
      router.refresh();
    } else {
      toast.error(res.error);
    }
  }

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="template-name">Name</Label>
          <Input
            id="template-name"
            value={name}
            maxLength={120}
            placeholder="Certificate of Acceptance"
            onChange={(e) => setName(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            What this document is called everywhere — the template list, and the title on
            every copy sent for signature.
          </p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="template-folder">Files into</Label>
          <Select value={folderKey} onValueChange={setFolderKey}>
            <SelectTrigger id="template-folder" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NO_FOLDER}>{fallbackLabel} (default)</SelectItem>
              {destinations.map((d) => (
                <SelectItem key={d.key} value={d.key}>
                  {d.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            The folder on the deal this document lands in once it is sent. Documents
            already sent keep the folder they were sent with.
          </p>
        </div>
      </div>

      {/*
        * Only offered where there is something to sign.
        *
        * A template with no company fields has nowhere to put a signature, so a
        * picker on it would be a setting with no effect — and the send path
        * would ignore it, which is the worst kind of control.
        */}
      {hasCompanyFields && (
        <div className="mt-4 space-y-1.5">
          <Label htmlFor="template-signer">Signed on our behalf by</Label>
          {signers.length === 0 ? (
            <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs leading-relaxed text-amber-900 dark:text-amber-200">
              This document has a company signature block, but nobody is set up to sign it — so it
              cannot be sent. Add somebody in{" "}
              <Link href="/portal/settings/signers" className="underline underline-offset-2">
                Settings → Authorised signers
              </Link>
              .
            </p>
          ) : (
            <>
              <Select value={signerId} onValueChange={setSignerId}>
                <SelectTrigger id="template-signer" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={DEFAULT_SIGNER}>{defaultSignerLabel(signers)}</SelectItem>
                  {signers.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                      {s.title ? ` — ${s.title}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Their name, title, licence and signature are stamped in the moment this document is
                sent — they are not emailed a link. The certificate records who applied it.
              </p>
            </>
          )}
        </div>
      )}

      {finalPacket && (
        <label className="mt-4 flex cursor-pointer items-start gap-3 rounded-lg border border-border bg-background p-3">
          <Checkbox
            checked={inPacket}
            onCheckedChange={(v) => setInPacket(v === true)}
            className="mt-0.5"
            aria-label="Part of the final documents packet"
          />
          <span className="space-y-1">
            <span className="block text-sm font-medium">Part of the final documents packet</span>
            <span className="block text-xs text-muted-foreground">
              {packetHint(inPacket, finalPacket)}
            </span>
          </span>
        </label>
      )}

      <div className="mt-4 flex justify-end">
        <Button size="sm" disabled={pending || !dirty} onClick={save}>
          {pending ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
          Save
        </Button>
      </div>
    </div>
  );
}

/** Names the default in the option, so "Company default" is never a mystery. */
function defaultSignerLabel(signers: SignerOption[]): string {
  const d = signers.find((s) => s.isDefault);
  return d ? `Company default — ${d.name}` : "Company default (nobody set)";
}

/**
 * What ticking this box means, in the packet's own terms.
 *
 * The position only reads back once it is saved — the count comes from the
 * server, so a box just ticked describes where it will land rather than
 * claiming a place it does not hold yet.
 */
function packetHint(checked: boolean, state: FinalPacketState): string {
  if (!checked) {
    return "Tick this to send it with \u201CSend final docs to customer\u201D on the deal, once the install is finished.";
  }
  if (state.checked && state.position >= 0) {
    const total = state.total;
    return `Goes out with \u201CSend final docs to customer\u201D \u2014 ${ordinal(state.position + 1)} of ${total} in the packet.`;
  }
  return "Save to add it to the packet. Documents print in the order they were created.";
}

function ordinal(n: number): string {
  const suffix = n % 100 >= 11 && n % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] ?? "th";
  return `${n}${suffix}`;
}
