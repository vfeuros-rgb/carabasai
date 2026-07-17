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
type CharacterAttachment = Candidate & { id: string; name: string };
type GenerationFlow = { stage: "choose-role" | "describe" | "ready" | "candidate" | "rejected"; roleId?: string; roleLabel?: string; brief?: string; russian?: boolean };
type CastingState = { specialistId?: string; messages?: ChatMessage[]; characters?: CastMember[]; candidate?: Candidate; candidatePool?: Candidate[]; pendingRoleMemberId?: string; generationFlow?: GenerationFlow; initialized?: boolean };
type CastingSession = StoredProject & { projectDocument?: unknown; characterCastingSpecialist?: CharacterCastingSpecialist; characterCasting?: CastingState };
type BusyMode = "summary" | "reply" | "generation" | null;

const uid = () => crypto.randomUUID();

export default function CharacterCastingPage() {
  const [session, setSession] = useState<CastingSession | null>(null);
  const [portfolioOpen, setPortfolioOpen] = useState(false);
  const [candidatePoolOpen, setCandidatePoolOpen] = useState(false);
  const [preview, setPreview] = useState("");
  const [input, setInput] = useState("");
  const [provider, setProvider] = useState<"anthropic" | "openai">("anthropic");
  const [busyMode, setBusyMode] = useState<BusyMode>(null);
  const [error, setError] = useState("");
  const [attachments, setAttachments] = useState<Array<{ name: string }>>([]);
  const [characterAttachments, setCharacterAttachments] = useState<CharacterAttachment[]>([]);
  const [editingRoleId, setEditingRoleId] = useState("");
  const [roleDraft, setRoleDraft] = useState("");
  const [addingRole, setAddingRole] = useState(false);
  const [newRoleDraft, setNewRoleDraft] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const chatEnd = useRef<HTMLDivElement>(null);
  const initialRequestRef = useRef("");
  const busy = busyMode !== null;

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
  const generationFlow = casting.generationFlow;

  const candidateKey = (item: Candidate) => item.storagePath ?? item.image;
  const addToCandidatePool = (pool: Candidate[], item: Candidate) =>
    pool.some((saved) => candidateKey(saved) === candidateKey(item)) ? pool : [item, ...pool];

  const askAgent = useCallback(async (current: CastingSession, nextMessages: ChatMessage[], initial = false, visualAttachments: CharacterAttachment[] = []) => {
    const response = await authenticatedFetch("/api/casting-room", {
      method: "POST", headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(65000),
      body: JSON.stringify({ provider, summary: current.projectDocument, specialist: current.characterCastingSpecialist ?? specialist, messages: nextMessages.map(({ role, content }) => ({ role, content })), cast: current.characterCasting?.characters ?? [], attachments: visualAttachments.map(({ image, name }) => ({ image, label: name })), initial }),
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
    if (!session || casting.initialized) return;
    const requestKey = `${session.id}:${specialist.id}`;
    if (initialRequestRef.current === requestKey) return;
    initialRequestRef.current = requestKey;
    setBusyMode("summary"); setError("");
    void askAgent(session, [], true).then(({ reply, characters: found }) => {
      persist({ ...session, characterCasting: { ...casting, specialistId: specialist.id, initialized: true, messages: [reply], characters: found } });
    }).catch((e: Error) => {
      setError(e.name === "TimeoutError" ? "THE CASTING AGENT TOOK TOO LONG TO STUDY THE SUMMARY. YOU CAN STILL SEND A MESSAGE." : e.message);
      persist({ ...session, characterCasting: { ...casting, specialistId: specialist.id, initialized: true } });
    }).finally(() => setBusyMode(null));
  }, [session, casting, specialist.id, askAgent, persist]);

  useEffect(() => { chatEnd.current?.scrollIntoView({ behavior: "smooth" }); }, [messages.length, busy]);

  function setProviderChoice(value: "anthropic" | "openai") {
    setProvider(value); localStorage.setItem("carabasaiAIProvider", value);
  }

  function choosePortfolioCharacter(image: string) {
    if (!session) return;
    persist({ ...session, characterCasting: { ...casting, candidate: { image, source: "portfolio" } } });
    setPreview(""); setPortfolioOpen(false);
  }

  function attachCharacter(member: CastMember) {
    if (!member.image) return;
    const image = member.image;
    setCharacterAttachments((current) => current.some((item) => item.image === image) ? current : [...current, { id: uid(), name: member.name || member.role, image, storagePath: member.storagePath, source: member.source ?? "portfolio" }]);
  }

  function rejectCandidate() {
    if (!session || !candidate) return;
    if (!generationFlow?.brief) {
      persist({ ...session, characterCasting: { ...casting, candidate: undefined, candidatePool: addToCandidatePool(candidatePool, candidate) } });
      return;
    }
    const russian = generationFlow?.russian ?? true;
    const reply: ChatMessage = { id: uid(), role: "assistant", content: russian ? "Этот кандидат нам не подошёл. Меняем критерии или генерируем ещё раз?" : "This candidate did not fit. Shall we change the criteria or generate another one?" };
    persist({ ...session, characterCasting: { ...casting, messages: [...messages, reply], candidate: undefined, candidatePool: addToCandidatePool(candidatePool, candidate), generationFlow: { ...generationFlow, stage: "rejected" } } });
  }

  async function hireCandidate() {
    if (!session || !candidate) return;
    const target = characters.find((item) => item.id === generationFlow?.roleId) ?? characters.find((item) => !item.image);
    const hired: CastMember = target
      ? { ...target, image: candidate.image, storagePath: candidate.storagePath, source: candidate.source }
      : { id: uid(), name: "NEW CAST MEMBER", role: "ROLE TO DEFINE", description: candidate.description ?? "Selected during casting.", image: candidate.image, storagePath: candidate.storagePath, source: candidate.source };
    const hiredCast = target ? characters.map((item) => item.id === target.id ? hired : item) : [...characters, hired];
    const userPrompt: ChatMessage = { id: uid(), role: "user", content: `I hired the attached candidate for ${hired.role || "an undefined role"}. Confirm briefly that this role is cast and ask which role we cast next.` };
    const next = [...messages, userPrompt];
    const current: CastingSession = { ...session, characterCasting: { ...casting, messages: next, characters: hiredCast, candidate: undefined, pendingRoleMemberId: generationFlow?.roleId ? undefined : hired.id, generationFlow: undefined, candidatePool: candidatePool.filter((item) => candidateKey(item) !== candidateKey(candidate)) } };
    persist(current);
    setBusyMode("reply");
    try {
      const { reply } = await askAgent(current, next, false, [{ ...candidate, id: uid(), name: hired.name }]);
      persist({ ...current, characterCasting: { ...current.characterCasting, messages: [...next, reply] } });
    } catch (e) { setError(e instanceof Error ? e.message : "CASTING AGENT COULD NOT RESPOND."); }
    finally { setBusyMode(null); }
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

  function beginGeneration(content: string) {
    if (!session) return;
    const russian = /[А-Яа-яЁё]/.test(content);
    const userMessage: ChatMessage = { id: uid(), role: "user", content };
    const reply: ChatMessage = { id: uid(), role: "assistant", content: russian ? "На какую роль ищем актёра? Выберите роль из блокнота." : "Which role are we casting? Choose a role from the notebook." };
    setInput(""); setError("");
    persist({ ...session, characterCasting: { ...casting, messages: [...messages, userMessage, reply], generationFlow: { stage: "choose-role", russian } } });
  }

  async function selectGenerationRole(member: CastMember) {
    if (!session || busy) return;
    const russian = generationFlow?.russian ?? true;
    const roleLabel = member.role || member.name;
    const selected: ChatMessage = { id: uid(), role: "user", content: `${russian ? "РОЛЬ" : "ROLE"}: ${roleLabel}` };
    const nextMessages = [...messages, selected];
    const knowsRole = Boolean(member.description && !/Role added manually|added manually|role to cast/i.test(member.description));
    if (!knowsRole) {
      const reply: ChatMessage = { id: uid(), role: "assistant", content: russian ? "Эту роль я пока не знаю. Опишите возраст, внешность, телосложение и важные особенности." : "I do not know this role yet. Describe the age, appearance, build and defining features." };
      persist({ ...session, characterCasting: { ...casting, messages: [...nextMessages, reply], generationFlow: { stage: "describe", roleId: member.id, roleLabel, russian } } });
      return;
    }
    setBusyMode("reply"); setError("");
    try {
      const control: ChatMessage = { id: uid(), role: "user", content: `Casting only: propose a concise physical appearance for the role "${roleLabel}" using this known role description: ${member.description}. End by saying the candidate is ready to generate.` };
      const { reply } = await askAgent(session, [...nextMessages, control]);
      persist({ ...session, characterCasting: { ...casting, messages: [...nextMessages, reply], generationFlow: { stage: "ready", roleId: member.id, roleLabel, brief: `${roleLabel}. ${member.description}. ${reply.content}`, russian } } });
    } catch (e) { setError(e instanceof Error ? e.message : "CASTING AGENT COULD NOT RESPOND."); }
    finally { setBusyMode(null); }
  }

  async function generateActor() {
    if (!session || busy || !generationFlow?.brief) return;
    setBusyMode("generation"); setError("");
    try {
      const generated = await generateCandidate(generationFlow.brief, session);
      const reply: ChatMessage = { id: uid(), role: "assistant", content: generationFlow.russian ? "Кандидат готов. Он появился в блоке CAST слева. Нанимаем или отказываем?" : "The candidate is ready in the CAST tray. Hire or reject?" };
      persist({ ...session, characterCasting: { ...casting, messages: [...messages, reply], candidate: generated, generationFlow: { ...generationFlow, stage: "candidate" } } });
    } catch (e) { setError(e instanceof Error ? e.message : "CHARACTER COULD NOT BE GENERATED."); }
    finally { setBusyMode(null); }
  }

  function changeGenerationCriteria() {
    if (!session || !generationFlow) return;
    const reply: ChatMessage = { id: uid(), role: "assistant", content: generationFlow.russian ? "Что меняем во внешности кандидата? Опишите новые критерии." : "What should change in the candidate's appearance? Describe the new criteria." };
    persist({ ...session, characterCasting: { ...casting, messages: [...messages, reply], generationFlow: { ...generationFlow, stage: "describe" } } });
  }

  async function sendMessage() {
    const content = input.trim();
    if (!session || !content || busy) return;
    const wantsGeneration = /сгенер|созда[йт]|сделай.{0,24}(акт[её]р|персонаж|кандидат)|нов(ого|ый) (акт[её]р|персонаж|кандидат)|generate|new (actor|candidate|character)/i.test(content);
    if (!generationFlow && wantsGeneration) {
      beginGeneration(content);
      return;
    }
    setInput(""); setError(""); setBusyMode("reply");
    const userMessage: ChatMessage = { id: uid(), role: "user", content };
    const nextMessages = [...messages, userMessage];
    let current: CastingSession = { ...session, characterCasting: { ...casting, messages: nextMessages } };
    persist(current);
    try {
      if (generationFlow?.stage === "describe") {
        const control: ChatMessage = { id: uid(), role: "user", content: `Casting only: briefly state what actor is needed for the role "${generationFlow.roleLabel}" from the user's appearance criteria. End by saying the candidate is ready to generate.` };
        const { reply } = await askAgent(current, [...nextMessages, control]);
        persist({ ...current, characterCasting: { ...current.characterCasting, messages: [...nextMessages, reply], generationFlow: { ...generationFlow, stage: "ready", brief: `${generationFlow.roleLabel}. ${content}. ${reply.content}` } } });
        setCharacterAttachments([]);
        return;
      }
      const activeCandidateAttachment: CharacterAttachment[] = current.characterCasting?.candidate ? [{ ...current.characterCasting.candidate, id: uid(), name: "CURRENT CAST CANDIDATE" }] : [];
      const visuals = [...characterAttachments, ...activeCandidateAttachment].filter((item, index, all) => all.findIndex((candidateItem) => candidateItem.image === item.image) === index);
      const { reply, characters: found } = await askAgent(current, nextMessages, false, visuals);
      const currentCandidate = current.characterCasting?.candidate;
      let updatedCast = found;
      const pendingRoleId = current.characterCasting?.pendingRoleMemberId;
      if (pendingRoleId) {
        updatedCast = found.map((item) => item.id === pendingRoleId ? { ...item, role: content.slice(0, 80), name: item.name === "NEW CAST MEMBER" ? content.slice(0, 80) : item.name } : item);
        current = { ...current, characterCasting: { ...current.characterCasting, pendingRoleMemberId: undefined } };
      } else if (currentCandidate && /роль|герой|героин|персонаж|отец|мать|жена|муж|сын|дочь|главн/i.test(content)) {
        const target = found.find((item) => !item.image) ?? { id: uid(), name: content.slice(0, 40), role: content, description: "Cast during the session." };
        updatedCast = found.map((item) => item.id === target.id ? { ...item, image: currentCandidate.image, storagePath: currentCandidate.storagePath, source: currentCandidate.source } : item);
        if (!updatedCast.some((item) => item.id === target.id)) updatedCast.push({ ...target, image: currentCandidate.image, storagePath: currentCandidate.storagePath, source: currentCandidate.source });
        current = { ...current, characterCasting: { ...current.characterCasting, candidate: undefined, candidatePool: (current.characterCasting?.candidatePool ?? []).filter((item) => candidateKey(item) !== candidateKey(currentCandidate)) } };
      }
      persist({ ...current, characterCasting: { ...current.characterCasting, messages: [...nextMessages, reply], characters: updatedCast } });
      setCharacterAttachments([]);
    } catch (e) { setError(e instanceof Error ? e.message : "CASTING AGENT COULD NOT RESPOND."); }
    finally { setBusyMode(null); }
  }

  function removeCharacter(id: string) {
    if (!session) return;
    persist({ ...session, characterCasting: { ...casting, characters: characters.filter((item) => item.id !== id) } });
  }

  function addRole() {
    const role = newRoleDraft.trim();
    if (!session || !role) return;
    const member: CastMember = { id: uid(), name: "ROLE TO CAST", role, description: "Role added manually during casting." };
    persist({ ...session, characterCasting: { ...casting, characters: [...characters, member] } });
    setNewRoleDraft("");
    setAddingRole(false);
  }

  function saveRole(member: CastMember) {
    if (!session || !roleDraft.trim()) return;
    persist({ ...session, characterCasting: { ...casting, characters: characters.map((item) => item.id === member.id ? { ...item, role: roleDraft.trim() } : item) } });
    setEditingRoleId(""); setRoleDraft("");
  }

  if (!session) return <main className="min-h-screen bg-[#050505] text-white"><StudioSidebar /><div className="flex min-h-screen items-center justify-center text-xs font-black text-[#FFDF00]">OPENING CASTING ROOM...</div></main>;

  return <main className="min-h-screen bg-[#050505] px-4 pb-5 pt-20 text-white md:pl-[calc(var(--studio-sidebar-width,260px)+28px)] md:pt-5">
    <StudioSidebar /><WorkflowNav />
    <div className="mx-auto grid max-w-7xl gap-5 lg:grid-cols-[290px_minmax(0,1fr)]">
      <aside className="space-y-4">
        <button onClick={() => setPortfolioOpen(true)} className="w-full rounded-[22px] border border-[#FFDF00]/25 bg-[#FFDF00]/[.035] p-4 text-left"><div className="flex items-center gap-3"><Image src={specialist.portrait} alt="" width={58} height={58} className="h-14 w-14 rounded-[14px] object-cover object-top"/><div><p className="text-[8px] font-black tracking-[.14em] text-[#FFDF00]">CASTING LEAD</p><h2 className="mt-1 text-base font-black">{specialist.name}</h2><p className="mt-1 text-[8px] text-white/35">CHANGE SPECIALIST →</p></div></div></button>
        <button onClick={() => setPortfolioOpen(true)} className="w-full rounded-full border border-white/10 px-5 py-3 text-[9px] font-black hover:border-[#FFDF00]/40">OPEN PORTFOLIO / 20</button>
        <section className="max-h-[320px] overflow-y-auto rounded-[22px] border border-white/10 p-4"><div className="sticky top-0 z-10 bg-[#050505] pb-3"><div className="flex items-center justify-between"><p className="text-[9px] font-black tracking-[.14em] text-[#FFDF00]">CHARACTER NOTEBOOK</p><button title="Add a new role" onClick={() => setAddingRole((value) => !value)} className="text-lg text-[#FFDF00]">＋</button></div>{addingRole && <div className="mt-3 flex gap-2 rounded-xl border border-[#FFDF00]/25 bg-black p-2"><input autoFocus value={newRoleDraft} onChange={(event) => setNewRoleDraft(event.target.value)} onKeyDown={(event) => event.key === "Enter" && addRole()} placeholder="NEW ROLE" className="min-w-0 flex-1 bg-transparent px-2 text-[9px] outline-none placeholder:text-white/25"/><button onClick={addRole} disabled={!newRoleDraft.trim()} className="rounded-full bg-[#FFDF00] px-3 py-2 text-[8px] font-black text-black disabled:opacity-25">ADD</button></div>}</div>{characters.length ? <div className="space-y-2">{characters.map((member) => <article key={member.id} className="flex items-center gap-2 rounded-xl border border-white/8 p-2">{member.image ? <button title="Attach this character to the next message" onClick={() => attachCharacter(member)} className="relative shrink-0 rounded-full transition hover:ring-2 hover:ring-[#FFDF00]"><Image src={member.image} alt={member.name} width={40} height={40} unoptimized={member.image.startsWith("http")} className="h-10 w-10 rounded-full object-cover object-top"/><span className="absolute -bottom-1 -right-1 rounded-full bg-[#FFDF00] px-1 text-[8px] font-black text-black">＋</span></button> : <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/5 text-xs">?</div>}<div className="min-w-0 flex-1">{editingRoleId === member.id ? <div className="flex gap-1"><input autoFocus value={roleDraft} onChange={(event) => setRoleDraft(event.target.value)} onKeyDown={(event) => event.key === "Enter" && saveRole(member)} className="min-w-0 flex-1 rounded-md border border-[#FFDF00]/35 bg-black px-2 py-1 text-[8px] outline-none"/><button onClick={() => saveRole(member)} className="text-[8px] font-black text-[#FFDF00]">OK</button></div> : <><p className="truncate text-[9px] font-black">{member.name}</p><button onClick={() => { setEditingRoleId(member.id); setRoleDraft(member.role); }} className="flex max-w-full items-center gap-1 text-left text-[8px] text-white/35 hover:text-[#FFDF00]"><span className="truncate">{member.role || "ROLE TO CAST"}</span><span>✎</span></button></>}</div><button title="Delete character" onClick={() => removeCharacter(member.id)} className="px-1 text-white/25 hover:text-red-300">×</button></article>)}</div> : <p className="text-[10px] leading-5 text-white/30">The specialist is reading the project document.</p>}</section>
        <section className="rounded-[22px] border border-white/10 p-4"><div className="flex items-center justify-between"><div><p className="text-[9px] font-black tracking-[.14em] text-[#FFDF00]">CAST</p><p className="mt-1 text-[7px] text-white/25">CANDIDATE TRAY · {candidatePool.length}</p></div><button onClick={() => setCandidatePoolOpen((value) => !value)} className={`text-lg ${candidatePoolOpen ? "text-white" : "text-[#FFDF00]"}`}>{candidatePoolOpen ? "−" : "＋"}</button></div>{candidatePoolOpen && <div className="mt-3 grid max-h-52 grid-cols-3 gap-0 overflow-y-auto">{candidatePool.length ? candidatePool.map((item) => <button key={candidateKey(item)} onClick={() => { if (!session) return; persist({ ...session, characterCasting: { ...casting, candidate: item } }); setCandidatePoolOpen(false); }} className={`relative aspect-[9/16] overflow-hidden border ${candidate && candidateKey(candidate) === candidateKey(item) ? "z-10 border-[#FFDF00] shadow-[0_0_18px_rgba(255,223,0,.35)]" : "border-black"}`}><Image src={item.image} alt="Saved casting candidate" fill sizes="90px" unoptimized={item.image.startsWith("http")} className="object-cover object-top"/></button>) : <p className="col-span-3 py-4 text-[8px] leading-4 text-white/25">Generated and rejected candidates will wait here.</p>}</div>}{candidate ? <><div className="relative mt-3"><Image src={candidate.image} alt="Candidate" width={180} height={320} unoptimized={candidate.image.startsWith("http")} className="aspect-[9/16] max-h-64 w-full rounded-xl object-cover object-top"/><span className="absolute bottom-2 left-2 rounded-full bg-black/75 px-3 py-1 text-[7px] font-black text-[#FFDF00]">ATTACHED TO AGENT</span></div><div className="mt-3 grid grid-cols-2 gap-2"><button onClick={rejectCandidate} className="rounded-full border border-white/10 py-2 text-[8px] font-black">REJECT</button><button onClick={() => void hireCandidate()} className="rounded-full bg-[#FFDF00] py-2 text-[8px] font-black text-black">HIRE</button></div></> : <p className="mt-3 text-[9px] leading-5 text-white/30">Generate a new candidate or select one from the specialist portfolio.</p>}</section>
      </aside>
      <section className="flex h-[calc(100dvh-105px)] min-h-[620px] flex-col overflow-hidden rounded-[28px] border border-white/10 bg-[#0A0A0A]">
        <header className="shrink-0 border-b border-white/10 p-5"><p className="text-[9px] font-black tracking-[.18em] text-[#FFDF00]">CHARACTER DEVELOPMENT</p><h1 className="mt-2 text-xl font-black">CAST THE PEOPLE WHO CARRY THE STORY.</h1></header>
        <div className="min-h-0 flex-1 overflow-y-auto p-5 sm:p-7"><div className="space-y-4">{messages.map((message) => message.role === "assistant" ? <article key={message.id} className="flex gap-3"><Image src={specialist.portrait} alt="" width={40} height={40} className="h-10 w-10 rounded-full object-cover"/><div className="max-w-[82%] rounded-[20px] border border-[#FFDF00]/20 bg-[#17150b] p-4 text-sm leading-6 text-white/75"><p className="mb-2 text-[8px] font-black tracking-[.12em] text-[#FFDF00]">{specialist.name}</p>{message.content}</div></article> : <article key={message.id} className="ml-auto max-w-[80%] rounded-[20px] bg-[#FFDF00] p-4 text-sm leading-6 text-black">{message.content}</article>)}
          {generationFlow?.stage === "choose-role" && <div className="ml-[52px] max-w-[82%] rounded-[20px] border border-[#FFDF00]/25 bg-[#FFDF00]/[.035] p-4"><p className="mb-3 text-[8px] font-black tracking-[.14em] text-[#FFDF00]">CHOOSE ROLE FROM NOTEBOOK</p><div className="flex flex-wrap gap-2">{characters.map((member) => <button key={member.id} onClick={() => void selectGenerationRole(member)} disabled={busy} className="rounded-full border border-white/12 px-4 py-2 text-[9px] font-black text-white/70 transition hover:border-[#FFDF00] hover:text-[#FFDF00] disabled:opacity-30">{member.role || member.name}</button>)}</div>{characters.length === 0 && <p className="text-[9px] text-white/35">ADD A ROLE TO THE CHARACTER NOTEBOOK FIRST.</p>}</div>}
          {generationFlow?.stage === "ready" && <div className="ml-[52px] max-w-[82%] rounded-[20px] border border-[#FFDF00]/25 p-3"><button onClick={() => void generateActor()} disabled={busy} className="w-full rounded-full bg-[#FFDF00] px-6 py-4 text-[9px] font-black text-black disabled:opacity-30">GENERATE ACTOR</button></div>}
          {generationFlow?.stage === "rejected" && <div className="ml-[52px] grid max-w-[82%] grid-cols-2 gap-2 rounded-[20px] border border-white/10 p-3"><button onClick={changeGenerationCriteria} disabled={busy} className="rounded-full border border-white/15 px-4 py-3 text-[8px] font-black text-white/60 disabled:opacity-30">CHANGE CRITERIA</button><button onClick={() => void generateActor()} disabled={busy || !generationFlow.brief} className="rounded-full bg-[#FFDF00] px-4 py-3 text-[8px] font-black text-black disabled:opacity-30">GENERATE AGAIN</button></div>}
          {busy && <div className="flex items-center gap-3 text-[9px] text-white/35"><span className="h-3 w-3 animate-spin rounded-full border-2 border-[#FFDF00]/25 border-t-[#FFDF00]"/>{specialist.name} {busyMode === "summary" ? "IS STUDYING THE SUMMARY..." : busyMode === "generation" ? "IS GENERATING AN ACTOR..." : "IS THINKING..."}</div>}<div ref={chatEnd}/></div></div>
        {error && <div className="mx-4 mb-2 rounded-xl border border-red-400/20 bg-red-500/5 p-3 text-[9px] text-red-200">{error}</div>}
        <footer className="shrink-0 border-t border-white/10 p-4"><div className="mb-2 flex flex-wrap items-center justify-between gap-2"><div className="flex gap-2"><button onClick={() => fileRef.current?.click()} className="rounded-full border border-white/10 px-4 py-2 text-[8px] font-black">＋ ADD REFERENCES</button><button onClick={() => { setInput(""); setAttachments([]); setCharacterAttachments([]); }} className="rounded-full border border-white/10 px-4 py-2 text-[8px] font-black text-white/45">RESET</button></div><div className="flex rounded-full border border-white/10 p-1"><button onClick={() => setProviderChoice("anthropic")} className={`rounded-full px-4 py-2 text-[8px] font-black ${provider === "anthropic" ? "bg-[#FFDF00] text-black" : "text-white/35"}`}>CLAUDE</button><button onClick={() => setProviderChoice("openai")} className={`rounded-full px-4 py-2 text-[8px] font-black ${provider === "openai" ? "bg-[#FFDF00] text-black" : "text-white/35"}`}>GPT</button></div></div><input ref={fileRef} type="file" multiple className="hidden" onChange={(event) => setAttachments(Array.from(event.target.files ?? []).map((file) => ({ name: file.name })))}/>{(attachments.length > 0 || characterAttachments.length > 0) && <div className="mb-2 flex flex-wrap gap-2">{characterAttachments.map((item) => <button key={item.id} onClick={() => setCharacterAttachments((current) => current.filter((saved) => saved.id !== item.id))} className="flex items-center gap-2 rounded-full border border-[#FFDF00]/35 bg-[#FFDF00]/5 py-1 pl-1 pr-3 text-[8px] font-black text-[#FFDF00]"><Image src={item.image} alt="" width={28} height={28} unoptimized={item.image.startsWith("http")} className="h-7 w-7 rounded-full object-cover object-top"/><span>{item.name}</span><span>×</span></button>)}{attachments.map((item) => <span key={item.name} className="rounded-full border border-white/10 px-3 py-2 text-[8px] text-white/35">{item.name}</span>)}</div>}<div className="flex items-end gap-3 rounded-[20px] border border-white/10 bg-black p-3"><textarea value={input} onChange={(event) => setInput(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void sendMessage(); } }} placeholder="DIRECT THE CASTING..." className="min-h-12 flex-1 resize-none bg-transparent p-3 text-sm outline-none"/><button onClick={() => void sendMessage()} disabled={!input.trim() || busy} className="rounded-full bg-[#FFDF00] px-6 py-4 text-[9px] font-black text-black disabled:opacity-25">SEND</button></div></footer>
      </section>
    </div>
    {portfolioOpen && <div className="fixed inset-0 z-[10000] bg-black/90 p-3 backdrop-blur-md"><section className="mx-auto flex h-full max-w-6xl flex-col overflow-hidden rounded-[26px] border border-white/10 bg-[#090909]"><header className="flex shrink-0 items-center justify-between p-5"><div><p className="text-[9px] font-black text-[#FFDF00]">{specialist.name} / COMPANY</p><h2 className="mt-2 text-xl font-black">CHOOSE FROM {specialist.characterExamples.length} CASTING PORTRAITS.</h2></div><button onClick={() => { setPortfolioOpen(false); setPreview(""); }} className="text-3xl text-white/45">×</button></header><div className="min-h-0 flex-1 overflow-y-auto bg-black"><div className="grid min-h-full grid-cols-3 gap-0 sm:h-full sm:grid-cols-5 sm:grid-rows-4">{specialist.characterExamples.map((character) => { const selected = preview === character.image; return <button key={character.image} onClick={() => setPreview(character.image)} className={`group relative min-h-0 overflow-hidden border-0 bg-black transition ${selected ? "z-10 shadow-[0_0_34px_8px_rgba(255,223,0,.5)] ring-2 ring-inset ring-[#FFDF00]" : ""}`}><Image src={character.image} alt={character.alt} fill sizes="20vw" className="object-cover object-top"/><span className={`absolute inset-x-0 bottom-0 z-10 bg-[#FFDF00] py-3 text-[9px] font-black text-black transition-transform duration-200 ${selected ? "translate-y-0" : "translate-y-full"}`} onClick={(event) => { event.stopPropagation(); choosePortfolioCharacter(character.image); }}>SELECT</span></button>; })}</div></div></section></div>}
  </main>;
}
