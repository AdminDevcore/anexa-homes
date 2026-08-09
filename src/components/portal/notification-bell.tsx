"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, CheckCheck } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import {
  markNotificationReadAction,
  markAllNotificationsReadAction,
} from "@/server/modules/notifications/actions";
import { WorkspaceTag } from "@/components/portal/workspace-tag";
import type { Vertical } from "@prisma/client";

type Item = {
  id: string;
  title: string;
  body: string;
  link: string | null;
  read: boolean;
  createdAt: string;
  vertical: Vertical | null;
};
type Summary = { count: number; items: Item[]; showWorkspace: boolean };

export function NotificationBell() {
  const qc = useQueryClient();
  const router = useRouter();
  const { data } = useQuery<Summary>({
    queryKey: ["notifications-summary"],
    queryFn: async () => {
      const res = await fetch("/api/notifications/summary");
      if (!res.ok) return { count: 0, items: [], showWorkspace: false };
      return res.json();
    },
    refetchInterval: 30000,
    refetchOnWindowFocus: true,
  });

  const count = data?.count ?? 0;
  const items = data?.items ?? [];
  // The server decides this, not the client: it is a permission question, and
  // the answer must match the filter that produced `items`.
  const showWorkspace = data?.showWorkspace ?? false;

  async function open(item: Item) {
    if (!item.read) {
      await markNotificationReadAction(item.id);
      qc.invalidateQueries({ queryKey: ["notifications-summary"] });
    }
    if (item.link) router.push(item.link);
  }

  async function markAll() {
    await markAllNotificationsReadAction();
    qc.invalidateQueries({ queryKey: ["notifications-summary"] });
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="relative grid size-9 place-items-center rounded-full border border-border bg-background text-muted-foreground transition-colors hover:text-foreground" aria-label="Notifications">
          <Bell className="size-[18px]" />
          {count > 0 && (
            <span className="absolute -right-0.5 -top-0.5 grid min-w-4 place-items-center rounded-full bg-gold px-1 text-[10px] font-semibold leading-4 text-gold-foreground">
              {count > 9 ? "9+" : count}
            </span>
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80 p-0">
        <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
          <span className="text-sm font-semibold">Notifications</span>
          {count > 0 && (
            <button onClick={markAll} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
              <CheckCheck className="size-3.5" /> Mark all read
            </button>
          )}
        </div>
        <div className="max-h-96 overflow-y-auto">
          {items.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-muted-foreground">You&rsquo;re all caught up.</div>
          ) : (
            items.map((item) => (
              <button
                key={item.id}
                onClick={() => open(item)}
                className={`flex w-full flex-col items-start gap-0.5 border-b border-border px-4 py-3 text-left transition-colors hover:bg-muted/50 ${item.read ? "" : "bg-gold/5"}`}
              >
                <span className="flex w-full items-center gap-2 text-sm font-medium">
                  {!item.read && <span className="size-1.5 shrink-0 rounded-full bg-gold" />}
                  <span className="min-w-0 flex-1 truncate">{item.title}</span>
                  {showWorkspace && <WorkspaceTag vertical={item.vertical} />}
                </span>
                <span className="line-clamp-2 text-xs text-muted-foreground">{item.body}</span>
              </button>
            ))
          )}
        </div>
        <div className="border-t border-border p-2">
          <Button asChild variant="ghost" size="sm" className="w-full">
            <Link href="/portal/notifications">View all</Link>
          </Button>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
