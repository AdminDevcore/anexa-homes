"use client";

import * as React from "react";
import { Info } from "lucide-react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";

/**
 * The furniture every Settings panel is built out of.
 *
 * Written first for the lenders screen, and the point of that rebuild lives
 * here rather than in any one panel: the old screen put a three-line paragraph
 * under every field, so a partner's whole setup read as a wall of prose in
 * which nothing was more important than anything else. The paragraphs were
 * right — they carry knowledge nobody can guess — so they are kept, but
 * demoted: a short line under the field, and the long-form answer behind a
 * "why" button next to the label, where somebody goes looking for it.
 *
 * It sits under `settings-kit/` because that judgement is not about lenders.
 * Every screen in Settings is the same shape of problem — a handful of
 * decisions with consequences a rep cannot guess — so they are all built out
 * of these, and a person who has learned one settings screen has learned the
 * rest.
 */

/** A titled block. One question per block, never four loose fields. */
export function Panel({
  title,
  description,
  children,
  className,
  tone = "plain",
  action,
}: {
  title: string;
  description?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  /** `accent` marks the settings that change what a customer signs. */
  tone?: "plain" | "accent" | "muted";
  action?: React.ReactNode;
}) {
  return (
    <section
      className={cn(
        "rounded-xl border p-4",
        tone === "accent" && "border-solar/40 bg-solar/[0.04]",
        tone === "muted" && "border-border/70 bg-muted/30",
        tone === "plain" && "border-border bg-card",
        className
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold">{title}</h3>
          {description && (
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{description}</p>
          )}
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </div>
      <div className="mt-3 space-y-3">{children}</div>
    </section>
  );
}

/** The quiet line under a control. One sentence — anything longer is an InfoTip. */
export function Hint({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <p className={cn("text-[11px] leading-relaxed text-muted-foreground", className)}>{children}</p>
  );
}

/** Something that will bite somebody. Amber, and never used for ordinary help. */
export function Caution({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-2.5 py-2 text-[11px] leading-relaxed text-amber-900 dark:text-amber-200">
      {children}
    </p>
  );
}

/**
 * The long explanation, out of the way until it is wanted.
 *
 * Everything the old screen printed in full under each field lives in one of
 * these. It is a real button with a name, so a screen reader gets "why: what
 * this partner charges a homeowner" rather than an unlabelled icon.
 */
export function InfoTip({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Popover>
      <PopoverTrigger
        className="inline-flex size-4 shrink-0 items-center justify-center rounded-full text-muted-foreground/70 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-label={`Why: ${label}`}
      >
        <Info className="size-3.5" />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 text-[11px] leading-relaxed text-muted-foreground">
        {children}
      </PopoverContent>
    </Popover>
  );
}

/** Label row: the label, and the "why" beside it rather than under the field. */
export function FieldLabel({
  htmlFor,
  children,
  why,
  whyLabel,
}: {
  htmlFor: string;
  children: React.ReactNode;
  why?: React.ReactNode;
  whyLabel?: string;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <Label className="text-xs" htmlFor={htmlFor}>
        {children}
      </Label>
      {why && <InfoTip label={whyLabel ?? String(children)}>{why}</InfoTip>}
    </div>
  );
}

export function TextField({
  label,
  value,
  onChange,
  placeholder,
  hint,
  why,
  type = "text",
  id: idProp,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  hint?: React.ReactNode;
  why?: React.ReactNode;
  type?: string;
  id?: string;
}) {
  const auto = React.useId();
  const id = idProp ?? auto;
  return (
    <div className="space-y-1.5">
      <FieldLabel htmlFor={id} why={why} whyLabel={label}>
        {label}
      </FieldLabel>
      <Input
        id={id}
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
      {hint && <Hint>{hint}</Hint>}
    </div>
  );
}

export function NumField({
  label,
  value,
  onChange,
  step,
  hint,
  why,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  step?: string;
  hint?: React.ReactNode;
  why?: React.ReactNode;
  placeholder?: string;
}) {
  const id = React.useId();
  return (
    <div className="space-y-1.5">
      <FieldLabel htmlFor={id} why={why} whyLabel={label}>
        {label}
      </FieldLabel>
      <Input
        id={id}
        type="number"
        step={step}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
      {hint && <Hint>{hint}</Hint>}
    </div>
  );
}

/**
 * Money, with its units printed on the box.
 *
 * "$" before and "/W" after, because the single commonest mistake on this
 * screen is typing 275 where $2.75 was meant — a floor of $275 a watt that
 * blocks every deal on the partner for ever. Units on the field are not
 * decoration; they are the cheapest place to catch that.
 */
export function MoneyField({
  label,
  value,
  onChange,
  suffix,
  placeholder,
  hint,
  why,
  invalid,
  id: idProp,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  /** "/W", "per battery" — printed inside the box, after the number. */
  suffix?: string;
  placeholder?: string;
  hint?: React.ReactNode;
  why?: React.ReactNode;
  invalid?: boolean;
  id?: string;
}) {
  const auto = React.useId();
  const id = idProp ?? auto;
  return (
    <div className="space-y-1.5">
      <FieldLabel htmlFor={id} why={why} whyLabel={label}>
        {label}
      </FieldLabel>
      <div className="relative">
        <span
          aria-hidden
          className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-muted-foreground"
        >
          $
        </span>
        <Input
          id={id}
          inputMode="decimal"
          value={value}
          placeholder={placeholder}
          aria-invalid={invalid || undefined}
          onChange={(e) => onChange(e.target.value)}
          className={cn("pl-7 tabular-nums", suffix && "pr-14")}
        />
        {suffix && (
          <span
            aria-hidden
            className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-muted-foreground"
          >
            {suffix}
          </span>
        )}
      </div>
      {hint && <Hint>{hint}</Hint>}
    </div>
  );
}

export type Choice<T extends string> = {
  value: T;
  label: string;
  /** What choosing this actually does to a deal. */
  detail?: React.ReactNode;
};

/**
 * A short list of mutually exclusive answers, as cards rather than a `<select>`.
 *
 * Every one of these used to be a dropdown whose options carried the
 * explanation inside the option text — "Redline — rep keeps everything above
 * their own net $/W" — so the consequence of the answer you did NOT pick was
 * invisible until you opened the menu. Three cards show all three answers and
 * what each one does, at once, which is the whole decision.
 */
export function ChoiceCards<T extends string>({
  name,
  legend,
  why,
  value,
  onChange,
  options,
  columns = 1,
}: {
  name: string;
  legend: string;
  why?: React.ReactNode;
  value: T;
  onChange: (v: T) => void;
  options: Choice<T>[];
  columns?: 1 | 2 | 3;
}) {
  return (
    <fieldset className="space-y-2">
      <legend className="flex items-center gap-1.5 text-xs font-medium text-foreground">
        {legend}
        {why && <InfoTip label={legend}>{why}</InfoTip>}
      </legend>
      <div
        className={cn(
          "grid gap-2",
          columns === 2 && "sm:grid-cols-2",
          columns === 3 && "sm:grid-cols-3"
        )}
      >
        {options.map((o) => {
          const checked = value === o.value;
          return (
            <label
              key={o.value}
              className={cn(
                "flex cursor-pointer items-start gap-2.5 rounded-lg border p-2.5 text-sm transition-colors",
                checked
                  ? "border-gold/50 bg-gold/[0.07]"
                  : "border-border bg-background hover:bg-muted/50"
              )}
            >
              <input
                type="radio"
                name={name}
                value={o.value}
                checked={checked}
                onChange={() => onChange(o.value)}
                className="mt-0.5 size-4 shrink-0 accent-gold"
              />
              <span className="min-w-0">
                <span className="block font-medium leading-tight">{o.label}</span>
                {o.detail && (
                  <span className="mt-0.5 block text-[11px] leading-relaxed text-muted-foreground">
                    {o.detail}
                  </span>
                )}
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

/** One number worth reading on its own, with its unit. */
export function Figure({
  label,
  value,
  tone = "plain",
}: {
  label: string;
  value: React.ReactNode;
  tone?: "plain" | "gold" | "warn";
}) {
  return (
    <div className="rounded-lg border border-border/70 bg-background px-3 py-2">
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div
        className={cn(
          "mt-0.5 font-display text-lg font-semibold tabular-nums tracking-tight",
          tone === "gold" && "text-gold",
          tone === "warn" && "text-amber-600 dark:text-amber-400"
        )}
      >
        {value}
      </div>
    </div>
  );
}

/** A key/value line in the "at a glance" list. */
export function StatRow({
  label,
  value,
  tone = "plain",
}: {
  label: string;
  value: React.ReactNode;
  tone?: "plain" | "warn";
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1 text-xs">
      <dt className="text-muted-foreground">{label}</dt>
      <dd
        className={cn(
          "font-medium tabular-nums",
          tone === "warn" && "text-amber-600 dark:text-amber-400"
        )}
      >
        {value}
      </dd>
    </div>
  );
}

/** A small status pill. Used on the rail rows and in the detail header. */
export function Pill({
  children,
  tone = "plain",
  className,
}: {
  children: React.ReactNode;
  tone?: "plain" | "gold" | "solar" | "warn";
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium whitespace-nowrap",
        tone === "plain" && "bg-muted text-muted-foreground",
        tone === "gold" && "bg-gold/15 text-gold-muted",
        tone === "solar" && "bg-solar/15 text-solar",
        tone === "warn" &&
          "bg-amber-500/15 text-amber-700 dark:text-amber-300",
        className
      )}
    >
      {children}
    </span>
  );
}

/** Long-form wording — a disclosure, an email body, a note nobody reads twice. */
export function TextAreaField({
  label,
  value,
  onChange,
  placeholder,
  hint,
  why,
  rows = 3,
  id: idProp,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  hint?: React.ReactNode;
  why?: React.ReactNode;
  rows?: number;
  id?: string;
}) {
  const auto = React.useId();
  const id = idProp ?? auto;
  return (
    <div className="space-y-1.5">
      <FieldLabel htmlFor={id} why={why} whyLabel={label}>
        {label}
      </FieldLabel>
      <Textarea
        id={id}
        rows={rows}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
      {hint && <Hint>{hint}</Hint>}
    </div>
  );
}

/**
 * A dropdown, for lists too long to lay out as cards.
 *
 * Anything up to about four answers should be `ChoiceCards` instead — a
 * `<select>` hides the options you did not pick, and on a settings screen the
 * option you did not pick is exactly the thing that needs explaining.
 */
export function SelectField<T extends string>({
  label,
  value,
  onChange,
  options,
  hint,
  why,
  placeholder,
  disabled,
  id: idProp,
}: {
  label: string;
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
  hint?: React.ReactNode;
  why?: React.ReactNode;
  placeholder?: string;
  disabled?: boolean;
  id?: string;
}) {
  const auto = React.useId();
  const id = idProp ?? auto;
  return (
    <div className="space-y-1.5">
      <FieldLabel htmlFor={id} why={why} whyLabel={label}>
        {label}
      </FieldLabel>
      <Select value={value} onValueChange={(v) => onChange(v as T)} disabled={disabled}>
        <SelectTrigger id={id} className="w-full">
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {hint && <Hint>{hint}</Hint>}
    </div>
  );
}

/**
 * A switch with its consequence written beside it.
 *
 * The label says what it is; the line under it says what turning it off does to
 * a live deal, which is the part somebody flipping it at 6pm needs.
 */
export function ToggleRow({
  label,
  description,
  checked,
  onChange,
  why,
  disabled,
}: {
  label: string;
  description?: React.ReactNode;
  checked: boolean;
  onChange: (v: boolean) => void;
  why?: React.ReactNode;
  disabled?: boolean;
}) {
  const id = React.useId();
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0 space-y-0.5">
        <FieldLabel htmlFor={id} why={why} whyLabel={label}>
          {label}
        </FieldLabel>
        {description && <Hint>{description}</Hint>}
      </div>
      <Switch id={id} checked={checked} onCheckedChange={onChange} disabled={disabled} />
    </div>
  );
}

/** Two or three fields that belong on one line where the window allows it. */
export function FieldGrid({
  columns = 2,
  children,
  className,
}: {
  columns?: 2 | 3;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "grid gap-3",
        columns === 2 && "sm:grid-cols-2",
        columns === 3 && "sm:grid-cols-3",
        className
      )}
    >
      {children}
    </div>
  );
}

/** Nothing here yet — inside a panel, where a full-page EmptyState is too loud. */
export function PanelEmpty({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-border px-4 py-8 text-center">
      <p className="text-xs leading-relaxed text-muted-foreground">{children}</p>
    </div>
  );
}
