"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { MapPin, Loader2, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import type { AddressSuggestion } from "@/app/api/geocode/autocomplete/route";

type Picked = { address: string; city: string; state: string; zip: string };

/**
 * Address field with live suggestions (Google-Maps-style). Debounced
 * forward-geocoding via /api/geocode/autocomplete (Nominatim proxy). Typing
 * shows matching addresses; picking one calls onSelect with the parsed parts so
 * the caller can fill Address / City / State / ZIP at once. The field stays a
 * normal text input — manual typing is never blocked.
 */
export function AddressAutocomplete({
  value,
  onChange,
  onSelect,
  placeholder = "Start typing an address…",
}: {
  value: string;
  onChange: (v: string) => void;
  onSelect: (parts: Picked) => void;
  placeholder?: string;
}) {
  const [debounced, setDebounced] = React.useState("");
  const [open, setOpen] = React.useState(false);
  // True right after a pick — suppresses re-opening the dropdown when the input
  // value changes programmatically to the chosen address.
  const justPicked = React.useRef(false);
  const boxRef = React.useRef<HTMLDivElement | null>(null);

  // Debounce keystrokes to respect Nominatim's rate limits.
  React.useEffect(() => {
    const t = setTimeout(() => setDebounced(value.trim()), 350);
    return () => clearTimeout(t);
  }, [value]);

  const { data, isFetching } = useQuery<{ results: AddressSuggestion[] }>({
    queryKey: ["address-autocomplete", debounced],
    queryFn: async () => {
      const res = await fetch(`/api/geocode/autocomplete?q=${encodeURIComponent(debounced)}`);
      if (!res.ok) return { results: [] };
      return res.json();
    },
    enabled: open && debounced.length >= 3,
    staleTime: 5 * 60 * 1000,
  });
  const results = data?.results ?? [];

  // Close the dropdown when clicking outside.
  React.useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  function pick(r: AddressSuggestion) {
    justPicked.current = true;
    // Prefer the parsed street line; fall back to the first chunk of the label
    // if Nominatim gave no house_number/road (e.g. a place rather than a house).
    const street = r.address || r.label.split(",")[0]?.trim() || "";
    onChange(street);
    onSelect({ address: street, city: r.city, state: r.state, zip: r.zip });
    setOpen(false);
  }

  return (
    <div ref={boxRef} className="relative">
      <div className="relative">
        <Input
          value={value}
          onChange={(e) => {
            onChange(e.target.value);
            if (justPicked.current) {
              justPicked.current = false;
            } else {
              setOpen(true);
            }
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && open && results[0]) {
              e.preventDefault();
              pick(results[0]);
            }
            if (e.key === "Escape") setOpen(false);
          }}
          placeholder={placeholder}
          className="pr-8"
          autoComplete="off"
        />
        {isFetching && open ? (
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
      {open && debounced.length >= 3 && (
        <div className="absolute z-[60] mt-1 max-h-72 w-full overflow-y-auto rounded-lg border border-border bg-popover p-1 shadow-lg">
          {results.length === 0 ? (
            <p className="px-2 py-2 text-sm text-muted-foreground">
              {isFetching ? "Searching…" : "No matching address."}
            </p>
          ) : (
            results.map((r, i) => (
              <button
                key={`${r.lat},${r.lng},${i}`}
                type="button"
                onClick={() => pick(r)}
                className="flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted"
              >
                <MapPin className="mt-0.5 size-3.5 shrink-0 text-gold" />
                <span className="line-clamp-2">{r.label}</span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
