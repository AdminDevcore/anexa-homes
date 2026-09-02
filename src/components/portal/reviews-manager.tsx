"use client";

import * as React from "react";
import { useRouter, usePathname } from "next/navigation";
import { toast } from "sonner";
import {
  Check,
  Clock,
  Eye,
  EyeOff,
  Loader2,
  MoreHorizontal,
  Search,
  Sparkles,
  Star,
  Trash2,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import {
  Caution,
  FieldGrid,
  Hint,
  ItemRail,
  Panel,
  Pill,
  RailLayout,
  RailRow,
  SaveBar,
  StatRow,
  TextAreaField,
  TextField,
} from "@/components/portal/settings-kit";
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
  { key: "approved", label: "Live" },
  { key: "rejected", label: "Rejected" },
];

function Stars({ n, className }: { n: number; className?: string }) {
  return (
    <span className={cn("inline-flex", className)} aria-label={`${n} out of 5`}>
      {Array.from({ length: 5 }).map((_, i) => (
        <Star
          key={i}
          className={cn("size-3.5", i < n ? "fill-gold text-gold" : "text-muted-foreground/30")}
          aria-hidden
        />
      ))}
    </span>
  );
}

/**
 * The moderation queue for what the public website says about this company.
 *
 * It used to be a feed: every review a full-width card carrying its photos, its
 * whole text and six buttons, so deciding on twenty of them meant scrolling
 * past twenty paragraphs. Rail and panel — the rail is the queue with the
 * rating and status on each row, and one review at a time gets the window,
 * where its photos are big enough to look at and the wording can be corrected
 * in place rather than in a dialog.
 *
 * The filter and search stay in the URL, because both are answered on the
 * server: this list is only ever the page you asked for.
 */
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
  const [search, setSearch] = React.useState(query);
  const [selectedId, setSelectedId] = React.useState<string | null>(() => reviews[0]?.id ?? null);

  const selected = reviews.find((r) => r.id === selectedId) ?? reviews[0] ?? null;

  function navigate(next: { filter?: AdminReviewFilter; q?: string }) {
    const params = new URLSearchParams();
    const f = next.filter ?? filter;
    const q = next.q ?? search;
    if (f && f !== "all") params.set("filter", f);
    if (q.trim()) params.set("q", q.trim());
    const qs = params.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  }

  return (
    <RailLayout
      rail={
        <ItemRail
          label="Reviews"
          add={
            <div className="space-y-2">
              <div className="flex flex-wrap gap-1">
                {FILTERS.map((f) => (
                  <button
                    key={f.key}
                    onClick={() => navigate({ filter: f.key })}
                    className={cn(
                      "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
                      filter === f.key
                        ? "border-gold/40 bg-gold/15 text-gold-muted"
                        : "border-border bg-card text-muted-foreground hover:text-foreground"
                    )}
                  >
                    {f.label}
                    <span className="tabular-nums opacity-70">{counts[f.key]}</span>
                  </button>
                ))}
              </div>
              <form
                className="relative"
                onSubmit={(e) => {
                  e.preventDefault();
                  navigate({ q: search });
                }}
              >
                <Search
                  aria-hidden
                  className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
                />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Name, city, service…"
                  aria-label="Search reviews"
                  className="h-8 pl-8"
                />
              </form>
            </div>
          }
        >
          {reviews.length === 0 ? (
            <p className="px-2 py-4 text-xs text-muted-foreground">
              No reviews{filter !== "all" ? ` marked ${filter}` : ""}
              {query ? ` matching “${query}”` : ""}.
            </p>
          ) : (
            reviews.map((r) => (
              <RailRow
                key={r.id}
                title={r.customerName}
                subtitle={
                  <span className="flex items-center gap-1.5">
                    <Stars n={r.rating} />
                    <span>{r.status === "approved" ? (r.hidden ? "hidden" : "live") : r.status}</span>
                  </span>
                }
                mark={
                  r.photoUrls[0] ? (
                    <span className="size-8 shrink-0 overflow-hidden rounded-md">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={r.photoUrls[0]}
                        alt=""
                        className="size-full object-cover"
                        loading="lazy"
                      />
                    </span>
                  ) : (
                    <span className="grid size-8 shrink-0 place-items-center rounded-md bg-foreground/5 font-display text-sm font-semibold text-metal-dim">
                      {r.customerName.charAt(0)}
                    </span>
                  )
                }
                selected={r.id === selected?.id}
                onSelect={() => setSelectedId(r.id)}
                needsWork={r.status === "pending"}
                muted={r.status === "rejected" || r.hidden}
              />
            ))
          )}
        </ItemRail>
      }
    >
      {selected && (
        <ReviewPanel
          key={selected.id}
          review={selected}
          canDelete={canDelete}
          onDeleted={() => setSelectedId(null)}
        />
      )}
    </RailLayout>
  );
}

/** One review: what it says, where it stands, and what to do about it. */
function ReviewPanel({
  review,
  canDelete,
  onDeleted,
}: {
  review: AdminReview;
  canDelete: boolean;
  onDeleted: () => void;
}) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  const [deleting, setDeleting] = React.useState(false);

  const seed = React.useCallback(
    () => ({
      customerName: review.customerName,
      city: review.city ?? "",
      serviceType: review.serviceType ?? "",
      reviewText: review.reviewText,
    }),
    [review]
  );

  const [draft, setDraft] = React.useState(seed);
  const serverKey = JSON.stringify([review.id, seed()]);
  const [seen, setSeen] = React.useState(serverKey);
  if (seen !== serverKey) {
    setSeen(serverKey);
    setDraft(seed());
  }

  const dirty = JSON.stringify(draft) !== JSON.stringify(seed());

  async function run(p: Promise<{ ok: boolean; error?: string }>, success?: string) {
    setBusy(true);
    try {
      const res = await p;
      if (!res.ok) {
        toast.error(res.error);
        return false;
      }
      if (success) toast.success(success);
      router.refresh();
      return true;
    } finally {
      setBusy(false);
    }
  }

  const live = review.status === "approved" && !review.hidden;

  return (
    <div className="min-w-0" data-testid="review-panel">
      <header className="flex flex-wrap items-start gap-3 border-b border-border pb-4">
        <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-foreground/5 font-display text-lg font-semibold text-metal-dim">
          {review.customerName.charAt(0)}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="truncate font-display text-xl font-semibold tracking-tight">
              {review.customerName}
            </h2>
            <Stars n={review.rating} />
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <Pill
              tone={
                review.status === "approved" ? "gold" : review.status === "pending" ? "warn" : "plain"
              }
            >
              {review.status === "approved" ? (live ? "Live on the site" : "Approved") : review.status}
            </Pill>
            {review.featured && (
              <Pill tone="gold">
                <Sparkles className="size-3" /> Featured
              </Pill>
            )}
            {review.hidden && review.status === "approved" && <Pill>Hidden</Pill>}
            {!review.consentToPublish && <Pill tone="warn">No consent to publish</Pill>}
          </div>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {review.status !== "approved" && (
            <Button
              size="sm"
              disabled={busy}
              onClick={() =>
                void run(
                  setReviewStatusAction({ id: review.id, status: "approved" }),
                  "Review approved"
                )
              }
            >
              <Check className="size-4" /> Approve
            </Button>
          )}
          {review.status !== "rejected" && (
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() =>
                void run(
                  setReviewStatusAction({ id: review.id, status: "rejected" }),
                  "Review rejected"
                )
              }
            >
              <X className="size-4" /> Reject
            </Button>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                size="icon-sm"
                variant="ghost"
                disabled={busy}
                aria-label={`More for ${review.customerName}`}
              >
                <MoreHorizontal className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-72">
              {review.status === "approved" && (
                <>
                  <DropdownMenuItem
                    onSelect={() =>
                      void run(
                        setReviewFeaturedAction({ id: review.id, featured: !review.featured }),
                        review.featured ? "Unfeatured" : "Featured"
                      )
                    }
                  >
                    <Sparkles className="size-4" />
                    {review.featured ? "Stop featuring on the homepage" : "Feature on the homepage"}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onSelect={() =>
                      void run(
                        setReviewHiddenAction({ id: review.id, hidden: !review.hidden }),
                        review.hidden ? "Now visible" : "Hidden from the site"
                      )
                    }
                  >
                    {review.hidden ? <Eye className="size-4" /> : <EyeOff className="size-4" />}
                    {review.hidden ? "Show on the website again" : "Hide from the website"}
                  </DropdownMenuItem>
                </>
              )}
              {canDelete && (
                <DropdownMenuItem variant="destructive" onSelect={() => setDeleting(true)}>
                  <Trash2 className="size-4" /> Delete — off the site and out of this list
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_17rem]">
        <div className="space-y-4">
          <Panel
            title="What they wrote"
            description="Correct typos only. The wording is the customer's, and it is published under their name."
          >
            <TextAreaField
              label="Review"
              rows={6}
              value={draft.reviewText}
              onChange={(v) => setDraft((d) => ({ ...d, reviewText: v }))}
            />
            {!review.consentToPublish && (
              <Caution>
                This customer did not consent to publication. Approving it puts their words and name
                on the public website anyway — check before you do.
              </Caution>
            )}
          </Panel>

          <Panel title="Who and what">
            <FieldGrid columns={2}>
              <TextField
                label="Customer name"
                value={draft.customerName}
                onChange={(v) => setDraft((d) => ({ ...d, customerName: v }))}
              />
              <TextField
                label="City"
                value={draft.city}
                onChange={(v) => setDraft((d) => ({ ...d, city: v }))}
              />
            </FieldGrid>
            <TextField
              label="Service"
              value={draft.serviceType}
              onChange={(v) => setDraft((d) => ({ ...d, serviceType: v }))}
            />
          </Panel>

          {review.photoUrls.length > 0 && (
            <Panel title={`Photos of the work (${review.photoUrls.length})`}>
              <div className="flex flex-wrap gap-2">
                {review.photoUrls.map((url, i) => (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    key={i}
                    src={url}
                    alt={`Review photo ${i + 1}`}
                    className="size-32 rounded-lg object-cover ring-1 ring-border"
                    loading="lazy"
                    decoding="async"
                  />
                ))}
              </div>
              <Hint>
                Published beside the review. They are the customer&rsquo;s photographs, not the
                company&rsquo;s.
              </Hint>
            </Panel>
          )}
        </div>

        <div className="xl:sticky xl:top-20 xl:self-start">
          <Panel title="At a glance" tone="muted">
            <dl>
              <StatRow label="Rating" value={`${review.rating} / 5`} />
              <StatRow
                label="Submitted"
                value={new Date(review.createdAt).toLocaleDateString()}
              />
              <StatRow
                label="Approved"
                value={
                  review.approvedAt
                    ? `${new Date(review.approvedAt).toLocaleDateString()}${
                        review.approvedByName ? ` · ${review.approvedByName}` : ""
                      }`
                    : "not yet"
                }
              />
              <StatRow
                label="Consent"
                value={review.consentToPublish ? "given" : "not given"}
                tone={review.consentToPublish ? "plain" : "warn"}
              />
              <StatRow label="On the site" value={live ? "yes" : "no"} />
            </dl>
            <Hint className="mt-2">
              <Clock className="mr-1 inline size-3" />
              An approved review is live on the homepage and the Reviews page immediately.
            </Hint>
          </Panel>
        </div>
      </div>

      <SaveBar
        dirty={dirty}
        busy={busy}
        what={review.customerName}
        onSave={() =>
          void run(
            editReviewAction({
              id: review.id,
              customerName: draft.customerName,
              city: draft.city,
              serviceType: draft.serviceType,
              reviewText: draft.reviewText,
            }),
            "Review updated"
          )
        }
        onDiscard={() => setDraft(seed())}
      />

      <Dialog open={deleting} onOpenChange={setDeleting}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete {review.customerName}&rsquo;s review?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            This removes it from the website and from this list. It is soft-deleted, so it can be
            restored from the database if it turns out to have been the wrong call.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleting(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={busy}
              onClick={async () => {
                setDeleting(false);
                const ok = await run(deleteReviewAction({ id: review.id }), "Review deleted");
                if (ok) onDeleted();
              }}
            >
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
