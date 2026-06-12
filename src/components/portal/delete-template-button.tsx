"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Trash2, Loader2 } from "lucide-react";
import { deleteTemplateAction } from "@/server/modules/esign/actions";

export function DeleteTemplateButton({ id, name }: { id: string; name: string }) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);

  async function del() {
    if (!confirm(`Delete the "${name}" template? Documents you've already sent are unaffected.`)) return;
    setBusy(true);
    const res = await deleteTemplateAction(id);
    setBusy(false);
    if (!res.ok) return toast.error(res.error);
    toast.success("Template deleted.");
    router.refresh();
  }

  return (
    <button
      onClick={del}
      disabled={busy}
      className="text-muted-foreground hover:text-destructive disabled:opacity-50"
      aria-label="Delete template"
    >
      {busy ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
    </button>
  );
}
