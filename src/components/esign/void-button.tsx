"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Ban, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { voidDocumentAction } from "@/server/modules/esign/actions";

export function VoidButton({ packageId }: { packageId: string }) {
  const router = useRouter();
  const [pending, setPending] = React.useState(false);

  async function doVoid() {
    setPending(true);
    const res = await voidDocumentAction(packageId);
    setPending(false);
    if (res.ok) {
      toast.success("Document voided");
      router.refresh();
    } else {
      toast.error(res.error);
    }
  }

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="outline" size="sm" className="text-destructive">
          <Ban className="size-4" /> Void
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Void this document?</AlertDialogTitle>
          <AlertDialogDescription>
            This cancels the signature request. The audit trail is preserved. This cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={doVoid} disabled={pending}>
            {pending ? <Loader2 className="size-4 animate-spin" /> : null}
            Void document
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
