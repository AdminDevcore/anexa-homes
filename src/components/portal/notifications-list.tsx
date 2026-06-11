"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Bell, CheckCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  markNotificationReadAction,
  markAllNotificationsReadAction,
} from "@/server/modules/notifications/actions";
import { useFormat } from "@/components/portal/branding-provider";

type Item = { id: string; title: string; body: string; link: string | null; read: boolean; createdAt: string; event: string };

export function NotificationsList({ items }: { items: Item[] }) {
  const fmt = useFormat();
  const router = useRouter();
  const qc = useQueryClient();

  async function openItem(item: Item) {
    if (!item.read) {
      await markNotificationReadAction(item.id);
      qc.invalidateQueries({ queryKey: ["notifications-summary"] });
      router.refresh();
    }
    if (item.link) router.push(item.link);
  }

  async function markAll() {
    await markAllNotificationsReadAction();
    qc.invalidateQueries({ queryKey: ["notifications-summary"] });
    toast.success("All marked read");
    router.refresh();
  }

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border bg-card/50 px-6 py-16 text-center">
        <span className="grid size-12 place-items-center rounded-full bg-muted text-muted-foreground"><Bell className="size-6" /></span>
        <h3 className="font-medium">No notifications</h3>
        <p className="max-w-sm text-sm text-muted-foreground">When activity happens that matches your company&rsquo;s notification rules, it&rsquo;ll show up here.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button variant="outline" size="sm" onClick={markAll}><CheckCheck className="size-4" /> Mark all read</Button>
      </div>
      <div className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
        {items.map((item) => (
          <button
            key={item.id}
            onClick={() => openItem(item)}
            className={`flex w-full items-start gap-3 px-5 py-3.5 text-left transition-colors hover:bg-muted/40 ${item.read ? "" : "bg-gold/5"}`}
          >
            {!item.read ? <span className="mt-1.5 size-2 shrink-0 rounded-full bg-gold" /> : <span className="mt-1.5 size-2 shrink-0" />}
            <div className="flex-1">
              <div className="font-medium">{item.title}</div>
              <div className="text-sm text-muted-foreground">{item.body}</div>
            </div>
            <span className="shrink-0 text-xs text-muted-foreground">{fmt.date(item.createdAt)}</span>
          </button>
        ))}
      </div>
      <p className="text-center text-xs text-muted-foreground">
        Manage what triggers notifications in{" "}
        <Link href="/portal/settings/notifications" className="underline">Settings → Notifications</Link>.
      </p>
    </div>
  );
}
