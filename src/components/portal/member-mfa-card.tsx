"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, ShieldCheck, ShieldAlert, ShieldOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { resetMemberMfaAction } from "@/server/modules/team/actions";

/**
 * SOMEBODY'S SECOND FACTOR, AND THE WAY BACK FROM A LOST PHONE.
 *
 * Without this the lost-phone path did not exist. A person who loses both their
 * phone and their recovery codes could never approve a payment again, and the
 * only remedy would have been editing the production database by hand.
 *
 * The button is shown to the OWNER ONLY, and never on your own account — a
 * factor you can remove yourself protects nothing, because anyone holding a
 * live session could strip it before moving money. Both rules are enforced in
 * `resetEnrollment`, not here; this only decides what to draw.
 */
export function MemberMfaCard({
  userId,
  name,
  enrolled,
  pending,
  recoveryCodesRemaining,
  canReset,
}: {
  userId: string;
  name: string;
  enrolled: boolean;
  pending: boolean;
  recoveryCodesRemaining: number;
  canReset: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);

  const remove = async () => {
    setBusy(true);
    try {
      const res = await resetMemberMfaAction(userId);
      if (!res.ok) return void toast.error(res.error);
      toast.success(
        res.removed
          ? `${name} can set up a new authenticator now.`
          : `${name} had no authenticator set up.`
      );
      setOpen(false);
      router.refresh();
    } finally {
      setBusy(false);
    }
  };

  const Icon = enrolled ? ShieldCheck : pending ? ShieldAlert : ShieldOff;
  const tone = enrolled
    ? "text-emerald-600 dark:text-emerald-400"
    : pending
      ? "text-amber-600 dark:text-amber-400"
      : "text-muted-foreground";

  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <h3 className="flex items-center gap-2 font-semibold">
        <Icon className={`size-4 ${tone}`} />
        Second factor
      </h3>
      <p className="mt-1 text-xs text-muted-foreground">
        Required to approve a payment. Nothing else uses it.
      </p>

      <p className="mt-3 text-sm">
        {enrolled ? (
          <>
            Authenticator active ·{" "}
            <span className="text-muted-foreground">
              {recoveryCodesRemaining} recovery{" "}
              {recoveryCodesRemaining === 1 ? "code" : "codes"} left
            </span>
          </>
        ) : pending ? (
          <span className="text-muted-foreground">Setup started but never finished.</span>
        ) : (
          <span className="text-muted-foreground">Not set up.</span>
        )}
      </p>

      {canReset && (enrolled || pending) && (
        <Button variant="outline" size="sm" className="mt-4" onClick={() => setOpen(true)}>
          Remove authenticator
        </Button>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove {name}&rsquo;s authenticator?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Do this only when they have lost both their phone and their recovery codes. They will
            be able to set up a new authenticator, and until they do they cannot approve a payment.
          </p>
          <p className="text-sm text-muted-foreground">
            This is recorded against your name in the activity log.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button onClick={remove} disabled={busy}>
              {busy && <Loader2 className="size-4 animate-spin" />}
              Remove it
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
