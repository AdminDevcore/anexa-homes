"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Upload, Loader2, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { uploadTemplatePdfAction } from "@/server/modules/esign/actions";

export function TemplatePdfUploader({
  templateId,
  hasPdf,
}: {
  templateId: string;
  hasPdf: boolean;
}) {
  const router = useRouter();
  const inputRef = React.useRef<HTMLInputElement | null>(null);
  const [pending, setPending] = React.useState(false);

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setPending(true);
    const fd = new FormData();
    fd.append("templateId", templateId);
    fd.append("file", file);
    const res = await uploadTemplatePdfAction(fd);
    setPending(false);
    if (inputRef.current) inputRef.current.value = "";
    if (res.ok) {
      toast.success(`PDF uploaded (${res.pages} page${res.pages === 1 ? "" : "s"})`);
      router.refresh();
    } else {
      toast.error(res.error);
    }
  }

  return (
    <div className="flex items-center gap-3 rounded-xl border border-border bg-card p-4">
      <span className="grid size-10 place-items-center rounded-lg bg-gold/12 text-gold-muted">
        <FileText className="size-5" />
      </span>
      <div className="flex-1">
        <div className="text-sm font-medium">{hasPdf ? "PDF uploaded" : "Use your own PDF"}</div>
        <div className="text-xs text-muted-foreground">
          {hasPdf
            ? "Drag fields onto your document below. Upload again to replace it."
            : "Upload a PDF and place signature, date, text, and auto-fill fields on it."}
        </div>
      </div>
      <input ref={inputRef} type="file" accept="application/pdf" className="hidden" onChange={onPick} />
      <Button variant="outline" size="sm" disabled={pending} onClick={() => inputRef.current?.click()}>
        {pending ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
        {hasPdf ? "Replace PDF" : "Upload PDF"}
      </Button>
    </div>
  );
}
