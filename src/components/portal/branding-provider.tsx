"use client";

import * as React from "react";
import { makeMoney, makeDate, makeDateTime } from "@/lib/format-core";
import type { Branding } from "@/server/branding/defaults";

const BrandingContext = React.createContext<Branding | null>(null);

export function BrandingProvider({
  branding,
  children,
}: {
  branding: Branding;
  children: React.ReactNode;
}) {
  return <BrandingContext.Provider value={branding}>{children}</BrandingContext.Provider>;
}

export function useBranding(): Branding {
  const ctx = React.useContext(BrandingContext);
  if (!ctx) throw new Error("useBranding must be used within <BrandingProvider>");
  return ctx;
}

/** Tenant-aware formatters, memoized per branding value. */
export function useFormat() {
  const b = useBranding();
  return React.useMemo(
    () => ({
      money: makeMoney({ currency: b.currencyCode, locale: b.locale }),
      date: makeDate({ locale: b.locale, timeZone: b.timeZone }),
      dateTime: makeDateTime({ locale: b.locale, timeZone: b.timeZone }),
    }),
    [b.currencyCode, b.locale, b.timeZone]
  );
}
