"use client";

import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { MessageSquarePlus, Hash, Plus, Send, Users, ArrowLeft, Loader2, Paperclip, FileText, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import {
  openDmAction,
  createChannelAction,
  sendMessageAction,
  markReadAction,
} from "@/server/modules/chat/actions";
import { uploadChatAttachmentAction } from "@/server/modules/files/actions";
import { ListFilter } from "@/components/portal/list-filter";

type Conversation = {
  id: string;
  type: "dm" | "channel";
  title: string;
  subtitle: string | null;
  lastMessage: string | null;
  lastMessageAt: string;
  unread: number;
  memberCount: number;
};
type Attachment = { id: string; name: string; kind: string; mimeType: string | null; url: string };
type Message = {
  id: string;
  body: string;
  senderId: string | null;
  senderName: string;
  mine: boolean;
  createdAt: string;
  attachments: Attachment[];
};
type Contact = { id: string; name: string; role: string; title: string | null; avatarUrl: string | null };

function initials(name: string) {
  return name
    .split(" ")
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

function timeLabel(iso: string) {
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function roleLabel(role: string) {
  return role.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function MessageAttachments({ attachments, mine }: { attachments: Attachment[]; mine: boolean }) {
  const images = attachments.filter((a) => a.kind === "photo");
  const docs = attachments.filter((a) => a.kind !== "photo");
  return (
    <div className={cn("mt-1 flex max-w-[78%] flex-col gap-1.5", mine ? "items-end" : "items-start")}>
      {images.length > 0 && (
        <div className={cn("flex flex-wrap gap-1.5", mine && "justify-end")}>
          {images.map((a) => (
            <a key={a.id} href={a.url} target="_blank" rel="noreferrer" title={a.name}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={a.url} alt={a.name} className="size-32 rounded-lg border border-border object-cover" loading="lazy" decoding="async" />
            </a>
          ))}
        </div>
      )}
      {docs.map((a) => (
        <a
          key={a.id}
          href={a.url}
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm hover:bg-muted"
        >
          <FileText className="size-4 shrink-0 text-muted-foreground" />
          <span className="max-w-[200px] truncate">{a.name}</span>
        </a>
      ))}
    </div>
  );
}

export function ChatClient() {
  const qc = useQueryClient();
  const [activeId, setActiveId] = React.useState<string | null>(null);
  const [draft, setDraft] = React.useState("");
  const [pending, setPending] = React.useState<Attachment[]>([]);
  const [uploading, setUploading] = React.useState(false);
  const fileInputRef = React.useRef<HTMLInputElement | null>(null);
  const [newDmOpen, setNewDmOpen] = React.useState(false);
  const [newChannelOpen, setNewChannelOpen] = React.useState(false);
  const scrollRef = React.useRef<HTMLDivElement>(null);

  const { data: convData } = useQuery<{ conversations: Conversation[] }>({
    queryKey: ["chat-conversations"],
    queryFn: async () => {
      const res = await fetch("/api/chat/conversations");
      if (!res.ok) return { conversations: [] };
      return res.json();
    },
    refetchInterval: 5000,
    refetchOnWindowFocus: true,
  });
  const conversations = convData?.conversations ?? [];
  const active = conversations.find((c) => c.id === activeId) ?? null;

  const { data: msgData, isFetching: msgsLoading } = useQuery<{ messages: Message[] }>({
    queryKey: ["chat-messages", activeId],
    queryFn: async () => {
      if (!activeId) return { messages: [] };
      const res = await fetch(`/api/chat/messages?conversationId=${activeId}`);
      if (!res.ok) return { messages: [] };
      return res.json();
    },
    enabled: !!activeId,
    refetchInterval: 3000,
  });
  const messages = React.useMemo(() => msgData?.messages ?? [], [msgData]);

  // Auto-scroll to newest on message change.
  React.useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages.length, activeId]);

  async function openConversation(id: string) {
    setActiveId(id);
    await markReadAction(id);
    qc.invalidateQueries({ queryKey: ["chat-conversations"] });
    qc.invalidateQueries({ queryKey: ["chat-unread"] });
  }

  async function send() {
    const body = draft.trim();
    if ((!body && pending.length === 0) || !activeId) return;
    const attachmentIds = pending.map((a) => a.id);
    setDraft("");
    setPending([]);
    const res = await sendMessageAction({ conversationId: activeId, body, attachmentIds });
    if (!res.ok) {
      toast.error(res.error);
      setDraft(body);
      setPending(pending);
      return;
    }
    qc.invalidateQueries({ queryKey: ["chat-messages", activeId] });
    qc.invalidateQueries({ queryKey: ["chat-conversations"] });
  }

  async function onPickFiles(files: FileList | null) {
    if (!files || !files.length || !activeId) return;
    setUploading(true);
    for (const file of Array.from(files)) {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("conversationId", activeId);
      const res = await uploadChatAttachmentAction(fd);
      if (res.ok) setPending((p) => [...p, { ...res.attachment, url: `/portal/files/${res.attachment.id}` }]);
      else toast.error(`${file.name}: ${res.error}`);
    }
    setUploading(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }
  function removePending(id: string) {
    setPending((p) => p.filter((a) => a.id !== id));
  }

  return (
    <div className="flex h-[calc(100vh-8rem)] overflow-hidden rounded-xl border border-border bg-card">
      {/* Conversation list */}
      <aside
        className={cn(
          "flex w-full flex-col border-r border-border sm:w-80",
          active && "hidden sm:flex"
        )}
      >
        <div className="flex items-center justify-between border-b border-border p-4">
          <h2 className="font-display text-lg font-semibold">Team Chat</h2>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" className="gap-1.5">
                <Plus className="size-4" /> New
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => setNewDmOpen(true)}>
                <MessageSquarePlus className="size-4" /> New message
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setNewChannelOpen(true)}>
                <Hash className="size-4" /> New channel
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <div className="flex-1 overflow-y-auto">
          {conversations.length === 0 ? (
            <p className="p-6 text-center text-sm text-muted-foreground">
              No conversations yet. Start one with the <strong>New</strong> button.
            </p>
          ) : (
            <ListFilter placeholder="Search chats…" className="px-3 pt-3">
            {conversations.map((c) => (
              <button
                key={c.id}
                data-search-item
                onClick={() => openConversation(c.id)}
                className={cn(
                  "flex w-full items-center gap-3 border-b border-border/60 px-4 py-3 text-left transition-colors hover:bg-muted",
                  activeId === c.id && "bg-muted"
                )}
              >
                <span
                  className={cn(
                    "grid size-10 shrink-0 place-items-center rounded-full text-sm font-semibold",
                    c.type === "channel" ? "bg-gold/15 text-gold" : "bg-foreground/10 text-foreground"
                  )}
                >
                  {c.type === "channel" ? <Hash className="size-5" /> : initials(c.title)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center justify-between gap-2">
                    <span className="truncate font-medium">{c.title}</span>
                    {c.unread > 0 && (
                      <Badge className="h-5 min-w-5 justify-center rounded-full px-1.5 tabular-nums">
                        {c.unread}
                      </Badge>
                    )}
                  </span>
                  <span className="truncate text-sm text-muted-foreground">
                    {c.lastMessage ?? (c.subtitle ?? "No messages yet")}
                  </span>
                </span>
              </button>
            ))}
            </ListFilter>
          )}
        </div>
      </aside>

      {/* Active thread */}
      <section className={cn("flex flex-1 flex-col", !active && "hidden sm:flex")}>
        {!active ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 text-muted-foreground">
            <MessageSquarePlus className="size-10 opacity-40" />
            <p className="text-sm">Select a conversation to start chatting.</p>
          </div>
        ) : (
          <>
            <header className="flex items-center gap-3 border-b border-border p-4">
              <Button
                variant="ghost"
                size="icon"
                className="sm:hidden"
                onClick={() => setActiveId(null)}
                aria-label="Back"
              >
                <ArrowLeft className="size-5" />
              </Button>
              <span
                className={cn(
                  "grid size-9 place-items-center rounded-full text-sm font-semibold",
                  active.type === "channel" ? "bg-gold/15 text-gold" : "bg-foreground/10"
                )}
              >
                {active.type === "channel" ? <Hash className="size-4" /> : initials(active.title)}
              </span>
              <div className="min-w-0">
                <div className="truncate font-semibold">{active.title}</div>
                {active.type === "channel" && (
                  <div className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Users className="size-3" /> {active.memberCount} members
                  </div>
                )}
              </div>
            </header>

            <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto p-4">
              {messages.length === 0 && msgsLoading ? (
                <div className="flex justify-center pt-8">
                  <Loader2 className="size-5 animate-spin text-muted-foreground" />
                </div>
              ) : messages.length === 0 ? (
                <p className="pt-8 text-center text-sm text-muted-foreground">
                  No messages yet. Say hello 👋
                </p>
              ) : (
                messages.map((m, i) => {
                  const showSender =
                    active.type === "channel" && !m.mine && messages[i - 1]?.senderId !== m.senderId;
                  return (
                    <div key={m.id} className={cn("flex flex-col", m.mine ? "items-end" : "items-start")}>
                      {showSender && (
                        <span className="mb-0.5 px-1 text-xs font-medium text-muted-foreground">
                          {m.senderName}
                        </span>
                      )}
                      {m.body && (
                        <div
                          className={cn(
                            "max-w-[78%] rounded-2xl px-3.5 py-2 text-sm",
                            m.mine
                              ? "rounded-br-md bg-gold text-gold-foreground"
                              : "rounded-bl-md bg-muted text-foreground"
                          )}
                        >
                          <p className="whitespace-pre-wrap break-words">{m.body}</p>
                        </div>
                      )}
                      {m.attachments.length > 0 && <MessageAttachments attachments={m.attachments} mine={m.mine} />}
                      <span className="mt-0.5 px-1 text-[10px] text-muted-foreground">
                        {timeLabel(m.createdAt)}
                      </span>
                    </div>
                  );
                })
              )}
            </div>

            <div className="border-t border-border p-3">
              {pending.length > 0 && (
                <div className="mb-2 flex flex-wrap gap-2">
                  {pending.map((a) => (
                    <div key={a.id} className="relative">
                      {a.kind === "photo" ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={a.url} alt={a.name} className="size-16 rounded-lg border border-border object-cover" loading="lazy" decoding="async" />
                      ) : (
                        <div className="flex size-16 flex-col items-center justify-center gap-1 rounded-lg border border-border bg-muted p-1 text-center">
                          <FileText className="size-5 text-muted-foreground" />
                          <span className="w-full truncate text-[9px] leading-tight">{a.name}</span>
                        </div>
                      )}
                      <button
                        onClick={() => removePending(a.id)}
                        className="absolute -right-1.5 -top-1.5 rounded-full bg-foreground p-0.5 text-background"
                        aria-label="Remove attachment"
                      >
                        <X className="size-3" />
                      </button>
                    </div>
                  ))}
                  {uploading && (
                    <div className="flex size-16 items-center justify-center rounded-lg border border-dashed border-border">
                      <Loader2 className="size-4 animate-spin text-muted-foreground" />
                    </div>
                  )}
                </div>
              )}
              <div className="flex items-end gap-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  accept="image/*,application/pdf,.doc,.docx,.xls,.xlsx,.csv,.txt"
                  className="hidden"
                  onChange={(e) => void onPickFiles(e.target.files)}
                />
                <Button type="button" size="icon" variant="ghost" onClick={() => fileInputRef.current?.click()} disabled={uploading} aria-label="Attach files">
                  <Paperclip className="size-4" />
                </Button>
                <Textarea
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      void send();
                    }
                  }}
                  placeholder="Type a message…"
                  rows={1}
                  className="max-h-32 min-h-10 resize-none"
                />
                <Button size="icon" onClick={() => void send()} disabled={(!draft.trim() && pending.length === 0) || uploading} aria-label="Send">
                  <Send className="size-4" />
                </Button>
              </div>
            </div>
          </>
        )}
      </section>

      <NewDmDialog
        open={newDmOpen}
        onOpenChange={setNewDmOpen}
        onOpened={(id) => {
          setNewDmOpen(false);
          qc.invalidateQueries({ queryKey: ["chat-conversations"] });
          void openConversation(id);
        }}
      />
      <NewChannelDialog
        open={newChannelOpen}
        onOpenChange={setNewChannelOpen}
        onCreated={(id) => {
          setNewChannelOpen(false);
          qc.invalidateQueries({ queryKey: ["chat-conversations"] });
          void openConversation(id);
        }}
      />
    </div>
  );
}

function useContacts(open: boolean) {
  return useQuery<{ dm: Contact[]; channel: Contact[] }>({
    queryKey: ["chat-contacts"],
    queryFn: async () => {
      const res = await fetch("/api/chat/contacts");
      if (!res.ok) return { dm: [], channel: [] };
      return res.json();
    },
    enabled: open,
  });
}

function NewDmDialog({
  open,
  onOpenChange,
  onOpened,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onOpened: (conversationId: string) => void;
}) {
  const { data } = useContacts(open);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [q, setQ] = React.useState("");
  const contacts = (data?.dm ?? []).filter((c) => c.name.toLowerCase().includes(q.toLowerCase()));

  async function start(id: string) {
    setBusy(id);
    const res = await openDmAction(id);
    setBusy(null);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    onOpened(res.conversationId);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New message</DialogTitle>
        </DialogHeader>
        <Input placeholder="Search teammates…" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="max-h-80 space-y-1 overflow-y-auto">
          {contacts.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">No teammates available.</p>
          ) : (
            contacts.map((c) => (
              <button
                key={c.id}
                onClick={() => start(c.id)}
                disabled={!!busy}
                className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors hover:bg-muted disabled:opacity-50"
              >
                <span className="grid size-9 place-items-center rounded-full bg-foreground/10 text-sm font-semibold">
                  {initials(c.name)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{c.name}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {c.title ?? roleLabel(c.role)}
                  </span>
                </span>
                {busy === c.id && <Loader2 className="size-4 animate-spin" />}
              </button>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function NewChannelDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onCreated: (conversationId: string) => void;
}) {
  const { data } = useContacts(open);
  const [name, setName] = React.useState("");
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [busy, setBusy] = React.useState(false);
  const contacts = data?.channel ?? [];

  React.useEffect(() => {
    if (!open) {
      setName("");
      setSelected(new Set());
    }
  }, [open]);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function create() {
    if (!name.trim()) {
      toast.error("Give the channel a name.");
      return;
    }
    setBusy(true);
    const res = await createChannelAction({ name: name.trim(), memberIds: [...selected] });
    setBusy(false);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    onCreated(res.conversationId);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New channel</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <Input placeholder="Channel name (e.g. Production Team)" value={name} onChange={(e) => setName(e.target.value)} />
          <div>
            <p className="mb-1.5 text-sm font-medium">Add members</p>
            <div className="max-h-64 space-y-1 overflow-y-auto rounded-lg border border-border p-1">
              {contacts.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">No teammates available.</p>
              ) : (
                contacts.map((c) => (
                  <label
                    key={c.id}
                    className="flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 transition-colors hover:bg-muted"
                  >
                    <Checkbox checked={selected.has(c.id)} onCheckedChange={() => toggle(c.id)} />
                    <span className="grid size-8 place-items-center rounded-full bg-foreground/10 text-xs font-semibold">
                      {initials(c.name)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{c.name}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {c.title ?? roleLabel(c.role)}
                      </span>
                    </span>
                  </label>
                ))
              )}
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={create} disabled={busy}>
            {busy && <Loader2 className="size-4 animate-spin" />}
            Create channel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
