"use client";

import * as React from "react";
import { useRouter, usePathname } from "next/navigation";
import { toast } from "sonner";
import {
  Star,
  Check,
  X,
  Eye,
  EyeOff,
  Pencil,
  Trash2,
  Search,
  Loader2,
  Sparkles,
  Clock,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import {
  setReviewStatusAction,
  setReviewFeaturedAction,
  setReviewHiddenAction,
  editReviewAction,
  deleteReviewAction,
} from "@/server/modules/reviews/actions";
import type { AdminReview, AdminReviewFilter } from "@/server/modules/reviews/queries";

const FILTERS: { key: AdminReviewFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "pending", label: "Pending" },
  { key: "approved", label: "Approved" },
  { key: "rejected", label: "Rejected" },
];

function Stars({ n }: { n: number }) {
  return (
    <span className="inline-flex">
      {Array.from({ length: 5 }).map((_, i) => (
        <Star
          key={i}
          className={cn("size-4", i < n ? "fill-gold text-gold" : "text-muted-foreground/30")}
        />
      ))}
    </span>
  );
}

const STATUS_STYLES: Record<string, string> = {
  pending: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  approved: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  rejected: "bg-rose-500/15 text-rose-600 dark:text-rose-400",
};

export function ReviewsManager({
  reviews,
  counts,
  filter,
  query,
  canDelete,
}: {
  reviews: AdminReview[];
  counts: { all: number; pending: number; approved: number; rejected: number };
  filter: AdminReviewFilter;
  query: string;
  canDelete: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const [search, setSearch] = React.useState(query);
  const [editing, setEditing] = React.useState<AdminReview | null>(null);
  const [deleting, setDeleting] = React.useState<AdminReview | null>(null);

  function navigate(next: { filter?: AdminReviewFilter; q?: string }) {
    const params = new URLSearchParams();
    const f = next.filter ?? filter;
    const q = next.q ?? search;
    if (f && f !== "all") params.set("filter", f);
    if (q.trim()) params.set("q", q.trim());
    const qs = params.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  }

  async function run(id: string, p: Promise<{ ok: boolean; error?: string }>, success?: string) {
    setBusyId(id);
    const res = await p;
    setBusyId(null);
    if (!res.ok) {
      toast.error(res.error);
      return false;
    }
    if (success) toast.success(success);
    router.refresh();
    return true;
  }

  return (
    <div className="space-y-5">
      {/* Filters + search */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1.5">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => navigate({ filter: f.key })}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors",
                filter === f.key
                  ? "border-gold/40 bg-gold/15 text-gold-muted"
                  : "border-border bg-card text-muted-foreground hover:text-foreground"
              )}
            >
              {f.label}
              <span className="rounded-full bg-foreground/10 px-1.5 text-xs">{counts[f.key]}</span>
            </button>
          ))}
        </div>
        <form
          className="flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            navigate({ q: search });
          }}
        >
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name, city, service…"
              className="h-9 w-60 pl-8"
            />
          </div>
          <Button type="submit" variant="outline" size="sm">
            Search
          </Button>
        </form>
      </div>

      {reviews.length === 0 ? (
        <div className="rounded-xl border border-border bg-card px-5 py-16 text-center text-sm text-muted-foreground">
          No reviews{filter !== "all" ? ` with status “${filter}”` : ""}{query ? ` matching “${query}”` : ""}.
        </div>
      ) : (
        <div className="space-y-3">
          {reviews.map((r) => {
            const busy = busyId === r.id;
            return (
              <div key={r.id} className="rounded-xl border border-border bg-card p-5">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
                  {/* Photo */}
                  {r.photoUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={r.photoUrl} alt="" className="size-16 shrink-0 rounded-lg object-cover" />
                  ) : (
                    <span className="grid size-16 shrink-0 place-items-center rounded-lg bg-foreground/5 font-display text-xl font-semibold text-metal-dim">
                      {r.customerName.charAt(0)}
                    </span>
                  )}

                  {/* Body */}
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold">{r.customerName}</span>
                      <Stars n={r.rating} />
                      <Badge className={cn("border-0 capitalize", STATUS_STYLES[r.status])}>{r.status}</Badge>
                      {r.featured && (
                        <Badge className="gap-1 border-0 bg-gold/15 text-gold-muted">
                          <Sparkles className="size-3" /> Featured
                        </Badge>
                      )}
                      {r.hidden && r.status === "approved" && (
                        <Badge variant="outline" className="gap-1">
                          <EyeOff className="size-3" /> Hidden
                        </Badge>
                      )}
                      {!r.consentToPublish && (
                        <Badge variant="outline" className="text-amber-600">
                          No consent
                        </Badge>
                      )}
                    </div>
                    <div className="mt-0.5 text-xs text-muted-foreground">
                      {[r.city, r.serviceType].filter(Boolean).join(" · ") || "—"}
                      <span className="mx-1.5">·</span>
                      <Clock className="mr-1 inline size-3" />
                      {new Date(r.createdAt).toLocaleDateString()}
                      {r.approvedAt && r.approvedByName && (
                        <span className="ml-1.5">· approved by {r.approvedByName}</span>
                      )}
                    </div>
                    <p className="mt-2 text-sm leading-relaxed text-foreground/85">{r.reviewText}</p>

                    {/* Actions */}
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      {r.status !== "approved" && (
                        <Button
                          size="sm"
                          disabled={busy}
                          className="h-8 bg-emerald-600 text-white hover:bg-emerald-600/90"
                          onClick={() => run(r.id, setReviewStatusAction({ id: r.id, status: "approved" }), "Review approved")}
                        >
                          <Check className="size-4" /> Approve
                        </Button>
                      )}
                      {r.status !== "rejected" && (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busy}
                          className="h-8"
                          onClick={() => run(r.id, setReviewStatusAction({ id: r.id, status: "rejected" }), "Review rejected")}
                        >
                          <X className="size-4" /> Reject
                        </Button>
                      )}
                      {r.status === "approved" && (
                        <>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={busy}
                            className="h-8"
                            onClick={() =>
                              run(r.id, setReviewFeaturedAction({ id: r.id, featured: !r.featured }), r.featured ? "Unfeatured" : "Featured")
                            }
                          >
                            <Sparkles className="size-4" /> {r.featured ? "Unfeature" : "Feature"}
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={busy}
                            className="h-8"
                            onClick={() =>
                              run(r.id, setReviewHiddenAction({ id: r.id, hidden: !r.hidden }), r.hidden ? "Now visible" : "Hidden from site")
                            }
                          >
                            {r.hidden ? <Eye className="size-4" /> : <EyeOff className="size-4" />}
                            {r.hidden ? "Unhide" : "Hide"}
                          </Button>
                        </>
                      )}
                      <Button size="sm" variant="ghost" disabled={busy} className="h-8" onClick={() => setEditing(r)}>
                        <Pencil className="size-4" /> Edit
                      </Button>
                      {canDelete && (
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={busy}
                          className="h-8 text-destructive hover:text-destructive"
                          onClick={() => setDeleting(r)}
                        >
                          <Trash2 className="size-4" /> Delete
                        </Button>
                      )}
                      {busy && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Edit dialog */}
      <EditDialog
        review={editing}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          router.refresh();
        }}
      />

      {/* Delete confirm */}
      <Dialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete this review?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            This removes the review from the site and the list. It is soft-deleted and can be restored from the database
            if needed.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleting(null)}>
              Cancel
            </Button>
            <Button
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={async () => {
                if (!deleting) return;
                const id = deleting.id;
                setDeleting(null);
                await run(id, deleteReviewAction({ id }), "Review deleted");
              }}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function EditDialog({
  review,
  onClose,
  onSaved,
}: {
  review: AdminReview | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = React.useState("");
  const [city, setCity] = React.useState("");
  const [service, setService] = React.useState("");
  const [text, setText] = React.useState("");
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (review) {
      setName(review.customerName);
      setCity(review.city ?? "");
      setService(review.serviceType ?? "");
      setText(review.reviewText);
    }
  }, [review]);

  async function save() {
    if (!review) return;
    setSaving(true);
    const res = await editReviewAction({
      id: review.id,
      customerName: name,
      city,
      serviceType: service,
      reviewText: text,
    });
    setSaving(false);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    toast.success("Review updated");
    onSaved();
  }

  return (
    <Dialog open={!!review} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit review</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label className="text-sm">Customer name</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm">City</Label>
              <Input value={city} onChange={(e) => setCity(e.target.value)} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-sm">Service</Label>
            <Input value={service} onChange={(e) => setService(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-sm">Review text</Label>
            <Textarea rows={5} value={text} onChange={(e) => setText(e.target.value)} />
          </div>
          <p className="text-xs text-muted-foreground">
            Edit minor typos only — keep the customer&apos;s meaning intact.
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={saving} className="bg-gold text-gold-foreground hover:bg-gold/90" onClick={save}>
            {saving ? <Loader2 className="size-4 animate-spin" /> : null} Save changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
