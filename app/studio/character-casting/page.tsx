"use client";

import Image from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";
import StudioSidebar from "../../components/StudioSidebar";
import WorkflowNav from "../../components/WorkflowNav";
import { authenticatedFetch } from "../../../lib/authenticated-fetch";
import { saveProject, type StoredProject } from "../../../lib/project-store";
import { characterCastingSpecialists, type CharacterCastingSpecialist } from "../../../lib/character-casting";

type ChatMessage = { id: string; role: "user" | "assistant"; content: string };
type CastMember = { id: string; name: string; role: string; description: string; image?: string; storagePath?: string; source?: "portfolio" | "generated" };
type Candidate = { image: string; storagePath?: string; source: "portfolio" | "generated"; description?: string };
type CastingState = { specialistId?: string; messages?: ChatMessage[]; characters?: CastMember[]; candidate?: Candidate; candidatePool?: Candidate[]; initialized?: boolean };
type CastingSession = StoredProject & { projectDocument?: unknown; characterCastingSpecialist?: CharacterCastingSpecialist; characterCasting?: CastingState };

const uid = () => crypto.randomUUID();

export default function CharacterCastingPage() {
  const [session, setSession] = useState<CastingSession | null>(null);
  const [portfolioOpen, setPortfolioOpen] = useState(false);
  const [candidatePoolOpen, setCandidatePoolOpen] = useState(false);
  const [preview, setPreview] = useState("");
  const [input, setInput] = useState("");
  const [provider, setProvider] = useState<"anthropic" | "openai">("anthropic");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [attachments, setAttachments] = useState<Array<{ name: string }>>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  const chatEnd = useRef<HTMLDivElement>(null);

  const persist = useCallback((next: CastingSession) => {
    const normalized = { ...next, stage: "casting" as const };
    sessionStorage.setItem("carabasaiCreativeSession", JSON.stringify(normalized));
    saveProject(normalized);
    setSession(normalized);
  }, []);

  const loadSession = useCallback(() => {
    const raw = sessionStorage.getItem("carabasaiCreativeSession");
    if (!raw) return;
    const restored = JSON.parse(raw) as CastingSession;
    setSession(restored);
    setProvider(localStorage.getItem("carabasaiAIProvider") === "openai" ? "openai" : "anthropic");
  }, []);

  useEffect(() => {
    loadSession();
    window.addEventListener("carabasai-active-project-change", loadSession);
    return () => window.removeEventListener("carabasai-active-project-change", loadSession);
  }, [loadSession]);

  const specialist = session?.characterCastingSpecialist ?? characterCastingSpecialists[0];
  const casting = session?.characterCasting ?? {};
  const messages = casting.messages ?? [];
  const characters = casting.characters ?? [];
  const candidate = casting.candidate;
  const candidatePool = casting.candidatePool ?? [];

  const candidateKey = (item: Candidate) => item.storagePath ?? item.image;
  const addToCandidatePool = (pool: Candidate[], item: Candidate) =>
    pool.some((saved) => candidateKey(saved) === candidateKey(item)) ? pool : [item, ...pool];

  const askAgent = useCallback(async (current: CastingSession, nextMessages: ChatMessage[], initial = false) => {
    const response = await authenticatedFetch("/api/casting-room", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider, summary: current.projectDocument, specialist: current.characterCastingSpecialist ?? specialist, messages: nextMessages.map(({ role, content }) => ({ role, content })), cast: current.characterCasting?.characters ?? [], initial }),
    });
    const data = await response.json() as { reply?: string; characters?: Array<{ name: string; role: string; description: string }>; error?: string };
    if (!response.ok || !data.reply) throw new Error(data.error ?? "CASTING AGENT COULD NOT RESPOND.");
    const existing = current.characterCasting?.characters ?? [];
    const detected = (data.characters ?? []).map((item, index) => {
      const match = existing.find((member) => member.name.toLowerCase() === item.name.toLowerCase());
      return { id: match?.id ?? `story-${index}-${item.name}`, ...item, image: match?.image, storagePath: match?.storagePath, source: match?.source } as CastMember;
    });
    const merged = [...detected, ...existing.filter((member) => !detected.some((item) => item.name.toLowerCase() === member.name.toLowerCase()))];
    const reply: ChatMessage = { id: uid(), role: "assistant", content: data.reply };
    return { reply, characters: merged };
  }, [provider, specialist]);

  useEffect(() => {
    if (!session || casting.initialized || busy) return;
    let active = true;
    setBusy(true); setError("");
    void askAgent(session, [], true).then(({ reply, characters: found }) => {
      if (!active) return;
      persist({ ...session, characterCasting: { ...casting, specialistId: specialist.id, initialized: true, messages: [reply], characters: found } });
    }).catch((e: Error) => active && setError(e.message)).finally(() => active && setBusy(false));
    return () => { active = false; };
  }, [session, casting, specialist.id, busy, askAgent, persist]);

  useEffect(() => { chatEnd.current?.scrollIntoView({ behavior: "smooth" }); }, [messages.length, busy]);

  function setProviderChoice(value: "anthropic" | "openai") {
    setProvider(value); localStorage.setItem("carabasaiAIProvider", value);
  }

  function choosePortfolioCharacter(image: string) {
    if (!session) return;
    persist({ ...session, characterCasting: { ...casting, candidate: { image, source: "portfolio" } } });
    setPreview(""); setPortfolioOpen(false);
  }

  function rejectCandidate() {
    if (!session || !candidate) return;
    persist({ ...session, characterCasting: { ...casting, candidate: undefined, candidatePool: addToCandidatePool(candidatePool, candidate) } });
  }

  async function hireCandidate() {
    if (!session || !candidate) return;
    const userPrompt: ChatMessage = { id: uid(), role: "user", content: "I want to hire this candidate. Ask me which story role this person should play." };
    const next = [...messages, userPrompt];
    persist({ ...session, characterCasting: { ...casting, messages: next } });
    setBusy(true);
    try {
      const { reply } = await askAgent(session, next);
      persist({ ...session, characterCasting: { ...casting, messages: [...next, reply], candidate } });
    } catch (e) { setError(e instanceof Error ? e.message : "CASTING AGENT COULD NOT RESPOND."); }
    finally { setBusy(false); }
  }

  async function generateCandidate(brief: string, current: CastingSession) {
    const response = await authenticatedFetch("/api/character-generation", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId: current.id, specialistId: specialist.id, characterBrief: brief, aspectRatio: "9:16" }),
    });
    const data = await response.json() as { imageUrl?: string; storagePath?: string; error?: string };
    if (!response.ok || !data.imageUrl) throw new Error(data.error ?? "CHARACTER COULD NOT BE GENERATED.");
    return { image: data.imageUrl, storagePath: data.storagePath, source: "generated" as const, description: brief };
  }

  async function sendMessage() {
    const content = input.trim();
    if (!session || !content || busy) return;
    setInput(""); setError(""); setBusy(true);
    const userMessage: ChatMessage = { id: uid(), role: "user", content };
    const nextMessages = [...messages, userMessage];
    let current: CastingSession = { ...session, characterCasting: { ...casting, messages: nextMessages } };
    persist(current);
    try {
      const wantsGeneration = /сгенер|созда[йт]|нов(ого|ый) персонаж|generate|new candidate/i.test(content);
      if (wantsGeneration) {
        const generated = await generateCandidate(content, current);
        current = { ...current, characterCasting: { ...current.characterCasting, candidate: generated, candidatePool: addToCandidatePool(current.characterCasting?.candidatePool ?? [], generated) } };
      }
      const { reply, characters: found } = await askAgent(current, nextMessages);
      const currentCandidate = current.characterCasting?.candidate;
      let updatedCast = found;
      if (currentCandidate && !wantsGeneration && /роль|герой|героин|персонаж|отец|мать|жена|муж|сын|дочь|главн/i.test(content)) {
        const target = found.find((item) => !item.image) ?? { id: uid(), name: content.slice(0, 40), role: content, description: "Cast during the session." };
        updatedCast = found.map((item) => item.id === target.id ? { ...item, image: currentCandidate.image, storagePath: currentCandidate.storagePath, source: currentCandidate.source } : item);
        if (!updatedCast.some((item) => item.id === target.id)) updatedCast.push({ ...target, image: currentCandidate.image, storagePath: currentCandidate.storagePath, source: currentCandidate.source });
        current = { ...current, characterCasting: { ...current.characterCasting, candidate: undefined, candidatePool: (current.characterCasting?.candidatePool ?? []).filter((item) => candidateKey(item) !== candidateKey(currentCandidate)) } };
      }
      persist({ ...current, characterCasting: { ...current.characterCasting, messages: [...nextMessages, reply], characters: updatedCast } });
    } catch (e) { setError(e instanceof Error ? e.message : "CASTING AGENT COULD NOT RESPOND."); }
    finally { setBusy(false); }
  }

  function removeCharacter(id: string) {
    if (!session) return;
    persist({ ...session, characterCasting: { ...casting, characters: characters.filter((item) => item.id !== id) } });
  }

  if (!session) return <main className="min-h-screen bg-[#050505] text-white"><StudioSidebar /><div className="flex min-h-screen items-center justify-center text-xs font-black text-[#FFDF00]">OPENING CASTING ROOM...</div></main>;

  return <main className="min-h-screen bg-[#050505] px-4 pb-5 pt-20 text-white md:pl-[calc(var(--studio-sidebar-width,260px)+28px)] md:pt-5">
    <StudioSidebar /><WorkflowNav />
    <div className="mx-auto grid max-w-7xl gap-5 lg:grid-cols-[290px_minmax(0,1fr)]">
      <aside className="space-y-4">
        <button onClick={() => setPortfolioOpen(true)} className="w-full rounded-[22px] border border-[#FFDF00]/25 bg-[#FFDF00]/[.035] p-4 text-left"><div className="flex items-center gap-3"><Image src={specialist.portrait} alt="" width={58} height={58} className="h-14 w-14 rounded-[14px] object-cover object-top"/><div><p className="text-[8px] font-black tracking-[.14em] text-[#FFDF00]">CASTING LEAD</p><h2 className="mt-1 text-base font-black">{specialist.name}</h2><p className="mt-1 text-[8px] text-white/35">CHANGE SPECIALIST →</p></div></div></button>
        <button onClick={() => setPortfolioOpen(true)} className="w-full rounded-full border border-white/10 px-5 py-3 text-[9px] font-black hover:border-[#FFDF00]/40">OPEN PORTFOLIO / 20</button>
        <section className="max-h-[280px] overflow-y-auto rounded-[22px] border border-white/10 p-4"><div className="sticky top-0 flex items-center justify-between bg-[#050505] pb-3"><p className="text-[9px] font-black tracking-[.14em] text-[#FFDF00]">CHARACTER NOTEBOOK</p><button onClick={() => setPortfolioOpen(true)} className="text-lg text-[#FFDF00]">＋</button></div>{characters.length ? <div className="space-y-2">{characters.map((member) => <article key={member.id} className="flex items-center gap-3 rounded-xl border border-white/8 p-2">{member.image ? <Image src={member.image} alt="" width={38} height={38} className="h-9 w-9 rounded-full object-cover object-top"/> : <div className="flex h-9 w-9 items-center justify-center rounded-full bg-white/5 text-xs">?</div>}<div className="min-w-0 flex-1"><p className="truncate text-[9px] font-black">{member.name}</p><p className="truncate text-[8px] text-white/35">{member.role || "ROLE TO CAST"}</p></div><button onClick={() => removeCharacter(member.id)} className="text-white/25 hover:text-red-300">×</button></article>)}</div> : <p className="text-[10px] leading-5 text-white/30">The specialist is reading the project document.</p>}</section>
        <section className="rounded-[22px] border border-white/10 p-4"><div className="flex items-center justify-between"><div><p className="text-[9px] font-black tracking-[.14em] text-[#FFDF00]">CAST</p><p className="mt-1 text-[7px] text-white/25">CANDIDATE TRAY · {candidatePool.length}</p></div><button onClick={() => setCandidatePoolOpen((value) => !value)} className={`text-lg ${candidatePoolOpen ? "text-white" : "text-[#FFDF00]"}`}>{candidatePoolOpen ? "−" : "＋"}</button></div>{candidatePoolOpen && <div className="mt-3 grid max-h-52 grid-cols-3 gap-1 overflow-y-auto">{candidatePool.length ? candidatePool.map((item) => <button key={candidateKey(item)} onClick={() => { if (!session) return; persist({ ...session, characterCasting: { ...casting, candidate: item } }); setCandidatePoolOpen(false); }} className={`relative aspect-[9/16] overflow-hidden rounded-md border ${candidate && candidateKey(candidate) === candidateKey(item) ? "border-[#FFDF00]" : "border-white/10"}`}><Image src={item.image} alt="Saved casting candidate" fill sizes="90px" unoptimized={item.image.startsWith("http")} className="object-cover object-top"/></button>) : <p className="col-span-3 py-4 text-[8px] leading-4 text-white/25">Generated and rejected candidates will wait here.</p>}</div>}{candidate ? <><Image src={candidate.image} alt="Candidate" width={180} height={320} unoptimized={candidate.image.startsWith("http")} className="mt-3 aspect-[9/16] max-h-64 w-full rounded-xl object-cover object-top"/><div className="mt-3 grid grid-cols-2 gap-2"><button onClick={rejectCandidate} className="rounded-full border border-white/10 py-2 text-[8px] font-black">REJECT</button><button onClick={() => void hireCandidate()} className="rounded-full bg-[#FFDF00] py-2 text-[8px] font-black text-black">HIRE</button></div></> : <p className="mt-3 text-[9px] leading-5 text-white/30">Generate a new candidate or select one from the specialist portfolio.</p>}</section>
      </aside>
      <section className="flex h-[calc(100dvh-105px)] min-h-[620px] flex-col overflow-hidden rounded-[28px] border border-white/10 bg-[#0A0A0A]">
        <header className="shrink-0 border-b border-white/10 p-5"><p className="text-[9px] font-black tracking-[.18em] text-[#FFDF00]">CHARACTER DEVELOPMENT</p><h1 className="mt-2 text-xl font-black">CAST THE PEOPLE WHO CARRY THE STORY.</h1></header>
        <div className="min-h-0 flex-1 overflow-y-auto p-5 sm:p-7"><div className="space-y-4">{messages.map((message) => message.role === "assistant" ? <article key={message.id} className="flex gap-3"><Image src={specialist.portrait} alt="" width={40} height={40} className="h-10 w-10 rounded-full object-cover"/><div className="max-w-[82%] rounded-[20px] border border-[#FFDF00]/20 bg-[#17150b] p-4 text-sm leading-6 text-white/75"><p className="mb-2 text-[8px] font-black tracking-[.12em] text-[#FFDF00]">{specialist.name}</p>{message.content}</div></article> : <article key={message.id} className="ml-auto max-w-[80%] rounded-[20px] bg-[#FFDF00] p-4 text-sm leading-6 text-black">{message.content}</article>)}{busy && <div className="flex items-center gap-3 text-[9px] text-white/35"><span className="h-3 w-3 animate-spin rounded-full border-2 border-[#FFDF00]/25 border-t-[#FFDF00]"/>{specialist.name} IS THINKING...</div>}<div ref={chatEnd}/></div></div>
        {error && <div className="mx-4 mb-2 rounded-xl border border-red-400/20 bg-red-500/5 p-3 text-[9px] text-red-200">{error}</div>}
        <footer className="shrink-0 border-t border-white/10 p-4"><div className="mb-2 flex flex-wrap items-center justify-between gap-2"><div className="flex gap-2"><button onClick={() => fileRef.current?.click()} className="rounded-full border border-white/10 px-4 py-2 text-[8px] font-black">＋ ADD REFERENCES</button><button onClick={() => { setInput(""); setAttachments([]); }} className="rounded-full border border-white/10 px-4 py-2 text-[8px] font-black text-white/45">RESET</button></div><div className="flex rounded-full border border-white/10 p-1"><button onClick={() => setProviderChoice("anthropic")} className={`rounded-full px-4 py-2 text-[8px] font-black ${provider === "anthropic" ? "bg-[#FFDF00] text-black" : "text-white/35"}`}>CLAUDE</button><button onClick={() => setProviderChoice("openai")} className={`rounded-full px-4 py-2 text-[8px] font-black ${provider === "openai" ? "bg-[#FFDF00] text-black" : "text-white/35"}`}>GPT</button></div></div><input ref={fileRef} type="file" multiple className="hidden" onChange={(event) => setAttachments(Array.from(event.target.files ?? []).map((file) => ({ name: file.name })))}/>{attachments.length > 0 && <p className="mb-2 text-[8px] text-white/35">{attachments.map((item) => item.name).join(" · ")}</p>}<div className="flex items-end gap-3 rounded-[20px] border border-white/10 bg-black p-3"><textarea value={input} onChange={(event) => setInput(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void sendMessage(); } }} placeholder="DIRECT THE CASTING..." className="min-h-12 flex-1 resize-none bg-transparent p-3 text-sm outline-none"/><button onClick={() => void sendMessage()} disabled={!input.trim() || busy} className="rounded-full bg-[#FFDF00] px-6 py-4 text-[9px] font-black text-black disabled:opacity-25">SEND</button></div></footer>
      </section>
    </div>
    {portfolioOpen && <div className="fixed inset-0 z-[10000] bg-black/90 p-3 backdrop-blur-md"><section className="mx-auto flex h-full max-w-6xl flex-col overflow-hidden rounded-[26px] border border-white/10 bg-[#090909]"><header className="flex items-center justify-between p-5"><div><p className="text-[9px] font-black text-[#FFDF00]">{specialist.name} / COMPANY</p><h2 className="mt-2 text-xl font-black">CHOOSE FROM 20 CASTING PORTRAITS.</h2></div><button onClick={() => { setPortfolioOpen(false); setPreview(""); }} className="text-3xl text-white/45">×</button></header><div className="min-h-0 flex-1 overflow-y-auto"><div className="grid grid-cols-3 gap-0 sm:grid-cols-5">{specialist.characterExamples.map((character) => <button key={character.image} onClick={() => setPreview(character.image)} className={`relative aspect-[9/16] overflow-hidden ${preview === character.image ? "ring-4 ring-inset ring-[#FFDF00]" : ""}`}><Image src={character.image} alt={character.alt} fill sizes="20vw" className="object-cover object-top"/></button>)}</div></div>{preview && <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/85 p-5" onClick={() => setPreview("")}><div className="flex h-full max-h-[86vh] flex-col" onClick={(event) => event.stopPropagation()}><div className="relative min-h-0 flex-1 aspect-[9/16]"><Image src={preview} alt="Full casting portrait" fill sizes="60vw" className="object-contain"/></div><button onClick={() => choosePortfolioCharacter(preview)} className="mt-3 rounded-full bg-[#FFDF00] px-8 py-4 text-[10px] font-black text-black">SELECT THIS CHARACTER</button></div></div>}</section></div>}
  </main>;
}
