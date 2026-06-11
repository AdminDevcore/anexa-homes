"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { createTemplateAction } from "@/server/modules/esign/actions";

/** Creates a blank contract template in the active workspace, then opens its editor. */
export function NewTemplateButton() {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);

  async function create() {
    setBusy(true);
    const res = await createTemplateAction();
    setBusy(false);
    if (!res.ok) return toast.error(res.error);
    router.push(`/portal/documents/templates/${res.id}`);
  }

  return (
    <Button size="sm" onClick={create} disabled={busy} className="bg-gold text-gold-foreground hover:bg-gold/90">
      {busy ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />} New template
    </Button>
  );
}
