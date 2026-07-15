"use client";

import Link from "next/link";
import { currentAIProvider } from "../AIProviderSwitch";
import { useEffect, useState } from "react";
import { authenticatedFetch } from "../../../lib/authenticated-fetch";

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
  draftQuestion?: string;
};

const departments = [
  ["CINEMATOGRAPHY", "Choose the visual eye, camera language and lighting logic."],
  ["PRODUCTION DESIGN", "Build locations, objects, palette and the physical world."],
  ["EDITING", "Define rhythm, structure, transitions and the final pace."],
  ["SOUND & MUSIC", "Develop atmosphere, sonic motifs and musical direction."],
] as const;

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
  const [activeUnresolvedPoint, setActiveUnresolvedPoint] = useState("");

  useEffect(() => {
    const stored = sessionStorage.getItem("carabasaiCreativeSession");
    if (!stored) return;
    const restored = JSON.parse(stored) as ProjectSession;
    // This document is restored once from browser-only session storage.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSession(restored);
    setActiveSection(restored.projectDocument?.sections[0]?.id ?? "");
  }, []);

  if (!session?.projectDocument) {
    return <main className="flex min-h-screen items-center justify-center bg-[#050505] p-6 text-white"><div className="text-center"><p className="text-xs font-black text-[#FFDF00]">NO PROJECT DOCUMENT</p><Link href="/studio/creative-room" className="mt-6 inline-flex rounded-full border border-white/15 px-6 py-3 text-xs font-black">RETURN TO CREATIVE ROOM</Link></div></main>;
  }

  const document = session.projectDocument;
  const section = document.sections.find((item) => item.id === activeSection) ?? document.sections[0];

  function persistDocument(nextDocument: ProjectDocument) {
    if (!session) return;
    const updated: ProjectSession = { ...session, projectDocument: nextDocument };
    sessionStorage.setItem("carabasaiCreativeSession", JSON.stringify(updated));
    const history = (JSON.parse(localStorage.getItem("carabasaiSessionHistory") ?? "[]") as ProjectSession[]).filter((item) => item.id !== session.id);
    localStorage.setItem("carabasaiSessionHistory", JSON.stringify([updated, ...history].slice(0, 20)));
    setSession(updated);
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
      const history = (JSON.parse(localStorage.getItem("carabasaiSessionHistory") ?? "[]") as ProjectSession[]).filter((item) => item.id !== activeSession.id);
      localStorage.setItem("carabasaiSessionHistory", JSON.stringify([updated, ...history].slice(0, 20)));
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
      const history = (JSON.parse(localStorage.getItem("carabasaiSessionHistory") ?? "[]") as ProjectSession[]).filter((item) => item.id !== activeSession.id);
      localStorage.setItem("carabasaiSessionHistory", JSON.stringify([updated, ...history].slice(0, 20)));
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
    <main className="min-h-screen bg-[#050505] px-4 py-5 text-white sm:px-8 lg:px-12">
      <header className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 border-b border-white/10 pb-5">
        <div><p className="text-xs font-black tracking-[0.2em] text-[#FFDF00]">CARABASAI STUDIO</p><p className="mt-2 text-[9px] tracking-[0.16em] text-white/30">PROJECT DOCUMENT / DEVELOPMENT COMPLETE</p></div>
        <nav className="flex items-center gap-2 text-[9px] font-black tracking-[0.1em]"><Link href="/studio" className="text-white/40">CREW SETUP</Link><span className="text-white/20">/</span><Link href="/studio/creative-room" className="text-white/40">DIALOGUE</Link><span className="text-white/20">/</span><span className="text-[#FFDF00]">SUMMARY</span></nav>
      </header>

      <div className="mx-auto mt-8 grid max-w-7xl gap-6 lg:grid-cols-[1fr_340px]">
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
              return <li key={pointId} className={`flex flex-wrap items-start gap-3 rounded-[12px] px-2 py-1 text-sm leading-6 ${highlightedPoints.includes(point) ? "bg-[#FFDF00]/5 text-[#FFDF00]" : "text-white/75"}`}><button type="button" onClick={() => unresolved && setActiveUnresolvedPoint((current) => current === pointId ? "" : pointId)} className={unresolved ? "flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-red-400/15 text-xs font-black text-red-300" : "text-[#FFDF00]"} aria-label={unresolved ? "Resolve this point" : "Approved point"}>{unresolved ? "!" : "✓"}</button>{editingPoint === pointId ? <input value={editingValue} onChange={(event) => setEditingValue(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") savePoint(section.id, pointIndex); if (event.key === "Escape") setEditingPoint(""); }} autoFocus className="min-w-0 flex-1 rounded-lg border border-[#FFDF00]/25 bg-black/30 px-2 py-1 text-sm text-white outline-none" /> : <span className="min-w-0 flex-1">{point}</span>}<button type="button" onClick={() => editingPoint === pointId ? savePoint(section.id, pointIndex) : (setEditingPoint(pointId), setEditingValue(point))} className="shrink-0 text-xs text-white/25 hover:text-[#FFDF00]">{editingPoint === pointId ? "✓" : "✎"}</button><button type="button" onClick={() => { if (window.confirm("DELETE THIS POINT?")) deletePoint(section.id, pointIndex); }} className="shrink-0 text-sm text-white/15 hover:text-red-300" aria-label="Delete point">×</button>{unresolved && activeUnresolvedPoint === pointId && <div className="ml-8 w-full"><button type="button" onClick={() => askTeam({ id: pointId, label: section.title, question: `Помогите принять конкретное решение по пункту: ${point}` })} className="rounded-full border border-red-300/20 px-4 py-2 text-[8px] font-black text-red-200">ASK THE TEAM</button></div>}</li>;
            })}</ul>
          </div>
        </section>

        <aside className="space-y-5">
          {(document.openQuestions?.length ?? 0) > 0 && <section className="rounded-[28px] border border-[#FFDF00]/15 bg-[#FFDF00]/[0.025] p-5"><div className="flex items-center justify-between gap-3"><p className="text-[10px] font-black tracking-[0.16em] text-[#FFDF00]">UNRESOLVED KEY POINTS</p><button type="button" onClick={() => void letTeamDecideAll()} disabled={Boolean(resolvingQuestion)} className="rounded-full bg-[#FFDF00] px-3 py-2 text-[8px] font-black text-black disabled:opacity-30">{resolvingQuestion === "all" ? "DECIDING ALL..." : "LET TEAM DECIDE ALL"}</button></div><div className="mt-4 space-y-3">{document.openQuestions?.map((question) => <div key={question.id} className="rounded-[16px] border border-white/10 bg-black/20 p-4"><p className="text-[9px] font-black text-white/40">{question.label}</p><p className="mt-2 text-xs leading-5 text-white/70">{question.question}</p><div className="mt-4 grid grid-cols-2 gap-2"><button type="button" onClick={() => askTeam(question)} className="rounded-full border border-white/10 px-3 py-2 text-[8px] font-black text-white/55">ASK THE TEAM</button><button type="button" onClick={() => void letTeamDecide(question)} disabled={Boolean(resolvingQuestion)} className="rounded-full bg-[#FFDF00] px-3 py-2 text-[8px] font-black text-black disabled:opacity-30">{resolvingQuestion === question.id ? "DECIDING..." : "LET TEAM DECIDE"}</button></div></div>)}</div>{error && <p className="mt-4 text-[9px] text-red-300">{error}</p>}</section>}
          <section className="rounded-[28px] border border-white/10 bg-white/[0.025] p-5"><p className="text-[10px] font-black tracking-[0.16em] text-[#FFDF00]">NEXT CREW STAGE</p><h2 className="mt-3 text-2xl font-black">ASSEMBLE THE DEPARTMENTS</h2><p className="mt-4 text-xs leading-6 text-white/35">The approved document travels with you. Choose every next specialist to continue.</p><div className="mt-6 space-y-3">{departments.map(([name, description]) => { const selected = selectedDepartments.includes(name); return <button key={name} type="button" onClick={() => setSelectedDepartments((current) => selected ? current.filter((item) => item !== name) : [...current, name])} className={`w-full rounded-[18px] border p-4 text-left transition ${selected ? "border-[#FFDF00]/45 bg-[#FFDF00]/5" : "border-white/10 bg-black/20 hover:border-[#FFDF00]/35"}`}><p className="text-[10px] font-black text-white/75">{name}</p><p className="mt-2 text-[10px] leading-5 text-white/30">{description}</p><p className="mt-3 text-[9px] font-black text-[#FFDF00]">{selected ? "SPECIALIST SELECTED ✓" : "CHOOSE SPECIALIST +"}</p></button>; })}</div><div className="mt-6 flex justify-end"><button type="button" disabled={selectedDepartments.length !== departments.length} className="rounded-full bg-[#FFDF00] px-6 py-3 text-[10px] font-black text-black disabled:cursor-not-allowed disabled:opacity-20">NEXT →</button></div></section>
        </aside>
      </div>
    </main>
  );
}
