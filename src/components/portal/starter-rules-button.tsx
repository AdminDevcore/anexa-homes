"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Sparkles, Mail, Bell } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  previewStarterNotificationRulesAction,
  applyStarterNotificationRulesAction,
} from "@/server/modules/notifications/actions";

type Preview = { name: string; event: string; channels: string[]; recipients: string[] };

/**
 * Fill an empty workspace with a starter set of notification rules.
 *
 * Deliberately preview-then-confirm rather than one click. Every other "use the
 * standard list" button in Settings only changes what an admin sees; this one
 * starts sending email to real staff the next time a deal moves. So the exact
 * set — and which rows carry email — is shown before it exists, not after.
 */
export function StarterRulesButton({ hasRules }: { hasRules: boolean }) {
  const router = useRouter();
  const [preview, setPreview] = React.useState<Preview[] | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [applying, setApplying] = React.useState(false);

  async function load() {
    setLoading(true);
    const res = await previewStarterNotificationRulesAction();
    setLoading(false);
    if (!res.ok) return toast.error(res.error);
    if (res.rules.length === 0) return toast.info("This workspace already has every starter rule.");
    setPreview(res.rules);
  }

  async function apply() {
    setApplying(true);
    const res = await applyStarterNotificationRulesAction();
    setApplying(false);
    if (!res.ok) return toast.error(res.error);
    setPreview(null);
    toast.success(`${res.created} rule${res.created === 1 ? "" : "s"} created`);
    router.refresh();
  }

  if (!preview) {
    return (
      <Button size="sm" variant={hasRules ? "ghost" : "outline"} onClick={load} disabled={loading} className="gap-1.5">
        {loading ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
        Use the standard set
      </Button>
    );
  }

  const emailCount = preview.filter((r) => r.channels.includes("email")).length;

  return (
    <div className="w-full rounded-xl border border-border bg-card p-5 text-left">
      <h3 className="font-semibold">
        {preview.length} rule{preview.length === 1 ? "" : "s"} will be created
      </h3>
      <p className="mt-1 text-sm text-muted-foreground">
        {emailCount} of them send email. Nothing is sent for deals that already moved — these apply
        from the next change onward. You can edit or switch off any rule afterwards.
      </p>

      <div className="mt-4 max-h-80 space-y-1.5 overflow-y-auto">
        {preview.map((r) => (
          <div
            key={r.name}
            className="flex items-start gap-3 rounded-lg border border-border/60 px-3 py-2"
          >
            <span
              className={`mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider ${
                r.channels.includes("email")
                  ? "bg-amber-500/15 text-amber-600 dark:text-amber-400"
                  : "bg-muted text-muted-foreground"
              }`}
            >
              {r.channels.includes("email") ? (
                <span className="inline-flex items-center gap-1">
                  <Mail className="size-2.5" /> Email
                </span>
              ) : (
                <span className="inline-flex items-center gap-1">
                  <Bell className="size-2.5" /> In-app
                </span>
              )}
            </span>
            <span className="min-w-0">
              <span className="block text-sm font-medium">{r.name}</span>
              <span className="block text-xs text-muted-foreground">to {r.recipients.join(", ")}</span>
            </span>
          </div>
        ))}
      </div>

      <div className="mt-4 flex gap-2">
        <Button size="sm" onClick={apply} disabled={applying} className="gap-1.5">
          {applying ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
          Create these {preview.length} rules
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setPreview(null)} disabled={applying}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
