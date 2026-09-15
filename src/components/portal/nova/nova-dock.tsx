"use client";

import * as React from "react";
import { usePathname, useRouter } from "next/navigation";
import { AudioLines, Loader2, Mic, Send, Volume2, VolumeX, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Line = { id: number; role: "user" | "assistant"; text: string; tone?: "error" | "confirm" | "done" };
type Pending = { id: string; summary: string };
type Reply = {
  conversationId?: string;
  kind?: string;
  reply?: string;
  pending?: Pending;
  /** What the server heard, for a spoken request. */
  transcript?: string;
  error?: string;
};

const MUTE_KEY = "nova-muted";
/** A press shorter than this is a tap, not speech. */
const MIN_HOLD_MS = 350;

function recorderMime(): string {
  if (typeof MediaRecorder === "undefined") return "";
  return ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"].find((m) =>
    MediaRecorder.isTypeSupported(m)
  ) ?? "";
}

const extensionFor = (mime: string) => (mime.includes("mp4") ? "mp4" : mime.includes("ogg") ? "ogg" : "webm");

/**
 * Nova, the Solar assistant: hold the mic and talk, or type.
 *
 * Everything with a key in it happens on the server. This component records,
 * posts the audio (or text) with the page it is on, shows the transcript, and
 * plays back the reply. A change Nova proposes shows Confirm and Cancel — and
 * nothing is changed until one of those, or a spoken yes, reaches the server.
 */
export function NovaDock({ voice }: { voice: boolean }) {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [lines, setLines] = React.useState<Line[]>([]);
  const [draft, setDraft] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [recording, setRecording] = React.useState(false);
  const [pending, setPending] = React.useState<Pending | null>(null);
  // Read once on the client. The panel starts closed, so the server's render
  // never shows the mute control and the two renders cannot disagree.
  const [muted, setMuted] = React.useState(() => {
    try {
      return typeof window !== "undefined" && localStorage.getItem(MUTE_KEY) === "1";
    } catch {
      return false;
    }
  });

  const conversationId = React.useRef<string | null>(null);
  const recorder = React.useRef<MediaRecorder | null>(null);
  const holding = React.useRef(false);
  const heldSince = React.useRef(0);
  const player = React.useRef<HTMLAudioElement | null>(null);
  const nextId = React.useRef(1);
  const list = React.useRef<HTMLDivElement>(null);
  // The recorder's stop handler runs after renders it did not see.
  const latest = React.useRef({ lines, pending, pathname });
  React.useEffect(() => {
    latest.current = { lines, pending, pathname };
  }, [lines, pending, pathname]);

  React.useEffect(() => {
    list.current?.scrollTo({ top: list.current.scrollHeight });
  }, [lines, busy]);

  // Closing the panel stops the mic and the voice.
  React.useEffect(() => {
    if (open) return;
    holding.current = false;
    if (recorder.current && recorder.current.state !== "inactive") recorder.current.stop();
    player.current?.pause();
  }, [open]);

  const push = (role: Line["role"], text: string, tone?: Line["tone"]) =>
    setLines((prev) => [...prev, { id: nextId.current++, role, text, tone }].slice(-40));

  const context = () => ({
    history: latest.current.lines
      .filter((l) => l.tone !== "error")
      .slice(-12)
      .map((l) => ({ role: l.role, text: l.text })),
    pathname: latest.current.pathname,
    conversationId: conversationId.current,
    pendingActionId: latest.current.pending?.id ?? null,
  });

  function toggleMute() {
    const next = !muted;
    setMuted(next);
    if (next) player.current?.pause();
    try {
      localStorage.setItem(MUTE_KEY, next ? "1" : "0");
    } catch {
      // Not remembered; still applies now.
    }
  }

  async function speak(text: string) {
    if (!voice || muted || !text) return;
    try {
      const res = await fetch("/api/nova/speech", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      if (!res.ok) return;
      const url = URL.createObjectURL(await res.blob());
      player.current?.pause();
      const audio = new Audio(url);
      audio.onended = () => URL.revokeObjectURL(url);
      player.current = audio;
      await audio.play();
    } catch {
      // The voice is a convenience; the answer is already in the transcript.
    }
  }

  async function handle(res: Response) {
    const data = (await res.json().catch(() => ({}))) as Reply;
    if (data.conversationId) conversationId.current = data.conversationId;
    if (data.transcript !== undefined) push("user", data.transcript || "…");
    if (!data.reply) {
      push("assistant", data.error ?? "Nova isn't available right now.", "error");
      return;
    }
    const tone =
      data.kind === "confirm" ? "confirm" : data.kind === "done" ? "done" : data.kind === "error" || data.kind === "failed" ? "error" : undefined;
    push("assistant", data.reply, tone);
    setPending(data.kind === "confirm" && data.pending ? data.pending : null);
    if (data.kind === "done") router.refresh();
    void speak(data.reply);
  }

  async function post(url: string, body: BodyInit, json: boolean) {
    setBusy(true);
    try {
      const res = await fetch(url, {
        method: "POST",
        body,
        headers: json ? { "Content-Type": "application/json" } : undefined,
      });
      await handle(res);
    } catch {
      push("assistant", "I couldn't reach the server. Check your connection and try again.", "error");
    } finally {
      setBusy(false);
    }
  }

  async function sendText(e: React.FormEvent) {
    e.preventDefault();
    const text = draft.trim();
    if (!text || busy) return;
    const body = JSON.stringify({ text, ...context() });
    setDraft("");
    push("user", text);
    await post("/api/nova/turn", body, true);
  }

  async function decide(decision: "confirm" | "cancel") {
    if (!pending || busy) return;
    push("user", decision === "confirm" ? "Confirm" : "Cancel");
    await post(
      "/api/nova/confirm",
      JSON.stringify({ pendingActionId: pending.id, decision, conversationId: conversationId.current }),
      true
    );
  }

  async function startListening() {
    if (recorder.current || busy) return;
    holding.current = true;
    player.current?.pause();
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (e) {
      holding.current = false;
      const blocked = e instanceof DOMException && (e.name === "NotAllowedError" || e.name === "SecurityError");
      push(
        "assistant",
        blocked
          ? "Microphone access is blocked. Allow it for this site in your browser, or type instead."
          : "I couldn't start the microphone. You can type instead.",
        "error"
      );
      return;
    }
    // Released while the browser was still asking for permission.
    if (!holding.current) {
      stream.getTracks().forEach((t) => t.stop());
      return;
    }

    const mime = recorderMime();
    const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    const chunks: Blob[] = [];
    rec.ondataavailable = (ev) => {
      if (ev.data.size > 0) chunks.push(ev.data);
    };
    rec.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      recorder.current = null;
      setRecording(false);
      const type = rec.mimeType || mime || "audio/webm";
      const audio = new Blob(chunks, { type });
      if (Date.now() - heldSince.current < MIN_HOLD_MS || audio.size === 0) {
        push("assistant", "Hold the mic button down while you talk.", "error");
        return;
      }
      const form = new FormData();
      form.append("audio", audio, `speech.${extensionFor(type)}`);
      form.append("payload", JSON.stringify(context()));
      void post("/api/nova/turn", form, false);
    };
    recorder.current = rec;
    heldSince.current = Date.now();
    rec.start();
    setRecording(true);
  }

  function stopListening() {
    holding.current = false;
    if (recorder.current && recorder.current.state !== "inactive") recorder.current.stop();
  }

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        className="gap-1.5"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls="nova-panel"
        data-testid="nova-toggle"
      >
        <AudioLines className="size-4" />
        <span className="hidden sm:inline">Nova</span>
      </Button>

      {open && (
        <div
          id="nova-panel"
          role="dialog"
          aria-label="Nova"
          data-testid="nova-panel"
          onKeyDown={(e) => {
            if (e.key === "Escape") setOpen(false);
          }}
          className="fixed right-4 top-[4.5rem] z-50 flex max-h-[min(36rem,calc(100vh-6rem))] w-[min(24rem,calc(100vw-2rem))] flex-col rounded-xl border border-border bg-background text-foreground shadow-xl"
        >
          <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-2.5">
            <div>
              <p className="text-sm font-semibold">Nova</p>
              <p className="text-[11px] text-muted-foreground">Solar assistant · acts as you, asks before changing anything</p>
            </div>
            <div className="flex items-center">
              {voice && (
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={toggleMute}
                  aria-label={muted ? "Turn Nova's voice on" : "Turn Nova's voice off"}
                  aria-pressed={muted}
                >
                  {muted ? <VolumeX className="size-4" /> : <Volume2 className="size-4" />}
                </Button>
              )}
              <Button variant="ghost" size="icon" onClick={() => setOpen(false)} aria-label="Close Nova">
                <X className="size-4" />
              </Button>
            </div>
          </div>

          <div
            ref={list}
            className="min-h-28 flex-1 space-y-2 overflow-y-auto px-4 py-3"
            aria-live="polite"
            data-testid="nova-transcript"
          >
            {lines.length === 0 && (
              <p className="text-sm text-muted-foreground">
                {voice
                  ? "Hold the mic and ask about a deal, your appointments or your tasks."
                  : "Ask about a deal, your appointments or your tasks."}
              </p>
            )}
            {lines.map((l) => (
              <p
                key={l.id}
                data-role={l.role}
                className={cn(
                  "w-fit max-w-[85%] whitespace-pre-wrap rounded-lg px-3 py-2 text-sm",
                  l.role === "user" ? "ml-auto bg-primary text-primary-foreground" : "bg-muted",
                  l.tone === "error" && "bg-destructive/10 text-destructive",
                  l.tone === "confirm" && "border border-border bg-background"
                )}
              >
                {l.text}
              </p>
            ))}
            {busy && (
              <p className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="size-3.5 animate-spin" /> Working…
              </p>
            )}
          </div>

          {pending && (
            <div className="flex items-center gap-2 border-t border-border px-4 py-2.5" data-testid="nova-confirm">
              <span className="mr-auto text-xs text-muted-foreground">{voice ? "Say yes, or" : "Make this change?"}</span>
              <Button size="sm" variant="outline" onClick={() => decide("cancel")} disabled={busy}>
                Cancel
              </Button>
              <Button size="sm" onClick={() => decide("confirm")} disabled={busy}>
                Confirm
              </Button>
            </div>
          )}

          <form onSubmit={sendText} className="flex items-center gap-2 border-t border-border p-3">
            {voice && (
              <button
                type="button"
                aria-label={recording ? "Listening. Release to send" : "Hold to talk to Nova"}
                aria-pressed={recording}
                disabled={busy}
                data-testid="nova-mic"
                onPointerDown={(e) => {
                  e.preventDefault();
                  e.currentTarget.setPointerCapture(e.pointerId);
                  void startListening();
                }}
                onPointerUp={stopListening}
                onPointerCancel={stopListening}
                onKeyDown={(e) => {
                  if ((e.key === " " || e.key === "Enter") && !e.repeat) {
                    e.preventDefault();
                    void startListening();
                  }
                }}
                onKeyUp={(e) => {
                  if (e.key === " " || e.key === "Enter") {
                    e.preventDefault();
                    stopListening();
                  }
                }}
                className={cn(
                  "flex size-9 shrink-0 touch-none items-center justify-center rounded-full border border-border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50",
                  recording ? "animate-pulse bg-destructive text-white" : "bg-muted hover:bg-accent"
                )}
              >
                <Mic className="size-4" />
              </button>
            )}
            <Input
              id="nova-input"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={recording ? "Listening…" : "Type to Nova"}
              aria-label="Message Nova"
              disabled={busy || recording}
              className="h-9 min-w-0 flex-1"
            />
            <Button type="submit" size="icon" disabled={busy || !draft.trim()} aria-label="Send to Nova">
              <Send className="size-4" />
            </Button>
          </form>
        </div>
      )}
    </>
  );
}
