"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Lock, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { uploadFileAction } from "@/server/modules/files/actions";
import { CONTRACTOR_INVOICE_CATEGORY } from "@/lib/contractor-invoice";

/**
 * A letter slot. Invoices go in; nothing is ever listed, opened or deleted
 * here, by anyone.
 *
 * It renders no file list because it is GIVEN none — the server strips them
 * before this component exists, and only a count crosses. That distinction is
 * the whole feature: a box that received the files and merely declined to draw
 * them would be a curtain, not a lock, because every id it held would be a
 * working URL. The invoice is read in Contractor Pay and nowhere else. See
 * src/lib/contractor-invoice.ts.
 *
 * Two callers, one component: the Contractor Invoice folder on a deal (which
 * knows the lead) and the installer's job page (which knows only the project,
 * because an installer may not read the deal). `uploadFileAction` resolves a
 * project to its deal, so both land in the same folder and the same list.
 *
 * The plain sentence about where it goes is not decoration. Somebody about to
 * hand over a bill they will not see again deserves to be told that before
 * they start wondering whether the upload failed.
 */
export function InvoiceDropBox({
  leadId,
  projectId,
  submitted,
  canUpload,
}: {
  leadId?: string | null;
  projectId?: string | null;
  /** How many invoices this job already holds. A count, never the files. */
  submitted: number;
  canUpload: boolean;
}) {
  const router = useRouter();
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [busy, setBusy] = React.useState(false);

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = e.target.files;
    if (!picked || picked.length === 0) return;
    setBusy(true);
    let failed = 0;
    let lastError = "";
    try {
      for (const file of Array.from(picked)) {
        const fd = new FormData();
        fd.set("file", file);
        if (leadId) fd.set("leadId", leadId);
        if (projectId) fd.set("projectId", projectId);
        fd.set("category", CONTRACTOR_INVOICE_CATEGORY);
        const res = await uploadFileAction(fd);
        if (!res.ok) {
          failed += 1;
          lastError = res.error;
        }
      }
    } finally {
      // In a `finally` deliberately. A server action that throws used to leave
      // this latched true, and a stuck busy flag reads, to the person holding
      // the invoice, as a dead button.
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
    if (failed) toast.error(lastError || `${failed} invoice(s) failed to upload.`);
    else toast.success(picked.length === 1 ? "Invoice submitted" : `${picked.length} invoices submitted`);
    router.refresh();
  }

  return (
    <div className="space-y-4">
      {canUpload && (
        <>
          <input
            ref={inputRef}
            type="file"
            accept="image/*,application/pdf"
            multiple
            className="hidden"
            onChange={onPick}
          />
          <Button size="sm" disabled={busy} onClick={() => inputRef.current?.click()}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
            Submit an invoice
          </Button>
        </>
      )}

      <div className="rounded-lg border border-dashed border-border bg-muted/30 p-4">
        <p className="flex items-center gap-2 text-sm font-medium">
          <Lock className="size-4 shrink-0 text-muted-foreground" />
          {submitted === 0
            ? "No invoice submitted yet"
            : submitted === 1
              ? "1 invoice submitted"
              : `${submitted} invoices submitted`}
        </p>
        <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
          An invoice dropped here can&apos;t be opened again from the job — not by you, and
          not by anyone else working it. It goes straight to <strong>Contractor Pay</strong>,
          where accounting reads it against the job name, who submitted it and when.
        </p>
      </div>
    </div>
  );
}
