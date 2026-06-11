import { makeMoney, makeDate, makeDateTime } from "./format-core";
import { currentBranding } from "@/server/branding/resolve";
import type { Branding } from "@/server/branding/defaults";

/** Build formatters from an already-resolved Branding (use in PDFs / non-request code). */
export function formattersFor(b: Pick<Branding, "currencyCode" | "locale" | "timeZone">) {
  return {
    money: makeMoney({ currency: b.currencyCode, locale: b.locale }),
    date: makeDate({ locale: b.locale, timeZone: b.timeZone }),
    dateTime: makeDateTime({ locale: b.locale, timeZone: b.timeZone }),
  };
}

/** Tenant-aware formatters for the current request (server components / actions). */
export async function currentFormatters() {
  return formattersFor(await currentBranding());
}
