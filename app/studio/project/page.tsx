"use client";

import Link from "next/link";
import Image from "next/image";
import { currentAIProvider } from "../AIProviderSwitch";
import { useEffect, useState } from "react";
import { authenticatedFetch } from "../../../lib/authenticated-fetch";
import StudioSidebar from "../../components/StudioSidebar";
import WorkflowNav from "../../components/WorkflowNav";
import { getCachedProjects, saveProjects } from "../../../lib/project-store";
import { platformConfirm } from "../../../lib/platform-dialog";
import { characterCastingSpecialists, type CharacterCastingSpecialist } from "../../../lib/character-casting";

type ProjectSection = { id: string; title: string; summary: string; points: string[]; ratings?: { secondDirector: number; screenwriter: number; reason: string } };
type OpenQuestion = { id: string; label: string; question: string };
type ProjectDocument = { title: string; logline: string; sections: ProjectSection[]; openQuestions?: OpenQuestion[] };
type ProjectSession = {
  id?: string;
  projectDocument?: ProjectDocument;
  notes?: string;
  notebook?: Array<{ author: string; title: string; detail: string; accepted: boolean }>;
  messages?: Array<{ role: string; content: string; speaker?: string }>;
  secondDirector: { name: string };
  screenwriter: { name: string };
  characterCastingSpecialist?: CharacterCastingSpecialist;
  draftQuestion?: string;
};

function isUnresolvedPoint(point: string) {
  return /\?|не определ|не решен|не выбран|нужно\s+(решить|выбрать|определить|уточнить)|следует\s+(решить|выбрать|определить|уточнить)|предстоит\s+(решить|выбрать|определить)|требуется\s+(решить|выбрать|определить|уточнить)|остается\s+(решить|выбрать|определить)|пока нет|отсутствует/i.test(point);
}

export default function ProjectPage() {
  const [session, setSession] = useState<ProjectSession | null>(null);
  const [activeSection, setActiveSection] = useState("");
  const [resolvingQuestion, setResolvingQuestion] = useState("");
  const [error, setError] = useState("");
  const [editingPoint, setEditingPoint] = useState("");
  const [editingValue, setEditingValue] = useState("");
  const [highlightedPoints, setHighlightedPoints] = useState<string[]>([]);
  const [selectedDepartments, setSelectedDepartments] = useState<string[]>([]);
  const [specialistRosterOpen, setSpecialistRosterOpen] = useState(false);
  const [activeSpecialist, setActiveSpecialist] = useState<CharacterCastingSpecialist>(characterCastingSpecialists[0]);
  const [activeUnresolvedPoint, setActiveUnresolvedPoint] = useState("");

  useEffect(() => {
    const stored = sessionStorage.getItem("carabasaiCreativeSession");
    if (!stored) return;
    const restored = JSON.parse(stored) as ProjectSession;
    // This document is restored once from browser-only session storage.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSession(restored);
    setActiveSection(restored.projectDocument?.sections[0]?.id ?? "");
    if (restored.characterCastingSpecialist) {
      setActiveSpecialist(restored.characterCastingSpecialist);
      setSelectedDepartments(["CHARACTER CASTING"]);
    }
  }, []);

  if (!session?.projectDocument) {
    return <main className="min-h-screen bg-[#050505] px-4 py-5 pt-20 text-white md:pl-[calc(var(--studio-sidebar-width,260px)+32px)] md:pt-5"><StudioSidebar /><WorkflowNav /><div className="flex min-h-[70vh] items-center justify-center p-6"><div className="text-center"><p className="text-xs font-black text-[#FFDF00]">NO PROJECT DOCUMENT</p><Link href="/studio/creative-room" className="mt-6 inline-flex rounded-full border border-white/15 px-6 py-3 text-xs font-black">RETURN TO CREATIVE ROOM</Link></div></div></main>;
  }

  const document = session.projectDocument;
  const section = document.sections.find((item) => item.id === activeSection) ?? document.sections[0];

  function persistDocument(nextDocument: ProjectDocument) {
    if (!session) return;
    const updated: ProjectSession = { ...session, projectDocument: nextDocument };
    sessionStorage.setItem("carabasaiCreativeSession", JSON.stringify(updated));
    const history = getCachedProjects<ProjectSession>().filter((item) => item.id !== session.id);
    saveProjects([updated, ...history].slice(0, 20));
    setSession(updated);
  }

  function hireCharacterCastingSpecialist() {
    if (!session) return;
    const updated: ProjectSession = { ...session, characterCastingSpecialist: activeSpecialist };
    sessionStorage.setItem("carabasaiCreativeSession", JSON.stringify(updated));
    const history = getCachedProjects<ProjectSession>().filter((item) => item.id !== session.id);
    saveProjects([updated, ...history].slice(0, 20));
    setSession(updated);
    setSelectedDepartments(["CHARACTER CASTING"]);
    setSpecialistRosterOpen(false);
  }

  function savePoint(sectionId: string, pointIndex: number) {
    if (!editingValue.trim()) return;
    const revised = {
      ...document,
      sections: document.sections.map((item) => item.id === sectionId ? { ...item, points: item.points.map((point, index) => index === pointIndex ? editingValue.trim() : point) } : item),
    };
    persistDocument(revised);
    setEditingPoint("");
  }

  function deletePoint(sectionId: string, pointIndex: number) {
    const revised = {
      ...document,
      sections: document.sections.map((item) =>
        item.id === sectionId
          ? { ...item, points: item.points.filter((_, index) => index !== pointIndex) }
          : item
      ),
    };
    persistDocument(revised);
    setHighlightedPoints((current) =>
      current.filter((item) => item !== section.points[pointIndex])
    );
  }

  function askTeam(question: OpenQuestion) {
    if (!session) return;
    const updated = { ...session, draftQuestion: question.question };
    sessionStorage.setItem("carabasaiCreativeSession", JSON.stringify(updated));
    window.location.assign("/studio/creative-room");
  }

  async function letTeamDecide(question: OpenQuestion) {
    if (!session) return;
    const activeSession = session;
    setResolvingQuestion(question.id);
    setError("");
    try {
      const response = await authenticatedFetch("/api/project-document", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: currentAIProvider(),
          brief: activeSession.notes,
          notes: activeSession.notebook,
          messages: activeSession.messages,
          team: { secondDirector: activeSession.secondDirector.name, screenwriter: activeSession.screenwriter.name },
          existingDocument: document,
          teamDecisionQuestion: question.question,
          skipDiscussion: !activeSession.notebook?.some((note) => note.accepted),
        }),
      });
      const revised = await response.json();
      if (!response.ok) throw new Error(revised.error ?? "COULD NOT RESOLVE QUESTION.");
      revised.openQuestions = (revised.openQuestions ?? []).filter(
        (item: OpenQuestion) =>
          item.id !== question.id &&
          item.question.trim().toLowerCase() !== question.question.trim().toLowerCase()
      );
      const previousPoints = new Set(document.sections.flatMap((item) => item.points));
      const newPoints = (revised.sections as ProjectSection[]).flatMap((item) => item.points.filter((point) => !previousPoints.has(point)));
      if (newPoints.length === 0) {
        throw new Error("THE TEAM DID NOT PRODUCE A CONCRETE DECISION. TRY AGAIN.");
      }
      const changedSection = (revised.sections as ProjectSection[]).find((item) => item.points.some((point) => newPoints.includes(point)));
      const updated: ProjectSession = { ...activeSession, projectDocument: revised };
      sessionStorage.setItem("carabasaiCreativeSession", JSON.stringify(updated));
      const history = getCachedProjects<ProjectSession>().filter((item) => item.id !== activeSession.id);
      saveProjects([updated, ...history].slice(0, 20));
      setSession(updated);
      setHighlightedPoints(newPoints);
      setActiveSection(changedSection?.id ?? revised.sections[0]?.id ?? "");
    } catch (decisionError) {
      setError(decisionError instanceof Error ? decisionError.message : "COULD NOT RESOLVE QUESTION.");
    } finally {
      setResolvingQuestion("");
    }
  }

  async function letTeamDecideAll() {
    if (!session || !document.openQuestions?.length) return;
    const activeSession = session;
    setResolvingQuestion("all");
    setError("");
    try {
      const response = await authenticatedFetch("/api/project-document", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: currentAIProvider(),
          brief: activeSession.notes,
          notes: activeSession.notebook,
          messages: activeSession.messages,
          team: { secondDirector: activeSession.secondDirector.name, screenwriter: activeSession.screenwriter.name },
          existingDocument: document,
          teamDecisionQuestion: `RESOLVE ALL:\n${document.openQuestions.map((question) => `- ${question.question}`).join("\n")}`,
          skipDiscussion: !activeSession.notebook?.some((note) => note.accepted),
        }),
      });
      const revised = await response.json();
      if (!response.ok) throw new Error(revised.error ?? "COULD NOT RESOLVE QUESTIONS.");
      revised.openQuestions = [];
      const previousPoints = new Set(document.sections.flatMap((item) => item.points));
      const newPoints = (revised.sections as ProjectSection[]).flatMap((item) => item.points.filter((point) => !previousPoints.has(point)));
      if (newPoints.length === 0) throw new Error("THE TEAM DID NOT PRODUCE CONCRETE DECISIONS. TRY AGAIN.");
      const changedSection = (revised.sections as ProjectSection[]).find((item) => item.points.some((point) => newPoints.includes(point)));
      const updated: ProjectSession = { ...activeSession, projectDocument: revised };
      sessionStorage.setItem("carabasaiCreativeSession", JSON.stringify(updated));
      const history = getCachedProjects<ProjectSession>().filter((item) => item.id !== activeSession.id);
      saveProjects([updated, ...history].slice(0, 20));
      setSession(updated);
      setHighlightedPoints(newPoints);
      setActiveSection(changedSection?.id ?? revised.sections[0]?.id ?? "");
    } catch (decisionError) {
      setError(decisionError instanceof Error ? decisionError.message : "COULD NOT RESOLVE QUESTIONS.");
    } finally {
      setResolvingQuestion("");
    }
  }

  return (
    <main className="min-h-screen bg-[#050505] px-4 py-5 pt-20 text-white sm:px-8 md:pl-[calc(var(--studio-sidebar-width,260px)+32px)] md:pt-5 lg:pr-12">
      <StudioSidebar />
      <WorkflowNav />
      <div className="mx-auto grid max-w-7xl gap-6 lg:grid-cols-[1fr_340px]">
        <section className="overflow-hidden rounded-[28px] border border-white/10 bg-white/[0.025]">
          <div className="p-6 sm:p-8"><p className="text-[10px] font-black tracking-[0.16em] text-[#FFDF00]">DIRECTOR + SCREENWRITER DOCUMENT</p><h1 className="mt-3 text-3xl font-black tracking-[-0.04em] sm:text-5xl">{document.title}</h1><p className="mt-5 max-w-3xl text-sm leading-7 text-white/55">{document.logline}</p><p className="mt-5 text-[9px] text-white/25">{session.secondDirector.name} + {session.screenwriter.name}</p></div>
          <div className="flex gap-2 overflow-x-auto border-y border-white/10 p-3 sm:px-6">
            {document.sections.map((item) => <button key={item.id} type="button" onClick={() => setActiveSection(item.id)} className={`shrink-0 rounded-full px-4 py-2 text-[9px] font-black tracking-[0.1em] ${item.id === section.id ? "bg-[#FFDF00] text-black" : "border border-white/10 text-white/40"}`}>{item.title}</button>)}
          </div>
          <div className="min-h-[360px] p-6 sm:p-8">
            <h2 className="text-2xl font-black">{section.title}</h2>
            {section.ratings && <div className="mt-5 rounded-[18px] border border-white/10 bg-black/20 p-4"><div className="flex flex-wrap gap-5 text-[10px] font-black"><span>{session.secondDirector.name}: <span className="text-[#FFDF00]">{"★".repeat(section.ratings.secondDirector)}{"☆".repeat(5 - section.ratings.secondDirector)}</span></span><span>{session.screenwriter.name}: <span className="text-[#FFDF00]">{"★".repeat(section.ratings.screenwriter)}{"☆".repeat(5 - section.ratings.screenwriter)}</span></span></div><p className="mt-3 text-[10px] leading-5 text-white/35">{section.ratings.reason}</p></div>}
            <p className="mt-4 max-w-3xl text-sm leading-7 text-white/50">{section.summary}</p>
            <ul className="mt-7 space-y-4">{section.points.map((point, pointIndex) => {
              const pointId = `${section.id}:${pointIndex}`;
              const unresolved = isUnresolvedPoint(point);
              return <li key={pointId} className={`flex flex-wrap items-start gap-3 rounded-[12px] px-2 py-1 text-sm leading-6 ${highlightedPoints.includes(point) ? "bg-[#FFDF00]/5 text-[#FFDF00]" : "text-white/75"}`}><button type="button" onClick={() => unresolved && setActiveUnresolvedPoint((current) => current === pointId ? "" : pointId)} className={unresolved ? "flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-red-400/15 text-xs font-black text-red-300" : "text-[#FFDF00]"} aria-label={unresolved ? "Resolve this point" : "Approved point"}>{unresolved ? "!" : "✓"}</button>{editingPoint === pointId ? <input value={editingValue} onChange={(event) => setEditingValue(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") savePoint(section.id, pointIndex); if (event.key === "Escape") setEditingPoint(""); }} autoFocus className="min-w-0 flex-1 rounded-lg border border-[#FFDF00]/25 bg-black/30 px-2 py-1 text-sm text-white outline-none" /> : <span className="min-w-0 flex-1">{point}</span>}<button type="button" onClick={() => editingPoint === pointId ? savePoint(section.id, pointIndex) : (setEditingPoint(pointId), setEditingValue(point))} className="shrink-0 text-xs text-white/25 hover:text-[#FFDF00]">{editingPoint === pointId ? "✓" : "✎"}</button><button type="button" onClick={() => void platformConfirm({ eyebrow: "PROJECT DOCUMENT", title: "DELETE KEY POINT?", message: "This point will be removed from the current project document.", confirmLabel: "DELETE POINT", tone: "danger" }).then((confirmed) => { if (confirmed) deletePoint(section.id, pointIndex); })} className="shrink-0 text-sm text-white/15 hover:text-red-300" aria-label="Delete point">×</button>{unresolved && activeUnresolvedPoint === pointId && <div className="ml-8 w-full"><button type="button" onClick={() => askTeam({ id: pointId, label: section.title, question: `Помогите принять конкретное решение по пункту: ${point}` })} className="rounded-full border border-red-300/20 px-4 py-2 text-[8px] font-black text-red-200">ASK THE TEAM</button></div>}</li>;
            })}</ul>
          </div>
        </section>

        <aside className="space-y-5">
          {(document.openQuestions?.length ?? 0) > 0 && <section className="rounded-[28px] border border-[#FFDF00]/15 bg-[#FFDF00]/[0.025] p-5"><div className="flex items-center justify-between gap-3"><p className="text-[10px] font-black tracking-[0.16em] text-[#FFDF00]">UNRESOLVED KEY POINTS</p><button type="button" onClick={() => void letTeamDecideAll()} disabled={Boolean(resolvingQuestion)} className="rounded-full bg-[#FFDF00] px-3 py-2 text-[8px] font-black text-black disabled:opacity-30">{resolvingQuestion === "all" ? "DECIDING ALL..." : "LET TEAM DECIDE ALL"}</button></div><div className="mt-4 space-y-3">{document.openQuestions?.map((question) => <div key={question.id} className="rounded-[16px] border border-white/10 bg-black/20 p-4"><p className="text-[9px] font-black text-white/40">{question.label}</p><p className="mt-2 text-xs leading-5 text-white/70">{question.question}</p><div className="mt-4 grid grid-cols-2 gap-2"><button type="button" onClick={() => askTeam(question)} className="rounded-full border border-white/10 px-3 py-2 text-[8px] font-black text-white/55">ASK THE TEAM</button><button type="button" onClick={() => void letTeamDecide(question)} disabled={Boolean(resolvingQuestion)} className="rounded-full bg-[#FFDF00] px-3 py-2 text-[8px] font-black text-black disabled:opacity-30">{resolvingQuestion === question.id ? "DECIDING..." : "LET TEAM DECIDE"}</button></div></div>)}</div>{error && <p className="mt-4 text-[9px] text-red-300">{error}</p>}</section>}
          <section className="rounded-[28px] border border-white/10 bg-white/[0.025] p-5"><p className="text-[10px] font-black tracking-[0.16em] text-[#FFDF00]">NEXT CREW STAGE</p><h2 className="mt-3 text-2xl font-black">CHARACTER CASTING</h2><p className="mt-4 text-xs leading-6 text-white/35">Choose the visual casting eye that will define every generated face and body before costume design begins.</p><button type="button" onClick={() => setSpecialistRosterOpen(true)} className={`mt-6 flex min-h-44 w-full flex-col justify-between overflow-hidden rounded-[20px] border text-left transition ${session.characterCastingSpecialist ? "border-[#FFDF00]/45 bg-[#FFDF00]/5" : "border-white/10 bg-black/20 hover:border-[#FFDF00]/35"}`}><div className="flex min-h-36"><div className="relative w-28 shrink-0 overflow-hidden bg-white/5"><Image src={session.characterCastingSpecialist?.portrait ?? activeSpecialist.portrait} alt="" fill sizes="112px" className="object-cover object-top" /></div><div className="p-5"><p className="text-xs font-black text-white/80">{session.characterCastingSpecialist?.name ?? "CHOOSE CHARACTER CASTING LEAD"}</p><p className="mt-2 text-[9px] font-black tracking-[0.08em] text-[#FFDF00]/70">{session.characterCastingSpecialist?.specialty ?? "FACE / BODY / PHYSICAL PRESENCE"}</p><p className="mt-3 text-[10px] leading-5 text-white/35">{session.characterCastingSpecialist?.biography ?? "Open the roster and choose the visual method that will shape all subsequent character generations."}</p></div></div><p className="px-5 pb-5 text-[9px] font-black text-[#FFDF00]">{session.characterCastingSpecialist ? "CHANGE SPECIALIST →" : "OPEN SPECIALIST ROSTER +"}</p></button><div className="mt-6 flex justify-end"><button type="button" disabled={selectedDepartments.length !== 1} className="rounded-full bg-[#FFDF00] px-6 py-3 text-[10px] font-black text-black disabled:cursor-not-allowed disabled:opacity-20">NEXT →</button></div></section>
        </aside>
      </div>
      {specialistRosterOpen && (
        <div className="fixed inset-0 z-[10000] flex items-end justify-center bg-black/85 p-0 backdrop-blur-md sm:p-3 lg:items-center lg:p-6" role="dialog" aria-modal="true" aria-label="Character casting specialist roster">
          <div aria-hidden="true" onClick={() => setSpecialistRosterOpen(false)} className="absolute inset-0 cursor-pointer" />
          <section className="relative z-10 flex max-h-[100dvh] w-full max-w-7xl flex-col overflow-hidden rounded-t-[28px] border border-white/10 bg-[#0A0A0A] sm:max-h-[calc(100dvh-24px)] lg:max-h-[92vh] lg:rounded-[30px]">
            <header className="flex shrink-0 items-center justify-between border-b border-white/10 bg-[#0A0A0A] px-4 py-4 sm:px-8">
              <div className="pr-4">
                <p className="text-[10px] font-black uppercase tracking-[0.2em] text-[#FFDF00] sm:text-[11px]">CHARACTER CASTING ROSTER</p>
                <h2 className="mt-2 text-base font-black uppercase sm:text-2xl">CHOOSE THE EYE THAT CASTS YOUR CHARACTERS.</h2>
              </div>
              <button type="button" onClick={() => setSpecialistRosterOpen(false)} className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-white/15 text-2xl text-white/70" aria-label="Close roster">×</button>
            </header>

            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
              <div className="border-b border-white/10 p-3 sm:p-4">
                <div className="flex gap-3 overflow-x-auto pb-2">
                  {characterCastingSpecialists.map((specialist) => {
                    const isActive = activeSpecialist.id === specialist.id;
                    return <button key={specialist.id} type="button" onClick={() => setActiveSpecialist(specialist)} className={`flex min-w-[230px] items-center gap-3 rounded-[18px] border p-3 text-left sm:min-w-[260px] ${isActive ? "border-[#FFDF00] bg-[#FFDF00]/10" : "border-white/10 bg-white/[0.02]"}`}><Image src={specialist.portrait} alt="" width={56} height={56} className="h-14 w-14 shrink-0 rounded-[14px] border border-white/10 object-cover object-top" /><div><p className={`text-sm font-black uppercase ${isActive ? "text-[#FFDF00]" : "text-white"}`}>{specialist.name}</p><p className="mt-1 text-[10px] uppercase leading-4 text-white/40">{specialist.specialty}</p></div></button>;
                  })}
                </div>
              </div>

              <div className="grid lg:grid-cols-[minmax(340px,0.85fr)_1.15fr]">
                <div className="relative aspect-square w-full overflow-hidden bg-[radial-gradient(circle_at_50%_35%,#32301b_0%,#15140d_34%,#080808_70%)]">
                  <Image src={activeSpecialist.portrait} alt={activeSpecialist.name} fill sizes="(min-width: 1024px) 42vw, 100vw" className="object-cover object-top" />
                  <div className="absolute inset-0 bg-gradient-to-t from-black via-transparent to-transparent" />
                  <div className="absolute bottom-0 left-0 right-0 p-5 sm:p-8"><p className="text-[10px] font-black uppercase tracking-[0.2em] text-[#FFDF00] sm:text-xs">CHARACTER CASTING LEAD · {activeSpecialist.rosterCode}</p><h3 className="mt-2 text-3xl font-black uppercase tracking-[-0.05em] sm:text-5xl">{activeSpecialist.name}</h3><p className="mt-2 text-xs font-black uppercase tracking-[0.1em] text-white/60 sm:text-sm">{activeSpecialist.specialty}</p></div>
                </div>

                <div className="flex min-h-[620px] flex-col p-5 sm:p-8">
                  <blockquote className="text-xl font-black leading-tight tracking-[-0.03em] text-[#FFDF00] sm:text-3xl">{activeSpecialist.quote}</blockquote>
                  <div className="mt-5 rounded-[18px] border border-[#FFDF00]/20 bg-[#FFDF00]/5 p-4"><p className="text-[9px] font-black uppercase tracking-[0.16em] text-[#FFDF00]">SIGNATURE MOVE</p><p className="mt-2 text-sm leading-6 text-white/80">⚡ {activeSpecialist.signature}</p></div>
                  <p className="mt-5 text-sm leading-6 text-white/55">{activeSpecialist.biography}</p>
                  <p className="mt-3 text-[10px] font-black uppercase tracking-[0.1em] text-white/35"><span className="text-[#FFDF00]">INSPIRED BY</span> · {activeSpecialist.inspiredBy}</p>
                  <div className="mt-4 flex flex-wrap gap-2">{activeSpecialist.tags.map((tag) => <span key={tag} className="rounded-full border border-white/10 bg-white/[0.035] px-3 py-1.5 text-[8px] font-black uppercase tracking-[0.08em] text-white/45">{tag}</span>)}</div>
                  <div className="mt-5 grid gap-3 text-xs sm:grid-cols-2"><p className="rounded-[14px] border border-white/8 p-3 leading-5 text-white/55"><span className="mr-2 font-black uppercase text-[#FFDF00]">BEST FOR</span>{activeSpecialist.bestFor}</p><p className="rounded-[14px] border border-white/8 p-3 leading-5 text-white/45"><span className="mr-2 font-black uppercase text-white/25">NOT FOR</span>{activeSpecialist.notFor}</p></div>
                  <div className="mt-6"><div className="flex items-end justify-between"><p className="text-[10px] font-black uppercase tracking-[0.18em] text-white/35">CHARACTER STATS</p><p className="text-[8px] uppercase text-white/20">0–10</p></div><div className="mt-3 space-y-3">{activeSpecialist.stats.map((stat) => <div key={stat.label} className="grid grid-cols-[116px_1fr_24px] items-center gap-3"><span className="text-[9px] font-black uppercase tracking-[0.06em] text-white/50">{stat.label}</span><div className="h-1.5 overflow-hidden rounded-full bg-white/10"><div className="h-full rounded-full bg-[#FFDF00]" style={{ width: `${stat.value * 10}%` }} /></div><span className="text-right text-[9px] font-black text-white/60">{stat.value}</span></div>)}</div></div>
                  <div className="mt-7"><div className="flex items-end justify-between"><p className="text-[10px] font-black uppercase tracking-[0.18em] text-white/35">CASTING SAMPLES</p><p className="text-[8px] uppercase text-white/20">FACE + BODY · BEFORE COSTUME</p></div><div className="mt-3 grid grid-cols-4 gap-2">{activeSpecialist.characterExamples.map((example) => <div key={example.image} className="relative aspect-square overflow-hidden rounded-[14px] border border-white/10 bg-white/[0.03]"><Image src={example.image} alt={example.alt} fill sizes="(min-width: 1024px) 12vw, 25vw" className="object-cover object-top transition duration-200 hover:scale-105" /></div>)}</div></div>
                  <div className="mt-6"><p className="text-[10px] font-black uppercase tracking-[0.18em] text-white/35">REFERENCE WORKS</p><div className="mt-3 flex flex-wrap gap-2">{activeSpecialist.referenceWorks.map((work) => <span key={work.title} className="rounded-full border border-white/10 px-3 py-2 text-[9px] font-bold text-white/45">{work.title} · {work.year}</span>)}</div></div>
                </div>
              </div>
            </div>

            <footer className="flex shrink-0 flex-col gap-3 border-t border-white/10 bg-[#0A0A0A] px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-8"><p className="text-[9px] uppercase leading-5 text-white/30 sm:text-[10px]">YOU REMAIN THE DIRECTOR. THIS PERSON BRINGS A DISTINCT CASTING EYE TO YOUR PROJECT.</p><button type="button" onClick={hireCharacterCastingSpecialist} className="min-h-12 w-full shrink-0 rounded-full bg-[#FFDF00] px-7 py-3 text-sm font-black uppercase tracking-[0.1em] text-black hover:bg-[#FFE633] sm:w-auto">{session.characterCastingSpecialist?.id === activeSpecialist.id ? "KEEP CHARACTER CASTING LEAD ✓" : "HIRE CHARACTER CASTING LEAD"}</button></footer>
          </section>
        </div>
      )}
    </main>
  );
}
