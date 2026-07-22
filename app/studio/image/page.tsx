"use client";

import { ChangeEvent, FormEvent, PointerEvent as ReactPointerEvent, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import StudioSidebar from "../../components/StudioSidebar";
import { authenticatedFetch } from "../../../lib/authenticated-fetch";

type ImageResult = { id: string; imageUrl?: string; storagePath?: string; model?: string };
type ImageChatMessage = { id: string; prompt: string; images?: ImageResult[]; error?: string };
type ReferenceImage = { id: string; name: string; type: string; dataUrl: string };
const STORAGE_KEY = "carabasaiImageChat";
const models = [
  ["gemini-3.1-flash-image", "NANO BANANA 2"],
  ["gemini-3-pro-image", "NANO BANANA PRO"],
  ["gemini-2.5-flash-image", "NANO BANANA"],
  ["gpt-image-2", "GPT IMAGE 2"],
] as const;

export default function ImagePage() {
  const router = useRouter();
  const [draft, setDraft] = useState("");
  const [messages, setMessages] = useState<ImageChatMessage[]>([]);
  const [model, setModel] = useState<(typeof models)[number][0]>("gemini-3.1-flash-image");
  const [ratio, setRatio] = useState("1:1");
  const [quality, setQuality] = useState("medium");
  const [count, setCount] = useState(1);
  const [busy, setBusy] = useState(false);
  const [references, setReferences] = useState<ReferenceImage[]>([]);
  const [composerSize, setComposerSize] = useState({ width: 995, height: 188 });
  const resizeStart = useRef<{ x: number; y: number; width: number; height: number } | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { try { const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]"); if (Array.isArray(stored)) setMessages(stored); } catch { localStorage.removeItem(STORAGE_KEY); } }, []);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [messages, busy]);

  function beginResize(event: ReactPointerEvent<HTMLButtonElement>) {
    resizeStart.current = { x: event.clientX, y: event.clientY, ...composerSize };
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function resize(event: ReactPointerEvent<HTMLButtonElement>) {
    const start = resizeStart.current;
    if (!start) return;
    setComposerSize({ width: Math.max(420, Math.min(window.innerWidth - 285, start.width + event.clientX - start.x)), height: Math.max(150, Math.min(window.innerHeight * .65, start.height - event.clientY + start.y)) });
  }

  async function addReferences(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []).slice(0, 4 - references.length);
    const next = await Promise.all(files.map((file) => new Promise<ReferenceImage>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve({ id: crypto.randomUUID(), name: file.name, type: file.type || "image/png", dataUrl: String(reader.result) });
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    })));
    setReferences((current) => [...current, ...next].slice(0, 4));
    event.target.value = "";
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const prompt = draft.trim();
    if (!prompt || busy) return;
    const id = crypto.randomUUID();
    const pending = [...messages, { id, prompt }];
    setMessages(pending); setDraft(""); setBusy(true);
    try {
      const response = await authenticatedFetch("/api/image-generation", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt, model, aspectRatio: ratio, quality, count, references }) });
      const payload = await response.json() as { images?: ImageResult[]; error?: string };
      if (!response.ok) throw new Error(payload.error || "IMAGE GENERATION FAILED.");
      const next = pending.map((item) => item.id === id ? { ...item, images: payload.images ?? [] } : item);
      setMessages(next); localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch (error) {
      const next = pending.map((item) => item.id === id ? { ...item, error: error instanceof Error ? error.message : "IMAGE GENERATION FAILED." } : item);
      setMessages(next); localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } finally { setBusy(false); }
  }

  return <main className="min-h-dvh bg-black text-white md:pl-[var(--studio-sidebar-width,260px)]">
    <StudioSidebar />
    <section className="flex min-h-dvh flex-col px-4 pb-5 pt-16 md:px-8 md:pt-6">
      <div className="flex flex-1 flex-col overflow-y-auto pb-64">
        {!messages.length && <div className="my-auto text-center"><h1 className="text-[34px] font-black uppercase leading-none tracking-[-.035em] sm:text-[42px]">Describe your image.</h1></div>}
        <div className="mx-auto w-full max-w-6xl space-y-14 py-10">{messages.map((message) => <article key={message.id}><p className="ml-auto max-w-3xl text-right text-lg font-semibold">{message.prompt}</p>{message.images?.length ? <div className={`mt-7 grid gap-3 ${message.images.length === 1 ? "mx-auto max-w-3xl grid-cols-1" : "grid-cols-1 sm:grid-cols-2"}`}>{message.images.map((image) => <img key={image.id} src={image.imageUrl} alt={message.prompt} className="max-h-[70vh] w-full bg-[#111] object-contain" />)}</div> : message.error ? <p className="mt-5 text-right text-sm font-bold text-red-300">{message.error}</p> : <p className="mt-5 animate-pulse text-right text-xs font-black tracking-[.16em] text-[#FFDF00]">GENERATING…</p>}</article>)}<div ref={endRef}/></div>
      </div>
      <div className="pointer-events-none fixed bottom-[18px] left-1/2 z-30 h-[245px] w-[1045px] max-w-[calc(100vw-285px)] -translate-x-1/2 bg-[#030303] md:bottom-[35px] md:ml-[calc(var(--studio-sidebar-width,260px)/2)]" />
      <form onSubmit={submit} style={{ width: `min(${composerSize.width}px, calc(100vw - 310px))`, height: composerSize.height }} className="fixed bottom-[28px] left-1/2 z-40 flex -translate-x-1/2 flex-col rounded-[28px] bg-[#202020] px-5 pb-4 pt-5 shadow-[0_16px_60px_rgba(0,0,0,.72)] md:bottom-[48px] md:ml-[calc(var(--studio-sidebar-width,260px)/2)] max-md:!w-[calc(100vw-28px)]">
        <div className="absolute -left-[58px] bottom-2 flex w-11 flex-col gap-1 rounded-[10px] bg-[#141414] p-1.5 shadow-xl max-md:hidden">
          <button type="button" onClick={() => router.push("/studio/image")} title="Image generation" className="flex h-9 w-8 items-center justify-center rounded-[7px] bg-[#292929] text-sm text-[#FFDF00]">▣</button>
          <button type="button" onClick={() => router.push("/studio/video")} title="Video generation" className="flex h-9 w-8 items-center justify-center rounded-[7px] text-sm text-white/55 hover:bg-[#292929] hover:text-[#FFDF00]">▶</button>
        </div>
        <input ref={imageInputRef} onChange={addReferences} type="file" accept="image/*" multiple className="hidden" />
        {references.length > 0 && <div className="absolute bottom-[calc(100%+10px)] left-0 flex max-w-full gap-2 rounded-xl bg-[#151515] p-2 shadow-2xl">{references.map((reference) => <div key={reference.id} className="relative flex h-28 w-28 items-center justify-center bg-black"><img src={reference.dataUrl} alt={reference.name} className="max-h-full max-w-full object-contain"/><button type="button" onClick={() => setReferences((current) => current.filter((item) => item.id !== reference.id))} aria-label={`Remove ${reference.name}`} className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-black/80 text-xs text-white">×</button></div>)}</div>}
        <button type="button" aria-label="Resize prompt field" onPointerDown={beginResize} onPointerMove={resize} onPointerUp={() => { resizeStart.current = null; }} onPointerCancel={() => { resizeStart.current = null; }} className="absolute -right-[2px] -top-[2px] h-8 w-8 touch-none cursor-nesw-resize rounded-tr-[28px] border-r-[3px] border-t-[3px] border-white/30" />
        <button type="submit" disabled={!draft.trim() || busy} aria-label="Generate image" className="absolute right-5 top-5 flex h-10 w-10 items-center justify-center rounded-full bg-[#FFDF00] text-xl font-black text-black shadow-[0_0_18px_rgba(255,223,0,.16)] disabled:opacity-30">↑</button>
        <textarea value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }} placeholder="Prompt or add images to edit" className="min-h-0 flex-1 resize-none bg-transparent px-1 pb-3 pr-14 pt-1 text-[15px] leading-6 text-white outline-none placeholder:text-white/28" />
        <div className="flex flex-nowrap items-center gap-2 overflow-x-auto pt-2 text-[9px] font-black [scrollbar-width:none]">
          <button type="button" onClick={() => imageInputRef.current?.click()} title="Attach reference image" className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#292929] text-sm ${references.length ? "text-[#FFDF00]" : "text-white/75"}`}>✹</button>
          <label className="flex h-8 shrink-0 items-center gap-2 rounded-full bg-[#292929] pl-3 pr-1 text-white/45"><span>MODELS</span><select value={model} onChange={(event) => setModel(event.target.value as typeof model)} className="h-7 max-w-[175px] bg-transparent pr-2 text-[10px] font-bold text-white/75 outline-none">{models.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
          <label className="flex h-8 shrink-0 items-center gap-2 rounded-full bg-[#292929] px-3 text-white/60"><span className="h-3 w-5 rounded-[3px] border border-white/35"/><select value={ratio} onChange={(event) => setRatio(event.target.value)} className="bg-transparent text-[10px] font-bold outline-none">{["1:1", "16:9", "9:16", "4:3", "3:4"].map((item) => <option key={item}>{item}</option>)}</select></label>
          <label className="flex h-8 shrink-0 items-center gap-2 rounded-full bg-[#292929] px-3 text-white/60"><span>◇</span><select value={quality} onChange={(event) => setQuality(event.target.value)} className="bg-transparent text-[10px] font-bold outline-none"><option value="low">1K</option><option value="medium">2K</option><option value="high">4K</option></select></label>
          <label className="flex h-8 shrink-0 items-center gap-2 rounded-full bg-[#292929] px-3 text-white/60"><span>#</span><select value={count} onChange={(event) => setCount(Number(event.target.value))} className="bg-transparent text-[10px] font-bold outline-none">{[1,2,3,4].map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
        </div>
      </form>
    </section>
  </main>;
}
