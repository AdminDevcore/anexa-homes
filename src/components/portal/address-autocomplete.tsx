"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { MapPin, Loader2, X, AlertTriangle } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { AddressSuggestion, SuggestResult } from "@/server/modules/geo/suggest";
import type { PlaceScope, ResolvedAddress } from "@/server/modules/geo/places";

export type { ResolvedAddress };

/**
 * The address field, everywhere. New Appointment, Edit Job, Field Map search,
 * onboarding, vendors, company settings, storm tools and the public website
 * form all render this.
 *
 * Two things it does that the old Nominatim version could not:
 *
 * 1. Offers house numbers. "404 Shoreline St" instead of "Shoreline Street",
 *    because Places has buildings where OpenStreetMap has only a road centreline.
 * 2. Hands back a rooftop coordinate on pick, so the caller can store a pin that
 *    is on the house rather than somewhere along the block.
 *
 * The field stays a plain text input throughout: typing is never blocked and
 * picking a suggestion is never required. Every form here accepted free text
 * before and still does.
 */

type Mode = "parts" | "single";

/**
 * Where to send the lookups. The portal talks to session-gated routes; the
 * public website form has no session and uses throttled server actions
 * injected by its own wrapper.
 */
export type SuggestTransport = {
  suggest: (q: string, sessionToken: string, scope: PlaceScope) => Promise<SuggestResult>;
  resolve: (placeId: string, sessionToken: string) => Promise<ResolvedAddress | null>;
};

const portalTransport: SuggestTransport = {
  async suggest(q, sessionToken, scope) {
    const res = await fetch(
      `/api/geocode/autocomplete?q=${encodeURIComponent(q)}&session=${encodeURIComponent(sessionToken)}&scope=${scope}`
    );
    if (!res.ok) {
      // Our own route failed, so nothing downstream was even consulted. Saying
      // "no matching address" here would blame the customer's house for a 500.
      return { results: [], source: "none", degraded: `address lookup route returned ${res.status}` };
    }
    return res.json();
  },
  async resolve(placeId, sessionToken) {
    const res = await fetch(
      `/api/geocode/place?placeId=${encodeURIComponent(placeId)}&session=${encodeURIComponent(sessionToken)}`
    );
    if (!res.ok) return null;
    return (await res.json()).place ?? null;
  },
};

const MIN_QUERY = 3;

export function AddressAutocomplete({
  value,
  onChange,
  onSelect,
  mode = "parts",
  scope = "address",
  placeholder = "Start typing an address…",
  transport = portalTransport,
  className,
  inputClassName,
  id,
  "aria-label": ariaLabel,
  leading,
  autoFocus,
}: {
  value: string;
  onChange: (v: string) => void;
  /** Fires with everything the pick resolved to — including a rooftop lat/lng. */
  onSelect: (parts: ResolvedAddress) => void;
  /**
   * "parts" writes the street line and lets the caller fill City/State/ZIP from
   * `onSelect`. "single" writes the whole formatted address into this one field,
   * for the surfaces that have no city/state/zip beside them.
   */
  mode?: Mode;
  /**
   * "address" suggests houses only — the default, and the reason this component
   * exists. "broad" also allows cities and ZIPs, for a field whose label
   * genuinely offers them (the storm coverage centre).
   */
  scope?: PlaceScope;
  placeholder?: string;
  transport?: SuggestTransport;
  className?: string;
  inputClassName?: string;
  id?: string;
  "aria-label"?: string;
  /** Optional icon rendered inside the input's left edge (the map search box). */
  leading?: React.ReactNode;
  autoFocus?: boolean;
}) {
  const [debounced, setDebounced] = React.useState("");
  const [open, setOpen] = React.useState(false);
  const [active, setActive] = React.useState(0);
  const [resolving, setResolving] = React.useState(false);

  /**
   * Google's autocomplete session token. Every keystroke of one lookup shares
   * it, and the details call that ends the lookup closes it — that is what makes
   * Places bill one session per address instead of one request per keystroke.
   * Regenerated after each pick, because reusing a closed token starts billing
   * the next lookup against a session that is already settled.
   */
  const sessionToken = React.useRef<string>(newToken());
  // True right after a pick — stops the dropdown reopening when the input value
  // changes programmatically to the address just chosen.
  const justPicked = React.useRef(false);
  const boxRef = React.useRef<HTMLDivElement | null>(null);
  const listId = React.useId();

  React.useEffect(() => {
    const t = setTimeout(() => setDebounced(value.trim()), 350);
    return () => clearTimeout(t);
  }, [value]);

  const { data, isFetching } = useQuery<SuggestResult>({
    queryKey: ["address-autocomplete", scope, debounced],
    queryFn: () => transport.suggest(debounced, sessionToken.current, scope),
    enabled: open && debounced.length >= MIN_QUERY,
    staleTime: 5 * 60 * 1000,
  });
  const results = React.useMemo(() => data?.results ?? [], [data]);
  // Why the list is empty, when the reason is us rather than the address.
  const degraded = data?.degraded ?? null;

  // A new query means a new result set, so the highlight goes back to the top.
  // Adjusted during render rather than in an effect: an effect would paint one
  // frame with the old row highlighted, and React handles a same-component
  // set-during-render without a second pass.
  const [activeFor, setActiveFor] = React.useState(debounced);
  if (activeFor !== debounced) {
    setActiveFor(debounced);
    setActive(0);
  }

  React.useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  async function pick(s: AddressSuggestion) {
    justPicked.current = true;
    setOpen(false);

    // A Nominatim hit already carries its parts; a Places prediction is only a
    // placeId until someone pays for the details.
    let parts = s.parts;
    if (!parts && s.placeId) {
      setResolving(true);
      try {
        parts = await transport.resolve(s.placeId, sessionToken.current);
      } finally {
        setResolving(false);
      }
    }

    // The details call is what closes the billing session, so the next lookup
    // needs a fresh token whether or not the call succeeded.
    sessionToken.current = newToken();

    if (!parts) {
      // Details failed. Write what the dropdown showed rather than clearing the
      // field — the rep can still fix the rest by hand.
      onChange(mode === "single" ? s.label : s.primary);
      return;
    }

    onChange(mode === "single" ? parts.formatted || s.label : parts.address || s.primary);
    onSelect(parts);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open || results.length === 0) {
      if (e.key === "Escape") setOpen(false);
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => (i + 1) % results.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => (i - 1 + results.length) % results.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      void pick(results[active] ?? results[0]);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  const busy = (isFetching && open) || resolving;

  return (
    <div ref={boxRef} className={cn("relative", className)}>
      <div className="relative">
        {leading}
        <Input
          id={id}
          value={value}
          onChange={(e) => {
            onChange(e.target.value);
            if (justPicked.current) justPicked.current = false;
            else setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          className={cn("pr-8", inputClassName)}
          autoComplete="off"
          autoFocus={autoFocus}
          role="combobox"
          aria-expanded={open && results.length > 0}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-label={ariaLabel}
        />
        {busy ? (
          <Loader2 className="absolute right-2.5 top-1/2 size-4 -translate-y-1/2 animate-spin text-muted-foreground" />
        ) : value ? (
          <button
            type="button"
            onClick={() => {
              onChange("");
              setDebounced("");
              setOpen(false);
            }}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            aria-label="Clear address"
          >
            <X className="size-4" />
          </button>
        ) : null}
      </div>

      {open && debounced.length >= MIN_QUERY && (
        <div
          id={listId}
          role="listbox"
          className="absolute z-[1100] mt-1 max-h-72 w-full overflow-y-auto rounded-lg border border-border bg-popover p-1 shadow-lg"
        >
          {results.length === 0 ? (
            isFetching ? (
              <p className="px-2 py-2 text-sm text-muted-foreground">Searching…</p>
            ) : degraded ? (
              // Every address provider we have was unreachable. The house may
              // well exist — this field simply cannot say. Telling a rep "no
              // matching address" here is what let a disabled API hide for
              // sixteen days: it reads as a fact about the customer.
              <div className="px-2 py-2">
                <p className="flex items-start gap-1.5 text-sm font-medium text-amber-700 dark:text-amber-400">
                  <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                  Address lookup is unavailable
                </p>
                <p className="mt-0.5 pl-5 text-xs leading-snug text-muted-foreground">
                  Not a problem with this address — type it in full and carry on. Tell an admin if
                  it keeps happening.
                </p>
              </div>
            ) : (
              <p className="px-2 py-2 text-sm text-muted-foreground">No matching address.</p>
            )
          ) : (
            results.map((r, i) => (
              <button
                key={r.placeId ?? `${r.label}-${i}`}
                type="button"
                role="option"
                aria-selected={i === active}
                onMouseEnter={() => setActive(i)}
                onClick={() => void pick(r)}
                className={cn(
                  "flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left text-sm",
                  i === active ? "bg-muted" : "hover:bg-muted"
                )}
              >
                <MapPin className="mt-0.5 size-3.5 shrink-0 text-gold" />
                <span className="min-w-0">
                  <span className="block truncate font-medium">{r.primary}</span>
                  {r.secondary ? (
                    <span className="block truncate text-xs text-muted-foreground">
                      {r.secondary}
                    </span>
                  ) : null}
                </span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

function newToken(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
