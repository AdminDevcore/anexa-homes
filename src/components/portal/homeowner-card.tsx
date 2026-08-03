import { Languages, Mail, MapPin, Phone, Tag, User } from "lucide-react";
import { CopyButton } from "@/components/portal/copy-button";

/**
 * Who the homeowner is and how to reach them, in the sidebar where a rep can
 * see it from any tab.
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
  phone: string | null;
  email: string | null;
  address: string | null;
  /** Preferred spoken language, e.g. "Spanish". Null on most deals. */
  language: string | null;
  leadSource: string | null;
  notes: string | null;
};

export function HomeownerCard({ facts }: { facts: HomeownerFacts }) {
  return (
    <div className="space-y-3.5">
      <Row icon={User} label="Name" value={facts.name} copyLabel="name" />
      {facts.phone && (
        <Row
          icon={Phone}
          label="Phone"
          value={facts.phone}
          href={`tel:${facts.phone.replace(/[^\d+]/g, "")}`}
          copyLabel="phone"
        />
      )}
      {facts.email && (
        <Row
          icon={Mail}
          label="Email"
          value={facts.email}
          href={`mailto:${facts.email}`}
          copyLabel="email"
        />
      )}
      {facts.address && (
        <Row icon={MapPin} label="Address" value={facts.address} copyLabel="address" />
      )}
      {/* Before the lead source on purpose: this one changes how you talk to
          the person, so it belongs with the ways of reaching them. No copy
          button — nobody pastes a language anywhere. */}
      {facts.language && <Row icon={Languages} label="Language" value={facts.language} />}
      {facts.leadSource && <Row icon={Tag} label="Lead source" value={facts.leadSource} />}

      {facts.notes && (
        <div className="border-t border-border pt-3.5">
          <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            Notes
          </div>
          <p className="mt-1.5 whitespace-pre-wrap rounded-lg bg-muted/50 p-3 text-sm text-muted-foreground">
            {facts.notes}
          </p>
        </div>
      )}
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
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  href?: string;
  copyLabel?: string;
}) {
  return (
    <div className="flex items-start justify-between gap-2">
      <div className="min-w-0">
        <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          <Icon className="size-3.5" />
          {label}
        </div>
        {href ? (
          <a
            href={href}
            className="mt-0.5 block break-words text-sm font-medium underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
          >
            {value}
          </a>
        ) : (
          <p className="mt-0.5 break-words text-sm font-medium">{value}</p>
        )}
      </div>
      {copyLabel && <CopyButton value={value} label={copyLabel} className="mt-3.5" />}
    </div>
  );
}
