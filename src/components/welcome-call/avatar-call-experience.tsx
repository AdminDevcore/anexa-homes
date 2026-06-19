"use client";

import * as React from "react";
import { CheckCircle2, Loader2, Video, Mic } from "lucide-react";
import { Logo } from "@/components/marketing/logo";
import { Button } from "@/components/ui/button";
import { pollAvatarCallAction } from "@/server/modules/welcome-call/actions";

type Segment = { key: string; text: string; kind: "video" | "tts"; url: string | null };
type Snapshot = { intro: string; closing: string; items: { id: string; title: string; body: string }[] };
type Stage = "consent" | "preparing" | "calling" | "uploading" | "done" | "error";

const W = 1280;
const H = 720;
const MIMES = ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm", "video/mp4"];
function pickMime(): string {
  if (typeof MediaRecorder === "undefined") return "";
  for (const m of MIMES) if (MediaRecorder.isTypeSupported(m)) return m;
  return "";
}

export function AvatarCallExperience({
  token,
  customerName,
  snapshot,
  avatarStatus,
  segments: initialSegments,
}: {
  token: string;
  customerName: string;
  snapshot: Snapshot;
  avatarStatus: "none" | "generating" | "ready" | "failed";
  segments: Segment[];
}) {
  const [stage, setStage] = React.useState<Stage>(avatarStatus === "ready" ? "consent" : "preparing");
  const [segments, setSegments] = React.useState<Segment[]>(initialSegments);
  const [idx, setIdx] = React.useState(0);
  const [phase, setPhase] = React.useState<"playing" | "answering">("playing");
  const [error, setError] = React.useState<string | null>(null);

  const canvasRef = React.useRef<HTMLCanvasElement | null>(null);
  const avatarVideoRef = React.useRef<HTMLVideoElement | null>(null);
  const camVideoRef = React.useRef<HTMLVideoElement | null>(null);
  const camStreamRef = React.useRef<MediaStream | null>(null);
  const recorderRef = React.useRef<MediaRecorder | null>(null);
  const chunksRef = React.useRef<Blob[]>([]);
  const rafRef = React.useRef<number | null>(null);
  const audioCtxRef = React.useRef<AudioContext | null>(null);
  const idxRef = React.useRef(0);

  // Poll while clips are still generating.
  React.useEffect(() => {
    if (stage !== "preparing") return;
    let active = true;
    const tick = async () => {
      const res = await pollAvatarCallAction(token);
      if (!active) return;
      if (res.avatarStatus === "ready") { setSegments(res.segments as Segment[]); setStage("consent"); return; }
      if (res.avatarStatus === "failed") { setError("We couldn't prepare your video call. Please contact us for a new link."); setStage("error"); return; }
      setTimeout(tick, 4000);
    };
    const t = setTimeout(tick, 3000);
    return () => { active = false; clearTimeout(t); };
  }, [stage, token]);

  // Cleanup media on unmount.
  React.useEffect(() => () => stopAll(), []);

  function stopAll() {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    if (typeof speechSynthesis !== "undefined") speechSynthesis.cancel();
    camStreamRef.current?.getTracks().forEach((t) => t.stop());
    audioCtxRef.current?.close().catch(() => {});
  }

  async function start() {
    if (!pickMime()) { setError("Your browser can't record video. Please use Chrome."); setStage("error"); return; }
    let cam: MediaStream;
    try {
      cam = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 }, audio: true });
    } catch {
      setError("We need camera and microphone access to record your call. Please allow them and try again.");
      setStage("error");
      return;
    }
    camStreamRef.current = cam;
    setStage("calling");
    // Wait a tick for the canvas/video elements to mount.
    setTimeout(() => beginCall(cam), 50);
  }

  function beginCall(cam: MediaStream) {
    const canvas = canvasRef.current;
    const camVideo = camVideoRef.current;
    const avatarVideo = avatarVideoRef.current;
    if (!canvas || !camVideo || !avatarVideo) return;
    camVideo.srcObject = cam;
    camVideo.muted = true;
    camVideo.play().catch(() => {});

    // Audio graph: mic + (later) avatar audio mixed into one recorded track.
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ac = new AC();
    audioCtxRef.current = ac;
    const dest = ac.createMediaStreamDestination();
    ac.createMediaStreamSource(cam).connect(dest); // mic → recording
    try {
      const avatarSrc = ac.createMediaElementSource(avatarVideo);
      avatarSrc.connect(dest); // avatar voice → recording
      avatarSrc.connect(ac.destination); // …and to the speakers
    } catch { /* element source already created / unsupported */ }

    // Composite avatar (or question card) + webcam PiP onto the canvas every frame.
    const ctx = canvas.getContext("2d")!;
    const draw = () => {
      ctx.fillStyle = "#0b0b0c";
      ctx.fillRect(0, 0, W, H);
      const seg = segments[idxRef.current];
      if (seg?.kind === "video" && avatarVideo.readyState >= 2) {
        ctx.drawImage(avatarVideo, 0, 0, W, H);
      } else if (seg) {
        ctx.fillStyle = "#f6f3ee";
        ctx.font = "600 40px -apple-system, Segoe UI, sans-serif";
        ctx.textAlign = "center";
        wrapText(ctx, seg.text, W / 2, H / 2 - 40, W - 240, 52);
      }
      if (camVideo.readyState >= 2) {
        const pw = 320, ph = 240, m = 24;
        ctx.drawImage(camVideo, W - pw - m, H - ph - m, pw, ph);
        ctx.strokeStyle = "rgba(255,255,255,0.5)";
        ctx.lineWidth = 3;
        ctx.strokeRect(W - pw - m, H - ph - m, pw, ph);
      }
      rafRef.current = requestAnimationFrame(draw);
    };
    draw();

    const mixed = new MediaStream([...canvas.captureStream(30).getVideoTracks(), ...dest.stream.getAudioTracks()]);
    const rec = new MediaRecorder(mixed, { mimeType: pickMime() });
    chunksRef.current = [];
    rec.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
    rec.onstop = () => void upload();
    rec.start();
    recorderRef.current = rec;

    playSegment(0);
  }

  function playSegment(i: number) {
    idxRef.current = i;
    setIdx(i);
    setPhase("playing");
    const seg = segments[i];
    const avatarVideo = avatarVideoRef.current;
    if (seg.kind === "video" && seg.url && avatarVideo) {
      avatarVideo.src = seg.url;
      avatarVideo.onended = () => setPhase("answering");
      avatarVideo.play().catch(() => setPhase("answering"));
    } else if (typeof speechSynthesis !== "undefined") {
      const u = new SpeechSynthesisUtterance(seg.text);
      u.onend = () => setPhase("answering");
      speechSynthesis.cancel();
      speechSynthesis.speak(u);
      // Safety: if TTS never fires onend, let them answer after a beat.
      setTimeout(() => setPhase("answering"), Math.min(20000, 2500 + seg.text.length * 60));
    } else {
      setPhase("answering");
    }
  }

  function next() {
    const n = idxRef.current + 1;
    if (n < segments.length) playSegment(n);
    else finish();
  }

  function finish() {
    setStage("uploading");
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    recorderRef.current?.stop(); // → onstop → upload()
  }

  async function upload() {
    try {
      const blob = new Blob(chunksRef.current, { type: pickMime() || "video/webm" });
      const res = await fetch(`/api/welcome-call/${token}/recording`, { method: "POST", body: blob, headers: { "Content-Type": blob.type } });
      const json = (await res.json().catch(() => ({ ok: res.ok }))) as { ok?: boolean; error?: string };
      if (!res.ok || !json.ok) throw new Error(json.error || "Upload failed");
      stopAll();
      setStage("done");
    } catch (e) {
      setError(e instanceof Error ? e.message : "We couldn't save your recording. Please try again.");
      setStage("error");
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  if (stage === "preparing")
    return <Shell><Centered icon={<Loader2 className="size-12 animate-spin text-gold" />} title="Preparing your call…" body="We're getting your personalized video ready. This only takes a moment." /></Shell>;

  if (stage === "error")
    return <Shell><Centered icon={<Video className="size-12 text-gold" />} title="Something went wrong" body={error ?? "Please try again."} action={<Button onClick={() => location.reload()} className="bg-gold text-gold-foreground">Try again</Button>} /></Shell>;

  if (stage === "done")
    return <Shell><Centered icon={<CheckCircle2 className="size-14 text-emerald-400" />} title="All done — thank you!" body={snapshot.closing || "Thanks for confirming your details. We'll be in touch shortly."} /></Shell>;

  if (stage === "consent")
    return (
      <Shell>
        <p className="text-xs font-semibold uppercase tracking-[0.3em] text-gold">Welcome Call</p>
        <h1 className="mt-3 font-display text-4xl font-bold sm:text-5xl">Hi {customerName.split(" ")[0] || "there"} 👋</h1>
        <p className="mt-4 text-lg text-white/80">{snapshot.intro || "We'll quickly go over your project details together on a short video call."}</p>
        <div className="mt-8 rounded-2xl border border-white/15 bg-white/5 p-6">
          <p className="flex items-center gap-2 font-medium"><Video className="size-5 text-gold" /> <Mic className="size-5 text-gold" /> This call will be recorded</p>
          <p className="mt-2 text-sm text-white/70">
            We&apos;ll ask to use your <strong>camera and microphone</strong>. An on-screen guide will ask a few quick
            questions — just answer out loud, then tap Next. The session is recorded for your project file.
          </p>
        </div>
        <Button onClick={start} className="mt-6 w-full bg-gold py-6 text-base text-gold-foreground hover:bg-gold/90">
          Allow camera & mic and start
        </Button>
      </Shell>
    );

  // stage === "calling" | "uploading"
  const seg = segments[idx];
  return (
    <Shell>
      <div className="overflow-hidden rounded-2xl border border-white/15 bg-black">
        <canvas ref={canvasRef} width={W} height={H} className="aspect-video w-full" />
      </div>
      {/* Hidden sources for the canvas composite */}
      <video ref={avatarVideoRef} playsInline className="hidden" />
      <video ref={camVideoRef} playsInline muted className="hidden" />

      <div className="mt-5 flex items-center justify-between gap-4">
        <div className="text-sm text-white/70">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-red-500/20 px-2.5 py-1 text-red-300"><span className="size-2 animate-pulse rounded-full bg-red-500" /> Recording</span>
          <span className="ml-3">Question {Math.min(idx + 1, segments.length)} of {segments.length}</span>
        </div>
        {stage === "uploading" ? (
          <span className="inline-flex items-center gap-2 text-white/80"><Loader2 className="size-4 animate-spin" /> Saving…</span>
        ) : phase === "answering" ? (
          <Button onClick={next} className="bg-gold text-gold-foreground hover:bg-gold/90">
            {idx + 1 < segments.length ? "Next question" : "Finish & save"}
          </Button>
        ) : (
          <span className="text-sm text-white/60">{seg?.kind === "tts" ? "Reading…" : "Listen…"}</span>
        )}
      </div>
      {phase === "answering" && stage === "calling" && (
        <p className="mt-3 text-center text-sm text-white/60">Your turn — answer out loud, then tap {idx + 1 < segments.length ? "Next question" : "Finish & save"}.</p>
      )}
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-[#0b0b0c] text-white">
      <header className="border-b border-white/10 px-6 py-4"><Logo invert /></header>
      <div className="mx-auto w-full max-w-3xl px-5 py-10">{children}</div>
    </div>
  );
}

function Centered({ icon, title, body, action }: { icon: React.ReactNode; title: string; body: string; action?: React.ReactNode }) {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 text-center">
      {icon}
      <h1 className="font-display text-3xl font-semibold">{title}</h1>
      <p className="max-w-md text-white/70">{body}</p>
      {action}
    </div>
  );
}

function wrapText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxWidth: number, lineHeight: number) {
  const words = text.split(" ");
  let line = "";
  const lines: string[] = [];
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (ctx.measureText(test).width > maxWidth && line) { lines.push(line); line = w; } else line = test;
  }
  if (line) lines.push(line);
  const startY = y - ((lines.length - 1) * lineHeight) / 2;
  lines.forEach((l, i) => ctx.fillText(l, x, startY + i * lineHeight));
}
