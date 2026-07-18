"use client";

import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { currentAIProvider } from "../AIProviderSwitch";
import { useEffect, useRef, useState } from "react";
import { authenticatedFetch } from "../../../lib/authenticated-fetch";
import StudioSidebar from "../../components/StudioSidebar";
import WorkflowNav from "../../components/WorkflowNav";
import { getCachedProjects, saveProjects } from "../../../lib/project-store";
import { platformConfirm } from "../../../lib/platform-dialog";
import { characterCastingSpecialists, type CharacterCastingSpecialist } from "../../../lib/character-casting";

type ProjectSection = { id: string; title: string; summary: string; points: string[]; ratings?: { secondDirector: number; screenwriter: number; reason: string } };
type OpenQuestion = { id: string; label: string; question: string };
type ProjectDocument = { title: string; logline: string; sections: ProjectSection[]; openQuestions?: OpenQuestion[] };
type DialogueFeedback = { id: string; text: string; start: number; end: number; sentiment: "good" | "bad"; category: string; createdAt: number };
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
  screenplay?: string;
  screenplayDirectorNotes?: string;
  dialogueAudit?: string;
  dialogueFeedback?: DialogueFeedback[];
};

const GOOD_DIALOGUE_CATEGORIES = ["NATURAL", "SUBTEXT", "DISTINCT VOICE", "LOGICAL REACTION", "PLAYABLE", "POWER SHIFT"];
const BAD_DIALOGUE_CATEGORIES = ["CRINGE", "BANAL", "ILLOGICAL", "STUPID", "MEANINGLESS", "EXPOSITION", "UNNATURAL", "OUT OF CHARACTER", "ILLOGICAL REPLY", "SAME VOICE", "TOO LITERARY", "NO INTENTION", "CONTINUITY ERROR"];

function isUnresolvedPoint(point: string) {
  return /\?|не определ|не решен|не выбран|нужно\s+(решить|выбрать|определить|уточнить)|следует\s+(решить|выбрать|определить|уточнить)|предстоит\s+(решить|выбрать|определить)|требуется\s+(решить|выбрать|определить|уточнить)|остается\s+(решить|выбрать|определить)|пока нет|отсутствует/i.test(point);
}

export default function ProjectPage() {
  const router = useRouter();
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
  const [castingSamplePreview, setCastingSamplePreview] = useState<CharacterCastingSpecialist["characterExamples"][number] | null>(null);
  const [activeUnresolvedPoint, setActiveUnresolvedPoint] = useState("");
  const [openingCasting, setOpeningCasting] = useState(false);
  const [screenplayDraft, setScreenplayDraft] = useState("");
  const [screenplaySaved, setScreenplaySaved] = useState(false);
  const [isGeneratingScreenplay, setIsGeneratingScreenplay] = useState(false);
  const [selectedScriptText, setSelectedScriptText] = useState<{ text: string; start: number; end: number } | null>(null);
  const [feedbackSentiment, setFeedbackSentiment] = useState<"good" | "bad" | null>(null);
  const screenplayRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const stored = sessionStorage.getItem("carabasaiCreativeSession");
    if (!stored) return;
    const restored = JSON.parse(stored) as ProjectSession;
    // This document is restored once from browser-only session storage.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSession(restored);
    setActiveSection(restored.projectDocument?.sections[0]?.id ?? "");
    setScreenplayDraft(restored.screenplay ?? "");
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

  function saveScreenplay() {
    if (!session || !screenplayDraft.trim()) return;
    const updated: ProjectSession = { ...session, screenplay: screenplayDraft };
    sessionStorage.setItem("carabasaiCreativeSession", JSON.stringify(updated));
    const history = getCachedProjects<ProjectSession>().filter((item) => item.id !== session.id);
    saveProjects([updated, ...history].slice(0, 20));
    setSession(updated);
    setScreenplaySaved(true);
    window.setTimeout(() => setScreenplaySaved(false), 1600);
  }

  function captureScriptSelection() {
    const textarea = screenplayRef.current;
    if (!textarea || textarea.selectionStart === textarea.selectionEnd) {
      setSelectedScriptText(null);
      setFeedbackSentiment(null);
      return;
    }
    setSelectedScriptText({
      text: screenplayDraft.slice(textarea.selectionStart, textarea.selectionEnd),
      start: textarea.selectionStart,
      end: textarea.selectionEnd,
    });
    setFeedbackSentiment(null);
  }

  function saveDialogueFeedback(category: string) {
    if (!session || !selectedScriptText || !feedbackSentiment) return;
    const feedback: DialogueFeedback = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      ...selectedScriptText,
      sentiment: feedbackSentiment,
      category,
      createdAt: Date.now(),
    };
    const updated: ProjectSession = { ...session, dialogueFeedback: [...(session.dialogueFeedback ?? []), feedback] };
    sessionStorage.setItem("carabasaiCreativeSession", JSON.stringify(updated));
    const history = getCachedProjects<ProjectSession>().filter((item) => item.id !== session.id);
    saveProjects([updated, ...history].slice(0, 20));
    setSession(updated);
    void authenticatedFetch("/api/dialogue-feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        project_id: session.id ?? "unsaved-project",
        specialist_id: session.screenwriter.name,
        text: feedback.text,
        sentiment: feedback.sentiment,
        category: feedback.category,
        context: screenplayDraft.slice(Math.max(0, feedback.start - 350), Math.min(screenplayDraft.length, feedback.end + 350)),
      }),
    }).catch(() => undefined);
    setSelectedScriptText(null);
    setFeedbackSentiment(null);
    screenplayRef.current?.focus();
  }

  function removeDialogueFeedback(id: string) {
    if (!session) return;
    const updated: ProjectSession = { ...session, dialogueFeedback: (session.dialogueFeedback ?? []).filter((item) => item.id !== id) };
    sessionStorage.setItem("carabasaiCreativeSession", JSON.stringify(updated));
    const history = getCachedProjects<ProjectSession>().filter((item) => item.id !== session.id);
    saveProjects([updated, ...history].slice(0, 20));
    setSession(updated);
  }

  function downloadScreenplay() {
    if (!screenplayDraft.trim()) return;
    const blob = new Blob([screenplayDraft], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = window.document.createElement("a");
    anchor.href = url;
    anchor.download = `${session?.projectDocument?.title || "carabasai-screenplay"}.txt`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  async function createScreenplay() {
    if (!session || isGeneratingScreenplay) return;
    const confirmed = await platformConfirm({
      eyebrow: "SCREENPLAY",
      title: "CREATE SCREENPLAY FROM SUMMARY?",
      message: "The approved Summary decisions will be used to create the screenplay. When generation is complete, the Summary workspace will be replaced by the editable screenplay.",
      confirmLabel: "CREATE SCREENPLAY",
    });
    if (!confirmed) return;

    setIsGeneratingScreenplay(true);
    setError("");
    try {
      const source = `${session.notes ?? ""}\n${session.notebook?.map((note) => note.detail).join("\n") ?? ""}`.toLowerCase();
      const genre = source.match(/horror|ужас|страх|ведьм|вампир/) ? "horror"
        : source.match(/comedy|комед|юмор/) ? "comedy"
          : source.match(/thriller|триллер/) ? "thriller"
            : source.match(/sci-fi|science fiction|фантаст/) ? "science_fiction"
              : "drama";
      const response = await authenticatedFetch("/api/screenplay-generation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          brief: session.notes,
          genre,
          conversation: session.messages ?? [],
          notes: session.notebook ?? [],
          team: { secondDirector: session.secondDirector.name, screenwriter: session.screenwriter.name },
        }),
      });
      const data = await response.json() as { screenplay?: string; director_notes?: string; dialogue_audit?: string; error?: string };
      if (!response.ok || !data.screenplay) throw new Error(data.error || "SCREENPLAY COULD NOT BE GENERATED.");
      const updated: ProjectSession = { ...session, screenplay: data.screenplay, screenplayDirectorNotes: data.director_notes, dialogueAudit: data.dialogue_audit };
      sessionStorage.setItem("carabasaiCreativeSession", JSON.stringify(updated));
      const history = getCachedProjects<ProjectSession>().filter((item) => item.id !== session.id);
      saveProjects([updated, ...history].slice(0, 20));
      setSession(updated);
      setScreenplayDraft(data.screenplay);
    } catch (screenplayError) {
      setError(screenplayError instanceof Error ? screenplayError.message : "SCREENPLAY COULD NOT BE GENERATED.");
    } finally {
      setIsGeneratingScreenplay(false);
    }
  }

  async function rewriteScreenplayWithFeedback() {
    if (!session?.screenplay || !(session.dialogueFeedback?.length) || isGeneratingScreenplay) return;
    const confirmed = await platformConfirm({
      eyebrow: "DIALOGUE FEEDBACK",
      title: "REWRITE SCREENPLAY WITH YOUR RATINGS?",
      message: "The screenwriter will preserve positively rated passages and rewrite negatively rated dialogue patterns across the screenplay. Your current version remains in project history.",
      confirmLabel: "REWRITE SCREENPLAY",
    });
    if (!confirmed) return;
    setIsGeneratingScreenplay(true);
    setError("");
    try {
      const response = await authenticatedFetch("/api/screenplay-generation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          brief: session.notes,
          genre: "drama",
          conversation: session.messages ?? [],
          notes: session.notebook ?? [],
          team: { secondDirector: session.secondDirector.name, screenwriter: session.screenwriter.name },
          existingScreenplay: screenplayDraft,
          dialogueFeedback: session.dialogueFeedback,
        }),
      });
      const data = await response.json() as { screenplay?: string; director_notes?: string; dialogue_audit?: string; error?: string };
      if (!response.ok || !data.screenplay) throw new Error(data.error || "SCREENPLAY COULD NOT BE REWRITTEN.");
      const updated: ProjectSession = { ...session, screenplay: data.screenplay, screenplayDirectorNotes: data.director_notes, dialogueAudit: data.dialogue_audit, dialogueFeedback: [] };
      sessionStorage.setItem("carabasaiCreativeSession", JSON.stringify(updated));
      const history = getCachedProjects<ProjectSession>().filter((item) => item.id !== session.id);
      saveProjects([updated, ...history].slice(0, 20));
      setSession(updated);
      setScreenplayDraft(data.screenplay);
      setSelectedScriptText(null);
    } catch (rewriteError) {
      setError(rewriteError instanceof Error ? rewriteError.message : "SCREENPLAY COULD NOT BE REWRITTEN.");
    } finally {
      setIsGeneratingScreenplay(false);
    }
  }

  function hireCharacterCastingSpecialist() {
    if (!session?.screenplay) return;
    const updated: ProjectSession = { ...session, characterCastingSpecialist: activeSpecialist };
    sessionStorage.setItem("carabasaiCreativeSession", JSON.stringify(updated));
    const history = getCachedProjects<ProjectSession>().filter((item) => item.id !== session.id);
    saveProjects([updated, ...history].slice(0, 20));
    setSession(updated);
    setSelectedDepartments(["CHARACTER CASTING"]);
    setSpecialistRosterOpen(false);
  }

  function openCharacterCasting() {
    if (!session?.characterCastingSpecialist || openingCasting) return;
    setOpeningCasting(true);

    const updated = {
      ...session,
      stage: "casting" as const,
      characterCasting: (session as ProjectSession & { characterCasting?: unknown }).characterCasting ?? {
        specialistId: session.characterCastingSpecialist.id,
        characters: [],
        messages: [],
      },
    };

    sessionStorage.setItem("carabasaiCreativeSession", JSON.stringify(updated));
    const history = getCachedProjects<ProjectSession>().filter((item) => item.id !== session.id);
    saveProjects([updated, ...history].slice(0, 20));
    setSession(updated);
    router.push("/studio/character-casting");
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
        <section className="overflow-hidden rounded-[28px] border border-white/10 bg-[#090909] lg:flex lg:h-[calc(100dvh-12.5rem)] lg:min-h-[620px] lg:flex-col">
          <div className="panel-header border-b border-white/10 bg-[#353535] p-6 sm:p-8 lg:h-[228px] lg:shrink-0 lg:overflow-y-auto"><p className="text-[10px] font-black tracking-[0.16em] text-[#FFDF00]">{session.screenplay ? "FINAL SCREENPLAY" : "DIRECTOR + SCREENWRITER SUMMARY"}</p><h1 className="mt-3 text-3xl font-black tracking-[-0.04em] sm:text-5xl">{document.title}</h1><p className="mt-5 max-w-3xl text-sm leading-7 text-white/55">{document.logline}</p><p className="mt-5 text-[9px] text-white/25">{session.secondDirector.name} + {session.screenwriter.name}</p></div>
          {!session.screenplay && <div className="flex gap-2 overflow-x-auto border-b border-white/10 bg-[#303030] p-3 sm:px-6">
            {document.sections.map((item) => <button key={item.id} type="button" onClick={() => setActiveSection(item.id)} className={`shrink-0 rounded-full px-4 py-2 text-[9px] font-black tracking-[0.1em] ${item.id === section.id ? "bg-[#FFDF00] text-black" : "border border-white/10 text-white/40"}`}>{item.title}</button>)}
          </div>}
          <div className="min-h-[360px] bg-[#090909] p-6 sm:p-8 lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
            {session.screenplay ? (
              <div>
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div><p className="text-[10px] font-black tracking-[0.16em] text-[#FFDF00]">FINAL SCREENPLAY</p><h2 className="mt-2 text-2xl font-black">EDIT THE SCRIPT</h2><p className="mt-2 text-xs leading-5 text-white/35">Changes are saved to this project and remain editable.</p></div>
                  <div className="flex gap-2"><button type="button" onClick={downloadScreenplay} className="rounded-full border border-white/15 px-4 py-2 text-[9px] font-black text-white/55 hover:border-[#FFDF00]/40 hover:text-[#FFDF00]">DOWNLOAD</button><button type="button" onClick={saveScreenplay} className="rounded-full bg-[#FFDF00] px-5 py-2 text-[9px] font-black text-black">{screenplaySaved ? "SAVED ✓" : "SAVE CHANGES"}</button></div>
                </div>
                {selectedScriptText && <div className="sticky top-3 z-20 mt-6 rounded-[18px] border border-[#FFDF00]/30 bg-[#11100a]/95 p-3 shadow-2xl backdrop-blur-xl"><p className="truncate text-[10px] text-white/45">“{selectedScriptText.text.replace(/\s+/g, " ").slice(0, 140)}”</p><div className="mt-3 flex flex-wrap items-center gap-2"><button type="button" onClick={() => setFeedbackSentiment("good")} className={`rounded-full px-4 py-2 text-[9px] font-black ${feedbackSentiment === "good" ? "bg-emerald-400 text-black" : "border border-emerald-300/30 text-emerald-300"}`}>GOOD</button><button type="button" onClick={() => setFeedbackSentiment("bad")} className={`rounded-full px-4 py-2 text-[9px] font-black ${feedbackSentiment === "bad" ? "bg-red-400 text-black" : "border border-red-300/30 text-red-300"}`}>BAD</button><button type="button" onClick={() => { setSelectedScriptText(null); setFeedbackSentiment(null); }} className="ml-auto px-2 text-sm text-white/25">×</button></div>{feedbackSentiment && <div className="mt-3 flex flex-wrap gap-2">{(feedbackSentiment === "good" ? GOOD_DIALOGUE_CATEGORIES : BAD_DIALOGUE_CATEGORIES).map((category) => <button key={category} type="button" onClick={() => saveDialogueFeedback(category)} className="rounded-full border border-white/10 px-3 py-2 text-[8px] font-black text-white/60 transition hover:border-[#FFDF00]/40 hover:text-[#FFDF00]">{category}</button>)}</div>}</div>}
                <textarea ref={screenplayRef} value={screenplayDraft} onSelect={captureScriptSelection} onMouseUp={captureScriptSelection} onKeyUp={captureScriptSelection} onChange={(event) => { setScreenplayDraft(event.target.value); setScreenplaySaved(false); setSelectedScriptText(null); }} spellCheck className="mt-6 min-h-[70vh] w-full resize-y rounded-[20px] border border-[#FFDF00]/20 bg-black/35 p-5 font-mono text-sm leading-7 text-white/85 outline-none transition focus:border-[#FFDF00]/60 sm:p-7" aria-label="Editable screenplay" />
                {(session.dialogueFeedback?.length ?? 0) > 0 && <section className="mt-5 rounded-[18px] border border-white/10 bg-black/20 p-4"><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-[9px] font-black tracking-[0.12em] text-[#FFDF00]">DIALOGUE TRAINING FEEDBACK · {session.dialogueFeedback?.length}</p><p className="mt-2 text-[10px] text-white/30">These ratings are saved with the project and will guide the next rewrite.</p></div><button type="button" onClick={() => void rewriteScreenplayWithFeedback()} disabled={isGeneratingScreenplay} className="rounded-full bg-[#FFDF00] px-5 py-3 text-[9px] font-black text-black disabled:opacity-30">{isGeneratingScreenplay ? "REWRITING..." : "REWRITE WITH FEEDBACK"}</button></div><div className="mt-4 space-y-2">{session.dialogueFeedback?.map((item) => <div key={item.id} className="flex items-start gap-3 rounded-[12px] border border-white/5 px-3 py-2"><span className={`mt-0.5 rounded-full px-2 py-1 text-[7px] font-black ${item.sentiment === "good" ? "bg-emerald-400/15 text-emerald-300" : "bg-red-400/15 text-red-300"}`}>{item.sentiment.toUpperCase()} · {item.category}</span><p className="min-w-0 flex-1 truncate text-[10px] text-white/40">{item.text.replace(/\s+/g, " ")}</p><button type="button" onClick={() => removeDialogueFeedback(item.id)} className="text-sm text-white/20 hover:text-red-300">×</button></div>)}</div></section>}
                {session.screenplayDirectorNotes && <details className="mt-5 rounded-[18px] border border-white/10 bg-black/20 p-4"><summary className="cursor-pointer text-[9px] font-black tracking-[0.12em] text-white/40">DIRECTOR NOTES</summary><p className="mt-4 whitespace-pre-wrap text-xs leading-6 text-white/50">{session.screenplayDirectorNotes}</p></details>}
                {session.dialogueAudit && <details className="mt-3 rounded-[18px] border border-[#FFDF00]/15 bg-[#FFDF00]/[0.025] p-4"><summary className="cursor-pointer text-[9px] font-black tracking-[0.12em] text-[#FFDF00]">AUTOMATIC DIALOGUE AUDIT</summary><p className="mt-4 whitespace-pre-wrap text-xs leading-6 text-white/50">{session.dialogueAudit}</p></details>}
              </div>
            ) : (
            <>
            <h2 className="text-2xl font-black">{section.title}</h2>
            {section.ratings && <div className="mt-5 rounded-[18px] border border-white/10 bg-black/20 p-4"><div className="flex flex-wrap gap-5 text-[10px] font-black"><span>{session.secondDirector.name}: <span className="text-[#FFDF00]">{"★".repeat(section.ratings.secondDirector)}{"☆".repeat(5 - section.ratings.secondDirector)}</span></span><span>{session.screenwriter.name}: <span className="text-[#FFDF00]">{"★".repeat(section.ratings.screenwriter)}{"☆".repeat(5 - section.ratings.screenwriter)}</span></span></div><p className="mt-3 text-[10px] leading-5 text-white/35">{section.ratings.reason}</p></div>}
            <p className="mt-4 max-w-3xl text-sm leading-7 text-white/50">{section.summary}</p>
            <ul className="mt-7 space-y-4">{section.points.map((point, pointIndex) => {
              const pointId = `${section.id}:${pointIndex}`;
              const unresolved = isUnresolvedPoint(point);
              return <li key={pointId} className={`flex flex-wrap items-start gap-3 rounded-[12px] px-2 py-1 text-sm leading-6 ${highlightedPoints.includes(point) ? "bg-[#FFDF00]/5 text-[#FFDF00]" : "text-white/75"}`}><button type="button" onClick={() => unresolved && setActiveUnresolvedPoint((current) => current === pointId ? "" : pointId)} className={unresolved ? "flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-red-400/15 text-xs font-black text-red-300" : "text-[#FFDF00]"} aria-label={unresolved ? "Resolve this point" : "Approved point"}>{unresolved ? "!" : "✓"}</button>{editingPoint === pointId ? <input value={editingValue} onChange={(event) => setEditingValue(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") savePoint(section.id, pointIndex); if (event.key === "Escape") setEditingPoint(""); }} autoFocus className="min-w-0 flex-1 rounded-lg border border-[#FFDF00]/25 bg-black/30 px-2 py-1 text-sm text-white outline-none" /> : <span className="min-w-0 flex-1">{point}</span>}<button type="button" onClick={() => editingPoint === pointId ? savePoint(section.id, pointIndex) : (setEditingPoint(pointId), setEditingValue(point))} className="shrink-0 text-xs text-white/25 hover:text-[#FFDF00]">{editingPoint === pointId ? "✓" : "✎"}</button><button type="button" onClick={() => void platformConfirm({ eyebrow: "PROJECT DOCUMENT", title: "DELETE KEY POINT?", message: "This point will be removed from the current project document.", confirmLabel: "DELETE POINT", tone: "danger" }).then((confirmed) => { if (confirmed) deletePoint(section.id, pointIndex); })} className="shrink-0 text-sm text-white/15 hover:text-red-300" aria-label="Delete point">×</button>{unresolved && activeUnresolvedPoint === pointId && <div className="ml-8 w-full"><button type="button" onClick={() => askTeam({ id: pointId, label: section.title, question: `Помогите принять конкретное решение по пункту: ${point}` })} className="rounded-full border border-red-300/20 px-4 py-2 text-[8px] font-black text-red-200">ASK THE TEAM</button></div>}</li>;
            })}</ul>
            <div className="mt-10 border-t border-[#FFDF00]/15 pt-7"><p className="max-w-2xl text-xs leading-6 text-white/40">When all Summary decisions are ready, create the screenplay with the selected screenwriter and director.</p>{error && <p className="mt-3 text-xs text-red-300">{error}</p>}<button type="button" onClick={() => void createScreenplay()} disabled={isGeneratingScreenplay} className="mt-5 w-full rounded-full bg-[#FFDF00] px-6 py-4 text-xs font-black tracking-[0.12em] text-black shadow-[0_0_32px_rgba(255,223,0,0.14)] disabled:opacity-35">{isGeneratingScreenplay ? "SCREENWRITER + DIRECTOR ARE WORKING..." : "CREATE SCREENPLAY"}</button></div>
            </>
            )}
          </div>
        </section>

        <aside className={`space-y-5 ${session.screenplay ? "[&>section:first-child:not(:last-child)]:hidden" : "[&>section:last-child]:hidden"}`}>
          {(document.openQuestions?.length ?? 0) > 0 && <section className="rounded-[28px] border border-[#FFDF00]/15 bg-[#FFDF00]/[0.025] p-5"><div className="flex items-center justify-between gap-3"><p className="text-[10px] font-black tracking-[0.16em] text-[#FFDF00]">UNRESOLVED KEY POINTS</p><button type="button" onClick={() => void letTeamDecideAll()} disabled={Boolean(resolvingQuestion)} className="rounded-full bg-[#FFDF00] px-3 py-2 text-[8px] font-black text-black disabled:opacity-30">{resolvingQuestion === "all" ? "DECIDING ALL..." : "LET TEAM DECIDE ALL"}</button></div><div className="mt-4 space-y-3">{document.openQuestions?.map((question) => <div key={question.id} className="rounded-[16px] border border-white/10 bg-black/20 p-4"><p className="text-[9px] font-black text-white/40">{question.label}</p><p className="mt-2 text-xs leading-5 text-white/70">{question.question}</p><div className="mt-4 grid grid-cols-2 gap-2"><button type="button" onClick={() => askTeam(question)} className="rounded-full border border-white/10 px-3 py-2 text-[8px] font-black text-white/55">ASK THE TEAM</button><button type="button" onClick={() => void letTeamDecide(question)} disabled={Boolean(resolvingQuestion)} className="rounded-full bg-[#FFDF00] px-3 py-2 text-[8px] font-black text-black disabled:opacity-30">{resolvingQuestion === question.id ? "DECIDING..." : "LET TEAM DECIDE"}</button></div></div>)}</div>{error && <p className="mt-4 text-[9px] text-red-300">{error}</p>}</section>}
          <section className="rounded-[28px] border border-white/10 bg-white/[0.025] p-5"><p className="text-[10px] font-black tracking-[0.16em] text-[#FFDF00]">NEXT CREW STAGE</p><h2 className="mt-3 text-2xl font-black">CHARACTER CASTING</h2><p className="mt-4 text-xs leading-6 text-white/35">Choose the visual casting eye that will define every generated face and body before costume design begins.</p><button type="button" onClick={() => setSpecialistRosterOpen(true)} className={`mt-6 flex min-h-36 w-full flex-col justify-between rounded-[20px] border p-5 text-left transition ${session.characterCastingSpecialist ? "border-[#FFDF00]/45 bg-[#FFDF00]/5" : "border-white/10 bg-black/20 hover:border-[#FFDF00]/35"}`}><div className="flex items-start gap-4">{session.characterCastingSpecialist && <Image src={session.characterCastingSpecialist.portrait} alt={session.characterCastingSpecialist.name} width={56} height={56} className="h-14 w-14 shrink-0 rounded-[14px] border border-white/10 object-cover object-top" />}<div className="min-w-0"><p className="text-xs font-black text-white/80">{session.characterCastingSpecialist?.name ?? "CHOOSE CHARACTER CASTING LEAD"}</p><p className="mt-2 text-[9px] font-black tracking-[0.08em] text-[#FFDF00]/70">{session.characterCastingSpecialist?.specialty ?? "FACE / BODY / PHYSICAL PRESENCE"}</p><p className="mt-3 text-[10px] leading-5 text-white/35">{session.characterCastingSpecialist?.biography ?? "Open the roster and choose the visual method that will shape all subsequent character generations."}</p></div></div><p className="mt-5 text-[9px] font-black text-[#FFDF00]">{session.characterCastingSpecialist ? "CHANGE SPECIALIST →" : "OPEN SPECIALIST ROSTER +"}</p></button><div className="mt-6 flex justify-end"><button type="button" onClick={openCharacterCasting} disabled={!session.characterCastingSpecialist || openingCasting} aria-busy={openingCasting} className="flex min-w-28 items-center justify-center gap-2 rounded-full bg-[#FFDF00] px-6 py-3 text-[10px] font-black text-black disabled:cursor-not-allowed disabled:opacity-20">{openingCasting ? <><span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-black/25 border-t-black" aria-hidden="true" /><span>OPENING...</span></> : <span>NEXT →</span>}</button></div></section>
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
                  <div className="absolute bottom-0 left-0 right-0 p-5 sm:p-8"><p className="text-[10px] font-black uppercase tracking-[0.2em] text-[#FFDF00] sm:text-xs">CHARACTER CASTING LEAD</p><h3 className="mt-2 text-3xl font-black uppercase tracking-[-0.05em] sm:text-5xl">{activeSpecialist.name}</h3><p className="mt-2 text-xs font-black uppercase tracking-[0.1em] text-white/60 sm:text-sm">{activeSpecialist.specialty}</p></div>
                </div>

                <div className="flex min-h-[620px] flex-col p-5 sm:p-8">
                  <blockquote className="text-xl font-black leading-tight tracking-[-0.03em] text-[#FFDF00] sm:text-3xl">{activeSpecialist.quote}</blockquote>
                  <p className="mt-5 text-sm leading-6 text-white/55">{activeSpecialist.biography}</p>
                  <p className="mt-3 text-[10px] font-black uppercase tracking-[0.1em] text-white/35"><span className="text-[#FFDF00]">INSPIRED BY</span> · {activeSpecialist.inspiredBy}</p>
                  <div className="mt-4 flex flex-wrap gap-2">{activeSpecialist.tags.map((tag) => <span key={tag} className="rounded-full border border-white/10 bg-white/[0.035] px-3 py-1.5 text-[8px] font-black uppercase tracking-[0.08em] text-white/45">{tag}</span>)}</div>
                  <div className="mt-5 grid gap-3 text-xs sm:grid-cols-2"><p className="rounded-[14px] border border-white/8 p-3 leading-5 text-white/55"><span className="mr-2 font-black uppercase text-[#FFDF00]">BEST FOR</span>{activeSpecialist.bestFor}</p><p className="rounded-[14px] border border-white/8 p-3 leading-5 text-white/45"><span className="mr-2 font-black uppercase text-white/25">NOT FOR</span>{activeSpecialist.notFor}</p></div>
                  <div className="mt-6"><div className="flex items-end justify-between"><p className="text-[10px] font-black uppercase tracking-[0.18em] text-white/35">CHARACTER STATS</p><p className="text-[8px] uppercase text-white/20">0–10</p></div><div className="mt-3 space-y-3">{activeSpecialist.stats.map((stat) => <div key={stat.label} className="grid grid-cols-[116px_1fr_24px] items-center gap-3"><span className="text-[9px] font-black uppercase tracking-[0.06em] text-white/50">{stat.label}</span><div className="h-1.5 overflow-hidden rounded-full bg-white/10"><div className="h-full rounded-full bg-[#FFDF00]" style={{ width: `${stat.value * 10}%` }} /></div><span className="text-right text-[9px] font-black text-white/60">{stat.value}</span></div>)}</div></div>
                  <div className="mt-7"><div className="flex items-end justify-between"><p className="text-[10px] font-black uppercase tracking-[0.18em] text-white/35">CASTING SAMPLES</p><p className="text-[8px] uppercase text-white/20">OPEN FULL 9:16 PORTRAIT</p></div><div className="mt-3 grid grid-cols-4 gap-2">{activeSpecialist.characterExamples.map((example) => <button type="button" onClick={() => setCastingSamplePreview(example)} key={example.image} className="group relative aspect-square overflow-hidden rounded-[14px] border border-white/10 bg-white/[0.03]" aria-label={`Open ${example.alt}`}><Image src={example.image} alt={example.alt} fill sizes="(min-width: 1024px) 12vw, 25vw" className="object-cover object-top transition duration-200 group-hover:scale-105" /><span className="absolute bottom-2 right-2 flex h-7 w-7 items-center justify-center rounded-full border border-white/15 bg-black/65 text-xs text-white/80">↗</span></button>)}</div></div>
                  <div className="mt-6"><p className="text-[10px] font-black uppercase tracking-[0.18em] text-white/35">REFERENCE WORKS</p><div className="mt-3 flex flex-wrap gap-2">{activeSpecialist.referenceWorks.map((work) => <span key={work.title} className="rounded-full border border-white/10 px-3 py-2 text-[9px] font-bold text-white/45">{work.title} · {work.year}</span>)}</div></div>
                </div>
              </div>
            </div>

            <footer className="flex shrink-0 flex-col gap-3 border-t border-white/10 bg-[#0A0A0A] px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-8"><p className="text-[9px] uppercase leading-5 text-white/30 sm:text-[10px]">YOU REMAIN THE DIRECTOR. THIS PERSON BRINGS A DISTINCT CASTING EYE TO YOUR PROJECT.</p><button type="button" onClick={hireCharacterCastingSpecialist} className="min-h-12 w-full shrink-0 rounded-full bg-[#FFDF00] px-7 py-3 text-sm font-black uppercase tracking-[0.1em] text-black hover:bg-[#FFE633] sm:w-auto">{session.characterCastingSpecialist?.id === activeSpecialist.id ? "KEEP CHARACTER CASTING LEAD ✓" : "HIRE CHARACTER CASTING LEAD"}</button></footer>
          </section>
        </div>
      )}
      {castingSamplePreview && (
        <div className="fixed inset-0 z-[11000] flex items-center justify-center bg-black/90 p-4 backdrop-blur-md" role="dialog" aria-modal="true" aria-label="Full casting sample">
          <button type="button" onClick={() => setCastingSamplePreview(null)} className="absolute inset-0 cursor-zoom-out" aria-label="Close full portrait" />
          <figure className="relative z-10 h-[min(88dvh,900px)] aspect-[9/16] overflow-hidden rounded-[24px] border border-white/15 bg-[#0A0A0A] shadow-2xl">
            <Image src={castingSamplePreview.image} alt={castingSamplePreview.alt} fill sizes="min(50vw, 506px)" className="object-contain" priority />
            <button type="button" onClick={() => setCastingSamplePreview(null)} className="absolute right-3 top-3 flex h-10 w-10 items-center justify-center rounded-full border border-white/15 bg-black/70 text-xl text-white" aria-label="Close full portrait">×</button>
          </figure>
        </div>
      )}
    </main>
  );
}
