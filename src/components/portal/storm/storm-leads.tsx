"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { Download, FileText } from "lucide-react";
import type { StormMatchDTO } from "@/server/modules/storm/queries";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

function scoreTone(score: number): string {
  if (score >= 90) return "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300";
  if (score >= 50) return "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300";
  return "bg-muted text-muted-foreground";
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export function StormLeads() {
  const [minScore, setMinScore] = React.useState("");
  const [subject, setSubject] = React.useState("all");

  const params = new URLSearchParams();
  if (minScore) params.set("minScore", minScore);
  if (subject !== "all") params.set("subject", subject);
  const qstr = params.toString();

  const { data, isFetching } = useQuery<{ matches: StormMatchDTO[] }>({
    queryKey: ["storm-matches", qstr],
    queryFn: async () => {
      const res = await fetch(`/api/storm/matches?${qstr}`);
      if (!res.ok) return { matches: [] };
      return res.json();
    },
    staleTime: 60_000,
  });
  const matches = data?.matches ?? [];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-border bg-card p-3">
        <div className="flex flex-col gap-1">
          <Label className="text-xs text-muted-foreground">Min score</Label>
          <Input type="number" value={minScore} onChange={(e) => setMinScore(e.target.value)} className="h-9 w-24" placeholder="0" />
        </div>
        <div className="flex flex-col gap-1">
          <Label className="text-xs text-muted-foreground">Type</Label>
          <Select value={subject} onValueChange={setSubject}>
            <SelectTrigger className="h-9 w-36"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="lead">Leads</SelectItem>
              <SelectItem value="knock">Door knocks</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <span className="mr-1 text-sm text-muted-foreground">
            {isFetching ? "Loading…" : `${matches.length} matches`}
          </span>
          <Button asChild variant="outline" size="sm" className="gap-1.5">
            <a href={`/portal/storm-intelligence/export?${qstr}`}>
              <Download className="size-4" /> CSV
            </a>
          </Button>
          <Button asChild variant="outline" size="sm" className="gap-1.5">
            <a href={`/portal/storm-intelligence/pdf?${qstr}`}>
              <FileText className="size-4" /> PDF
            </a>
          </Button>
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl border border-border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Score</TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Address</TableHead>
              <TableHead>Type</TableHead>
              <TableHead className="text-right">Hail</TableHead>
              <TableHead className="text-right">Wind</TableHead>
              <TableHead className="text-right">Reports</TableHead>
              <TableHead>Date of loss</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {matches.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="py-10 text-center text-sm text-muted-foreground">
                  No scored matches yet. Import storm data, then run a recompute.
                </TableCell>
              </TableRow>
            ) : (
              matches.map((m) => (
                <TableRow key={m.id}>
                  <TableCell>
                    <span className={`inline-flex min-w-9 justify-center rounded-md px-2 py-0.5 text-sm font-semibold tabular-nums ${scoreTone(m.score)}`}>
                      {m.score}
                    </span>
                  </TableCell>
                  <TableCell className="font-medium">{m.name}</TableCell>
                  <TableCell className="text-muted-foreground">{m.address}</TableCell>
                  <TableCell>
                    <Badge variant="secondary" className="capitalize">{m.subjectType}</Badge>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{m.maxHailIn != null ? `${m.maxHailIn.toFixed(2)}″` : "—"}</TableCell>
                  <TableCell className="text-right tabular-nums">{m.maxWindMph != null ? `${m.maxWindMph}` : "—"}</TableCell>
                  <TableCell className="text-right tabular-nums">{m.eventCount}</TableCell>
                  <TableCell className="text-muted-foreground">{fmtDate(m.dateOfLoss)}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
