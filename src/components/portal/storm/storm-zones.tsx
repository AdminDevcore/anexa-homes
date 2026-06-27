"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { toast } from "sonner";
import { MapPinned } from "lucide-react";
import type { StormZoneDTO } from "@/server/modules/storm/queries";
import { Button } from "@/components/ui/button";
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
import { assignStormZoneAction } from "@/server/modules/storm/actions";
import type { StormMeta } from "./types";

export function StormZones({ meta }: { meta: StormMeta }) {
  const qc = useQueryClient();
  const { data, isFetching } = useQuery<{ zones: StormZoneDTO[] }>({
    queryKey: ["storm-zones"],
    queryFn: async () => {
      const res = await fetch("/api/storm/zones");
      if (!res.ok) return { zones: [] };
      return res.json();
    },
    staleTime: 30_000,
  });
  const zones = data?.zones ?? [];

  async function reassign(zoneId: string, repId: string) {
    const res = await assignStormZoneAction({
      zoneId,
      assignedRepId: repId === "none" ? null : repId,
    });
    if (res.ok) {
      toast.success("Zone reassigned.");
      qc.invalidateQueries({ queryKey: ["storm-zones"] });
    } else {
      toast.error(res.error);
    }
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-card">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Zone</TableHead>
            <TableHead className="text-right">Radius</TableHead>
            <TableHead className="text-right">Reports</TableHead>
            <TableHead className="text-right">Score</TableHead>
            <TableHead>Assigned rep</TableHead>
            <TableHead className="text-right">Canvass</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {zones.length === 0 ? (
            <TableRow>
              <TableCell colSpan={6} className="py-10 text-center text-sm text-muted-foreground">
                {isFetching ? "Loading…" : "No zones yet. Create one from the Map tab."}
              </TableCell>
            </TableRow>
          ) : (
            zones.map((z) => (
              <TableRow key={z.id}>
                <TableCell className="font-medium">{z.name}</TableCell>
                <TableCell className="text-right tabular-nums">{z.radiusMiles} mi</TableCell>
                <TableCell className="text-right tabular-nums">{z.eventCount}</TableCell>
                <TableCell className="text-right tabular-nums">{z.totalScore}</TableCell>
                <TableCell>
                  {meta.canManage ? (
                    <Select value={z.assignedRepId ?? "none"} onValueChange={(v) => reassign(z.id, v)}>
                      <SelectTrigger className="h-8 w-40"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">Unassigned</SelectItem>
                        {meta.reps.map((r) => (
                          <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <span className="text-sm text-muted-foreground">{z.assignedRepName ?? "Unassigned"}</span>
                  )}
                </TableCell>
                <TableCell className="text-right">
                  {z.territoryId ? (
                    <Button asChild variant="outline" size="sm" className="gap-1.5">
                      <Link href="/portal/canvassing"><MapPinned className="size-4" /> Open</Link>
                    </Button>
                  ) : (
                    <span className="text-sm text-muted-foreground">—</span>
                  )}
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}
