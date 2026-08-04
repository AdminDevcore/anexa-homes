import Link from "next/link";
import { Languages, Mail, MapPin, Phone, Tag, User, Users } from "lucide-react";
import { CopyButton } from "@/components/portal/copy-button";

/**
 * Who the homeowner is and how to reach them, in the sidebar where a rep can
 * see it from any tab.
 *
 * Every contact slot renders whether or not it is filled. A missing phone
 * number is a fact about the deal — the thing standing between a rep and a
 * conversation — and hiding the row makes it look like the card is complete
 * when it isn't. An empty slot says so and links straight to the edit form, so
 * "there's no number" and "here's where you put one" are the same click.
 *
 * Every reachable value gets a copy button, because the actual job here is
 * getting a phone number into a dialler or an address into a maps app — and
 * hand-retyping a customer's email is how a proposal goes to the wrong inbox.
 *
 * Phone and email are also real `tel:` / `mailto:` links: on a phone in a
 * driveway, tapping to call beats copy-then-paste.
 */

export type HomeownerFacts = {
  name: string;
  /** Co-owner / co-signer on the deal, e.g. a spouse. */
  coOwner: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  /** Preferred spoken language, e.g. "Spanish". Null on most deals. */
  language: string | null;
  leadSource: string | null;
  notes: string | null;
};

export function HomeownerCard({
  facts,
  editHref,
}: {
  facts: HomeownerFacts;
  /** Edit form for this deal. Omitted when the viewer can't update the lead —
   *  empty slots then read as "Not provided" with nothing to click. */
  editHref?: string;
}) {
  return (
    <div className="space-y-3.5">
      <Row icon={User} label="Name" value={facts.name} copyLabel="name" editHref={editHref} />
      <Row
        icon={Users}
        label="Co-owner"
        value={facts.coOwner}
        copyLabel="co-owner"
        editHref={editHref}
      />
      <Row
        icon={Phone}
        label="Phone"
        value={facts.phone}
        href={facts.phone ? `tel:${facts.phone.replace(/[^\d+]/g, "")}` : undefined}
        copyLabel="phone"
        editHref={editHref}
      />
      <Row
        icon={Mail}
        label="Email"
        value={facts.email}
        href={facts.email ? `mailto:${facts.email}` : undefined}
        copyLabel="email"
        editHref={editHref}
      />
      <Row
        icon={MapPin}
        label="Address"
        value={facts.address}
        copyLabel="address"
        editHref={editHref}
      />
      {/* Before the lead source on purpose: this one changes how you talk to
          the person, so it belongs with the ways of reaching them. No copy
          button — nobody pastes a language anywhere. */}
      <Row icon={Languages} label="Language" value={facts.language} editHref={editHref} />
      <Row icon={Tag} label="Lead source" value={facts.leadSource} editHref={editHref} />

      <div className="border-t border-border pt-3.5">
        <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          Notes
        </div>
        {facts.notes ? (
          <p className="mt-1.5 whitespace-pre-wrap rounded-lg bg-muted/50 p-3 text-sm text-muted-foreground">
            {facts.notes}
          </p>
        ) : (
          <p className="mt-1.5 text-sm">
            <Empty label="notes" editHref={editHref} />
          </p>
        )}
      </div>
    </div>
  );
}

/** Module scope on purpose — react-hooks/static-components is an error here. */
function Row({
  icon: Icon,
  label,
  value,
  href,
  copyLabel,
  editHref,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string | null;
  href?: string;
  copyLabel?: string;
  editHref?: string;
}) {
  return (
    <div className="flex items-start justify-between gap-2">
      <div className="min-w-0">
        <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          <Icon className="size-3.5" />
          {label}
        </div>
        {value ? (
          href ? (
            <a
              href={href}
              className="mt-0.5 block break-words text-sm font-medium underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
            >
              {value}
            </a>
          ) : (
            <p className="mt-0.5 break-words text-sm font-medium">{value}</p>
          )
        ) : (
          <p className="mt-0.5 text-sm">
            <Empty label={label.toLowerCase()} editHref={editHref} />
          </p>
        )}
      </div>
      {/* Nothing to copy on an empty slot, and a dead copy button next to
          "Add phone" is worse than no button at all. */}
      {copyLabel && value && <CopyButton value={value} label={copyLabel} className="mt-3.5" />}
    </div>
  );
}

/** The empty state of one slot: an invitation when you can edit, a fact when you can't. */
function Empty({ label, editHref }: { label: string; editHref?: string }) {
  if (!editHref) {
    return <span className="text-muted-foreground/70">Not provided</span>;
  }
  return (
    <Link
      href={editHref}
      className="font-medium text-muted-foreground underline decoration-dotted underline-offset-4 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
    >
      Add {label}
    </Link>
  );
}
