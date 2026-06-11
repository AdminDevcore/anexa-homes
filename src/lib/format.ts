import { makeMoney, makeDate, makeDateTime } from "./format-core";

const usdMoney = makeMoney({ currency: "USD", locale: "en-US" });
const usDate = makeDate({ locale: "en-US" });
const usDateTime = makeDateTime({ locale: "en-US" });

/** @deprecated Prefer useFormat()/format-server for tenant-aware output. USD/en-US only. */
export function formatCents(cents: number, opts?: { compact?: boolean }): string {
  return usdMoney(cents, opts);
}

export function formatDate(date: Date | string | null | undefined): string {
  return usDate(date);
}

export function formatDateTime(date: Date | string | null | undefined): string {
  return usDateTime(date);
}

export function initials(name: string): string {
  return name
    .split(" ")
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}
