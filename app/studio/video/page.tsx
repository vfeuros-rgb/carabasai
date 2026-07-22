"use client";

import { FormEvent, PointerEvent as ReactPointerEvent, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import StudioSidebar from "../../components/StudioSidebar";
import { authenticatedFetch } from "../../../lib/authenticated-fetch";

type VideoMessage = { id: string; prompt: string; videoUrl?: string; error?: string };
const STORAGE_KEY = "carabasaiVideoChat";
const videoModels = [
  ["dreamina-seedance-2-0-260128", "SEEDANCE 2.0"],
  ["dreamina-seedance-2-0-fast-260128", "SEEDANCE 2.0 FAST"],
  ["dreamina-seedance-2-0-mini-260615", "SEEDANCE 2.0 MINI"],
  ["seedance-1-5-pro-251215", "SEEDANCE 1.5 PRO"],
  ["gemini-omni-flash-preview", "GEMINI OMNI FLASH"],
  ["veo-3.1-generate-preview", "VEO 3.1"],
  ["veo-3.1-fast-generate-preview", "VEO 3.1 FAST"],
  ["veo-3.1-lite-generate-preview", "VEO 3.1 LITE"],
] as const;

export default function VideoPage() {
  const router = useRouter();
  const [draft, setDraft] = useState("");
  const [model, setModel] = useState<(typeof videoModels)[number][0]>("dreamina-seedance-2-0-260128");
  const [messages, setMessages] = useState<VideoMessage[]>([]);
  const [ratio, setRatio] = useState("16:9");
  const [resolution, setResolution] = useState("720p");
  const [duration, setDuration] = useState(5);
  const [busy, setBusy] = useState(false);
  const [composerSize, setComposerSize] = useState({ width: 995, height: 188 });
  const resizeStart = useRef<{ x: number; y: number; width: number; height: number } | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => { try { const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]"); if (Array.isArray(stored)) setMessages(stored); } catch { localStorage.removeItem(STORAGE_KEY); } }, []);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [messages, busy]);
  function beginResize(event: ReactPointerEvent<HTMLButtonElement>) { resizeStart.current = { x: event.clientX, y: event.clientY, ...composerSize }; event.currentTarget.setPointerCapture(event.pointerId); }
  function resize(event: ReactPointerEvent<HTMLButtonElement>) { const start = resizeStart.current; if (!start) return; setComposerSize({ width: Math.max(420, Math.min(window.innerWidth - 285, start.width + event.clientX - start.x)), height: Math.max(150, Math.min(window.innerHeight * .65, start.height - event.clientY + start.y)) }); }
  async function waitForVideo(taskId: string) {
    for (let attempt = 0; attempt < 120; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 5000));
      const response = await authenticatedFetch(`/api/video-generation?taskId=${encodeURIComponent(taskId)}`, { cache: "no-store" });
      const payload = await response.json() as { status?: string; videoUrl?: string; error?: string };
      if (!response.ok || payload.status === "failed") throw new Error(payload.error || "VIDEO GENERATION FAILED.");
      if (payload.status === "succeeded" && payload.videoUrl) return payload.videoUrl;
    }
    throw new Error("VIDEO GENERATION IS STILL RUNNING. TRY AGAIN LATER.");
  }
  async function submit(event: FormEvent) {
    event.preventDefault(); const prompt = draft.trim(); if (!prompt || busy) return;
    const id = crypto.randomUUID(); const pending = [...messages, { id, prompt }]; setMessages(pending); setDraft(""); setBusy(true);
    try {
      const response = await authenticatedFetch("/api/video-generation", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt, model, aspectRatio: ratio, resolution, duration }) });
      const payload = await response.json() as { taskId?: string; videoUrl?: string; error?: string }; if (!response.ok || (!payload.taskId && !payload.videoUrl)) throw new Error(payload.error || "VIDEO GENERATION FAILED.");
      const videoUrl = payload.videoUrl || await waitForVideo(payload.taskId!); const next = pending.map((item) => item.id === id ? { ...item, videoUrl } : item); setMessages(next); localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch (error) { const next = pending.map((item) => item.id === id ? { ...item, error: error instanceof Error ? error.message : "VIDEO GENERATION FAILED." } : item); setMessages(next); localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); }
    finally { setBusy(false); }
  }

  return <main className="min-h-dvh bg-black text-white md:pl-[var(--studio-sidebar-width,260px)]"><StudioSidebar/><section className="flex min-h-dvh flex-col px-4 pb-5 pt-16 md:px-8 md:pt-6"><div className="flex flex-1 flex-col overflow-y-auto pb-64">
    {!messages.length && <div className="my-auto text-center"><h1 className="text-[34px] font-black uppercase leading-none tracking-[-.035em] sm:text-[42px]">Describe your video.</h1></div>}
    <div className="mx-auto w-full max-w-6xl space-y-14 py-10">{messages.map((message) => <article key={message.id}><p className="ml-auto max-w-3xl text-right text-lg font-semibold">{message.prompt}</p>{message.videoUrl ? <video src={message.videoUrl} controls playsInline className="mx-auto mt-7 max-h-[70vh] w-full max-w-4xl bg-[#111] object-contain"/> : message.error ? <p className="mt-5 text-right text-sm font-bold text-red-300">{message.error}</p> : <p className="mt-5 animate-pulse text-right text-xs font-black tracking-[.16em] text-[#FFDF00]">GENERATING VIDEO…</p>}</article>)}<div ref={endRef}/></div>
  </div><div className="pointer-events-none fixed bottom-[18px] left-1/2 z-30 h-[245px] w-[1045px] max-w-[calc(100vw-285px)] -translate-x-1/2 bg-[#030303] md:bottom-[35px] md:ml-[calc(var(--studio-sidebar-width,260px)/2)]"/>
  <form onSubmit={submit} style={{ width: `min(${composerSize.width}px, calc(100vw - 310px))`, height: composerSize.height }} className="fixed bottom-[28px] left-1/2 z-40 flex -translate-x-1/2 flex-col rounded-[28px] bg-[#202020] px-5 pb-4 pt-5 shadow-[0_16px_60px_rgba(0,0,0,.72)] md:bottom-[48px] md:ml-[calc(var(--studio-sidebar-width,260px)/2)] max-md:!w-[calc(100vw-28px)]">
    <div className="absolute -left-[58px] bottom-2 flex w-11 flex-col gap-1 rounded-[10px] bg-[#141414] p-1.5 shadow-xl max-md:hidden"><button type="button" onClick={() => router.push("/studio/image")} title="Image generation" className="flex h-9 w-8 items-center justify-center rounded-[7px] text-sm text-white/55 hover:bg-[#292929] hover:text-[#FFDF00]">▣</button><button type="button" onClick={() => router.push("/studio/video")} title="Video generation" className="flex h-9 w-8 items-center justify-center rounded-[7px] bg-[#292929] text-sm text-[#FFDF00]">▶</button></div>
    <button type="button" aria-label="Resize prompt field" onPointerDown={beginResize} onPointerMove={resize} onPointerUp={() => { resizeStart.current = null; }} onPointerCancel={() => { resizeStart.current = null; }} className="absolute -right-[2px] -top-[2px] h-8 w-8 touch-none cursor-nesw-resize rounded-tr-[28px] border-r-[3px] border-t-[3px] border-white/30"/>
    <button type="submit" disabled={!draft.trim() || busy} aria-label="Generate video" className="absolute right-5 top-5 flex h-10 w-10 items-center justify-center rounded-full bg-[#FFDF00] text-xl font-black text-black disabled:opacity-30">↑</button>
    <textarea value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }} placeholder="Describe a video" className="min-h-0 flex-1 resize-none bg-transparent px-1 pb-3 pr-14 pt-1 text-[15px] leading-6 text-white outline-none placeholder:text-white/28"/>
    <div className="flex flex-nowrap items-center gap-2 overflow-x-auto pt-2 text-[9px] font-black [scrollbar-width:none]"><label className="flex h-8 shrink-0 items-center gap-2 rounded-full bg-[#292929] pl-3 pr-1 text-white/45"><span>MODELS</span><select value={model} onChange={(event) => setModel(event.target.value as typeof model)} className="h-7 max-w-[190px] bg-transparent pr-2 text-[10px] font-bold text-white/75 outline-none">{videoModels.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label><label className="flex h-8 shrink-0 items-center gap-2 rounded-full bg-[#292929] px-3 text-white/60"><span className="h-3 w-5 rounded-[3px] border border-white/35"/><select value={ratio} onChange={(event) => setRatio(event.target.value)} className="bg-transparent text-[10px] font-bold outline-none">{["16:9","9:16","1:1","4:3","3:4","21:9","adaptive"].map((item) => <option key={item}>{item}</option>)}</select></label><label className="flex h-8 shrink-0 items-center gap-2 rounded-full bg-[#292929] px-3 text-white/60"><span>◇</span><select value={resolution} onChange={(event) => setResolution(event.target.value)} className="bg-transparent text-[10px] font-bold outline-none">{["480p","720p","1080p"].map((item) => <option key={item}>{item}</option>)}</select></label><label className="flex h-8 shrink-0 items-center gap-2 rounded-full bg-[#292929] px-3 text-white/60"><span>◷</span><select value={duration} onChange={(event) => setDuration(Number(event.target.value))} className="bg-transparent text-[10px] font-bold outline-none"><option value={5}>5 SEC</option><option value={10}>10 SEC</option></select></label></div>
  </form></section></main>;
}
