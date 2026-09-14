"use client";

import * as React from "react";
import { ChevronDown, Plus, SlidersHorizontal, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useFormat } from "@/components/portal/branding-provider";
import {
  FIELD_GROUPS,
  NONE,
  VALUELESS,
  describeCondition,
  isComplete,
  operatorsFor,
  type Condition,
  type FilterField,
  type MatchMode,
  type Operator,
} from "@/lib/pipeline-filters";

let rowSeq = 0;
/** Row ids only need to be unique inside one open builder. */
const blankRow = (): Condition => ({ id: `row-${++rowSeq}`, field: "", op: "any_of", values: [] });

/**
 * The Filters button and its builder: "Where <field> <operator> <values>", as
 * many rows as you like, joined by and or by or. Rows are a DRAFT until Apply,
 * so a half-picked row never empties the board behind the panel — but the
 * footer counts what the draft would show as you build it.
 */
export function FilterBuilderButton({
  fields,
  conditions,
  match,
  onApply,
  countMatches,
  total,
  onSaveAsView,
}: {
  fields: FilterField[];
  conditions: Condition[];
  match: MatchMode;
  onApply: (next: Condition[], match: MatchMode) => void;
  countMatches: (draft: Condition[], match: MatchMode) => number;
  total: number;
  onSaveAsView: () => void;
}) {
  const [open, setOpen] = React.useState(false);
  const [draft, setDraft] = React.useState<Condition[]>([]);
  const [draftMatch, setDraftMatch] = React.useState<MatchMode>("all");
  const byKey = React.useMemo(() => new Map(fields.map((f) => [f.key, f])), [fields]);
  const active = conditions.filter((c) => isComplete(c, byKey.get(c.field))).length;
  const ready = draft.filter((c) => isComplete(c, byKey.get(c.field)));

  function onOpenChange(next: boolean) {
    if (next) {
      setDraft(conditions.length ? conditions.map((c) => ({ ...c })) : [blankRow()]);
      setDraftMatch(match);
    }
    setOpen(next);
  }

  const patch = (id: string, p: Partial<Condition>) =>
    setDraft((d) => d.map((c) => (c.id === id ? { ...c, ...p } : c)));
  const remove = (id: string) =>
    setDraft((d) => {
      const next = d.filter((c) => c.id !== id);
      return next.length ? next : [blankRow()];
    });

  function apply(e?: React.FormEvent) {
    e?.preventDefault();
    onApply(ready, draftMatch);
    setOpen(false);
  }

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="lg"
          className="shrink-0"
          // The badge is a bare number; without this a screen reader hears
          // "Filters" whether none or five are active.
          aria-label={active > 0 ? `Filters (${active} active)` : "Filters"}
        >
          <SlidersHorizontal className="size-4" />
          Filters
          {active > 0 ? (
            <span className="ml-0.5 inline-flex size-4 items-center justify-center rounded-full bg-gold text-[10px] font-semibold text-gold-foreground tabular-nums">
              {active}
            </span>
          ) : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="max-h-[min(44rem,calc(100vh-10rem))] w-[min(48rem,calc(100vw-2rem))] gap-0 overflow-y-auto p-0"
      >
        <form onSubmit={apply} className="flex flex-col">
          <div className="border-b border-border px-4 py-3">
            <p className="text-sm font-semibold">Filters</p>
            <p className="text-xs text-muted-foreground">
              {draftMatch === "any" ? "Show deals where any condition is true" : "Show deals where every condition is true"}
            </p>
          </div>

          <div className="flex flex-col gap-2.5 px-4 py-3">
            {draft.map((c, i) => (
              <ConditionRow
                key={c.id}
                first={i === 0}
                match={draftMatch}
                onMatchChange={setDraftMatch}
                condition={c}
                fields={fields}
                field={byKey.get(c.field)}
                onChange={(p) => patch(c.id, p)}
                onRemove={() => remove(c.id)}
              />
            ))}
            <button
              type="button"
              onClick={() => setDraft((d) => [...d, blankRow()])}
              className="inline-flex w-fit items-center gap-1.5 rounded-md px-1.5 py-1 text-sm font-medium text-gold-muted transition-colors hover:bg-muted sm:ml-18"
            >
              <Plus className="size-4" /> Add condition
            </button>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-4 py-3">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={ready.length === 0}
              onClick={() => {
                onApply(ready, draftMatch);
                setOpen(false);
                onSaveAsView();
              }}
            >
              Save as view…
            </Button>
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground tabular-nums">
                {`${countMatches(ready, draftMatch)} of ${total} ${total === 1 ? "deal" : "deals"} match`}
              </span>
              <Button type="button" variant="ghost" size="sm" onClick={() => {
                  setDraft([blankRow()]);
                  setDraftMatch("all");
                }}>
                Clear
              </Button>
              <Button type="submit" size="sm">
                Apply
              </Button>
            </div>
          </div>
        </form>
      </PopoverContent>
    </Popover>
  );
}

/** The values a row keeps when its operator changes: whatever still fits. */
function carryValues(c: Condition, op: Operator): string[] {
  if (VALUELESS.has(op)) return [];
  const isList = (o: Operator) => o === "any_of" || o === "none_of";
  const isDays = (o: Operator) => o === "last_days" || o === "next_days";
  if (isList(op) !== isList(c.op) || isDays(op) !== isDays(c.op)) return [];
  if (isList(op)) return c.values;
  return op === "between" ? c.values.slice(0, 2) : c.values.slice(0, 1);
}

function ConditionRow({
  first,
  match,
  onMatchChange,
  condition: c,
  fields,
  field,
  onChange,
  onRemove,
}: {
  first: boolean;
  match: MatchMode;
  onMatchChange: (match: MatchMode) => void;
  condition: Condition;
  fields: FilterField[];
  field: FilterField | undefined;
  onChange: (p: Partial<Condition>) => void;
  onRemove: () => void;
}) {
  return (
    <div
      data-testid="filter-condition"
      className="flex flex-col gap-2 rounded-lg border border-border/70 p-2 sm:flex-row sm:items-start sm:border-0 sm:p-0"
    >
      {first ? (
        <span className="hidden w-16 shrink-0 pt-2 text-xs font-medium text-muted-foreground sm:block">Where</span>
      ) : (
        // One connector for the whole filter: changing any row's and/or changes
        // every row's, so the builder never shows a mix it can't evaluate.
        <Select
          value={match}
          onValueChange={(v) => {
            if ((v === "all" || v === "any") && v !== match) onMatchChange(v);
          }}
        >
          <SelectTrigger className="h-9 w-full shrink-0 text-xs sm:w-16" aria-label="And or">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">and</SelectItem>
            <SelectItem value="any">or</SelectItem>
          </SelectContent>
        </Select>
      )}

      <Select
        value={c.field}
        onValueChange={(key) => {
          // Only a field this pipeline offers may land (see the operator
          // select below for why a stray "" arrives), and re-picking the same
          // field keeps what was already chosen for it.
          const next = fields.find((f) => f.key === key);
          if (!next || key === c.field) return;
          onChange({ field: key, op: operatorsFor(next.kind)[0].op, values: [] });
        }}
      >
        <SelectTrigger className="h-9 w-full sm:w-44" aria-label="Field">
          <SelectValue placeholder="Choose a field" />
        </SelectTrigger>
        <SelectContent>
          {FIELD_GROUPS.map((group) => {
            const inGroup = fields.filter((f) => f.group === group);
            if (inGroup.length === 0) return null;
            return (
              <SelectGroup key={group}>
                <SelectLabel>{group}</SelectLabel>
                {inGroup.map((f) => (
                  <SelectItem key={f.key} value={f.key}>
                    {f.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            );
          })}
        </SelectContent>
      </Select>

      <Select
        // Remounted per field, so its value and its options arrive together.
        // Kept in place, the hidden <select> Radix renders inside a <form> is
        // handed "any_of" before that option exists, reads back "", and fires
        // onValueChange("") — which blanked the operator the moment a field
        // was picked, and with it the values picker.
        key={c.field || "none"}
        value={field ? c.op : ""}
        disabled={!field}
        onValueChange={(op) => {
          if (!field || op === c.op || !operatorsFor(field.kind).some((o) => o.op === op)) return;
          onChange({ op: op as Operator, values: carryValues(c, op as Operator) });
        }}
      >
        <SelectTrigger className="h-9 w-full sm:w-40" aria-label="Condition">
          <SelectValue placeholder="is…" />
        </SelectTrigger>
        <SelectContent>
          {field
            ? operatorsFor(field.kind).map((o) => (
                <SelectItem key={o.op} value={o.op}>
                  {o.label}
                </SelectItem>
              ))
            : null}
        </SelectContent>
      </Select>

      <div className="min-w-0 flex-1">
        {field ? <ValueEditor field={field} condition={c} onChange={(values) => onChange({ values })} /> : null}
      </div>

      <Button
        type="button"
        variant="ghost"
        size="icon-lg"
        aria-label="Remove condition"
        onClick={onRemove}
        className="self-end text-muted-foreground sm:self-auto"
      >
        <X className="size-4" />
      </Button>
    </div>
  );
}

function ValueEditor({
  field,
  condition: c,
  onChange,
}: {
  field: FilterField;
  condition: Condition;
  onChange: (values: string[]) => void;
}) {
  const [a = "", b = ""] = c.values;
  switch (c.op) {
    case "empty":
    case "not_empty":
    case "checked":
    case "unchecked":
      return null;
    case "any_of":
    case "none_of":
      return <MultiValuePicker field={field} selected={c.values} onChange={onChange} />;
    case "last_days":
    case "next_days":
      return (
        <div className="flex items-center gap-2">
          <Input
            type="number"
            min={0}
            inputMode="numeric"
            value={a}
            onChange={(e) => onChange([e.target.value])}
            className="h-9 w-24"
            aria-label="Number of days"
          />
          <span className="text-sm text-muted-foreground">days</span>
        </div>
      );
    case "between":
      return (
        <div className="flex items-center gap-1.5">
          <ScalarInput field={field} value={a} onChange={(v) => onChange([v, b])} label="From" />
          <span className="text-xs text-muted-foreground">and</span>
          <ScalarInput field={field} value={b} onChange={(v) => onChange([a, v])} label="To" />
        </div>
      );
    default:
      return <ScalarInput field={field} value={a} onChange={(v) => onChange([v])} label="Value" />;
  }
}

function ScalarInput({
  field,
  value,
  onChange,
  label,
}: {
  field: FilterField;
  value: string;
  onChange: (v: string) => void;
  label: string;
}) {
  const type = field.kind === "number" ? "number" : field.kind === "date" ? "date" : "text";
  const placeholder =
    field.kind === "number"
      ? field.unit === "money"
        ? "Amount"
        : field.unit === "days"
          ? "Days"
          : "Number"
      : field.kind === "text"
        ? "Text"
        : undefined;
  return (
    <Input
      type={type}
      value={value}
      min={type === "number" ? 0 : undefined}
      step={type === "number" ? "any" : undefined}
      inputMode={type === "number" ? "decimal" : undefined}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      className="h-9 w-full min-w-0"
      aria-label={label}
    />
  );
}

/** A checklist of a field's choices, each with how many deals on this pipeline hold it. */
function MultiValuePicker({
  field,
  selected,
  onChange,
}: {
  field: FilterField;
  selected: string[];
  onChange: (values: string[]) => void;
}) {
  const [q, setQ] = React.useState("");
  const options = field.options ?? [];
  const needle = q.trim().toLowerCase();
  const shown = needle ? options.filter((o) => o.label.toLowerCase().includes(needle)) : options;
  const names = selected.map((v) => options.find((o) => o.value === v)?.label ?? v);
  const summary =
    names.length === 0
      ? "Choose values"
      : names.length <= 2
        ? names.join(", ")
        : `${names.slice(0, 2).join(", ")} +${names.length - 2}`;
  const toggle = (v: string) => onChange(selected.includes(v) ? selected.filter((x) => x !== v) : [...selected, v]);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`Values: ${summary}`}
          className={cn(
            "flex h-9 w-full items-center justify-between gap-2 rounded-lg border border-input bg-transparent px-2.5 text-left text-sm transition-colors hover:bg-muted/50 dark:bg-input/30",
            names.length === 0 && "text-muted-foreground"
          )}
        >
          <span className="truncate">{summary}</span>
          <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 gap-2 p-2" data-testid="value-picker">
        {options.length > 7 ? (
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={`Search ${field.label.toLowerCase()}…`}
            className="h-8"
            aria-label="Search values"
          />
        ) : null}
        <div className="max-h-64 overflow-y-auto" role="group" aria-label={field.label}>
          {shown.length === 0 ? (
            <p className="px-2 py-3 text-center text-xs text-muted-foreground">No matches</p>
          ) : (
            shown.map((o) => (
              <label
                key={o.value}
                className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted"
              >
                <Checkbox checked={selected.includes(o.value)} onCheckedChange={() => toggle(o.value)} />
                <span
                  data-option-label
                  className={cn("min-w-0 flex-1 truncate", o.value === NONE && "italic text-muted-foreground")}
                >
                  {o.label}
                </span>
                <span className="text-xs text-muted-foreground tabular-nums">
                  <span className="sr-only">, </span>
                  {o.count}
                </span>
              </label>
            ))
          )}
        </div>
        {selected.length > 0 ? (
          <button
            type="button"
            onClick={() => onChange([])}
            className="self-start px-2 text-xs text-muted-foreground hover:text-foreground"
          >
            Clear selection
          </button>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}

/** The filters in force, one removable chip each, so a narrowed board says why. */
export function ActiveFilterChips({
  fields,
  conditions,
  match,
  onChange,
  onClearAll,
}: {
  fields: FilterField[];
  conditions: Condition[];
  match: MatchMode;
  onChange: (next: Condition[]) => void;
  onClearAll: () => void;
}) {
  const fmt = useFormat();
  const byKey = React.useMemo(() => new Map(fields.map((f) => [f.key, f])), [fields]);
  const chips = conditions.flatMap((c) => {
    const field = byKey.get(c.field);
    return field && isComplete(c, field) ? [{ c, label: describeCondition(c, field, (cents) => fmt.money(cents)) }] : [];
  });
  if (chips.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Active filters">
      {/* Chips read as a list, so under or the list has to say so. */}
      {match === "any" && chips.length > 1 ? (
        <span className="text-xs font-medium text-muted-foreground">Any of</span>
      ) : null}
      {chips.map(({ c, label }) => (
        <button
          key={c.id}
          type="button"
          onClick={() => onChange(conditions.filter((x) => x.id !== c.id))}
          aria-label={`Remove filter ${label}`}
          title={label}
          className="inline-flex max-w-[24rem] items-center gap-1 rounded-full border border-gold/40 bg-gold/10 px-2.5 py-1 text-xs font-medium text-foreground transition-colors hover:bg-gold/20"
        >
          <span className="truncate">{label}</span>
          <X className="size-3 shrink-0" />
        </button>
      ))}
      <button type="button" onClick={onClearAll} className="px-1.5 text-xs text-muted-foreground hover:text-foreground">
        Clear all
      </button>
    </div>
  );
}
