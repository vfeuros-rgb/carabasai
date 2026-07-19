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
type DialogueFeedback = { id: string; text: string; start: number; end: number; sentiment: "good" | "bad"; category: string; createdAt: number; previousText?: string; rewrittenText?: string; rewrittenAt?: number; rewriteCount?: number; acceptedAt?: number };
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
  screenplayLibraryAt?: number;
  screenplayDirectorNotes?: string;
  dialogueAudit?: string;
  dialogueFeedback?: DialogueFeedback[];
  screenplayGeneration?: { status: "generating" | "complete" | "failed"; startedAt?: number; completedAt?: number; failedAt?: number; error?: string };
};

const GOOD_DIALOGUE_CATEGORIES = ["NATURAL", "SUBTEXT", "DISTINCT VOICE", "LOGICAL REACTION", "PLAYABLE", "POWER SHIFT"];
const BAD_DIALOGUE_CATEGORIES = ["CRINGE", "BANAL", "ILLOGICAL", "STUPID", "MEANINGLESS", "EXPOSITION", "UNNATURAL", "OUT OF CHARACTER", "ILLOGICAL REPLY", "SAME VOICE", "TOO LITERARY", "NO INTENTION", "CONTINUITY ERROR"];

function isUnresolvedPoint(point: string) {
  return /\?|не определ|не решен|не выбран|нужно\s+(решить|выбрать|определить|уточнить)|следует\s+(решить|выбрать|определить|уточнить)|предстоит\s+(решить|выбрать|определить)|требуется\s+(решить|выбрать|определить|уточнить)|остается\s+(решить|выбрать|определить)|пока нет|отсутствует/i.test(point);
}

function collapseDuplicateCharacterCues(screenplay: string) {
  return screenplay.replace(/(^|\n)([A-ZА-ЯЁ][A-ZА-ЯЁ0-9 .'-]{1,38}\n)(?:\2)+/gm, "$1$2");
}

function isWordCharacter(character: string | undefined) {
  return Boolean(character && /[\p{L}\p{N}_'-]/u.test(character));
}

function highlightedScreenplay(text: string, feedback: DialogueFeedback[]) {
  const ranges = [...feedback]
    .filter((item) => item.start >= 0 && item.end > item.start && item.end <= text.length)
    .sort((a, b) => a.start - b.start || b.createdAt - a.createdAt);
  const output: React.ReactNode[] = [];
  let cursor = 0;
  for (const item of ranges) {
    if (item.start < cursor || text.slice(item.start, item.end) !== item.text) continue;
    if (item.start > cursor) output.push(text.slice(cursor, item.start));
    const state = item.rewrittenText && !item.acceptedAt ? "rewritten" : item.acceptedAt || item.sentiment === "good" ? "good" : "bad";
    output.push(<mark key={item.id} className={state === "rewritten" ? "bg-[#FFDF00]/35 text-[#FFE94D]" : state === "good" ? "bg-emerald-400/25 text-emerald-200" : "bg-red-400/25 text-red-200"}>{text.slice(item.start, item.end)}</mark>);
    cursor = item.end;
  }
  if (cursor < text.length) output.push(text.slice(cursor));
  return output;
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
  const [isDownloadingScreenplay, setIsDownloadingScreenplay] = useState(false);
  const [isGeneratingScreenplay, setIsGeneratingScreenplay] = useState(false);
  const [selectedScriptText, setSelectedScriptText] = useState<{ text: string; start: number; end: number } | null>(null);
  const [feedbackSentiment, setFeedbackSentiment] = useState<"good" | "bad" | null>(null);
  const [activeFeedbackId, setActiveFeedbackId] = useState("");
  const screenplayRef = useRef<HTMLTextAreaElement>(null);
  const screenplayHighlightRef = useRef<HTMLPreElement>(null);
  const feedbackNavigationRef = useRef(false);

  useEffect(() => {
    const restore = () => {
      const stored = sessionStorage.getItem("carabasaiCreativeSession");
      if (!stored) return;
      const tabSnapshot = JSON.parse(stored) as ProjectSession;
      const cachedSnapshot = getCachedProjects<ProjectSession>().find((item) => item.id === tabSnapshot.id);
      const restored = !tabSnapshot.projectDocument && cachedSnapshot?.projectDocument ? cachedSnapshot : tabSnapshot;
      if (restored !== tabSnapshot) sessionStorage.setItem("carabasaiCreativeSession", JSON.stringify(restored));
      setSession(restored);
      setActiveSection((current) => current === "screenplay" || restored.projectDocument?.sections.some((item) => item.id === current) ? current : restored.screenplay ? "screenplay" : restored.projectDocument?.sections[0]?.id ?? "");
      const repairedScreenplay = restored.screenplay ? collapseDuplicateCharacterCues(restored.screenplay) : "";
      if (restored.screenplay && repairedScreenplay !== restored.screenplay) {
        restored.screenplay = repairedScreenplay;
        sessionStorage.setItem("carabasaiCreativeSession", JSON.stringify(restored));
        const repairedHistory = getCachedProjects<ProjectSession>().filter((item) => item.id !== restored.id);
        saveProjects([restored, ...repairedHistory].slice(0, 20));
      }
      setScreenplayDraft(repairedScreenplay);
      setActiveFeedbackId(restored.dialogueFeedback?.find((item) => !item.acceptedAt)?.id ?? "");
      if (restored.characterCastingSpecialist) {
        setActiveSpecialist(restored.characterCastingSpecialist);
        setSelectedDepartments(["CHARACTER CASTING"]);
      }
    };
    queueMicrotask(restore);
    window.addEventListener("carabasai-active-project-change", restore);
    return () => window.removeEventListener("carabasai-active-project-change", restore);
  }, []);

  useEffect(() => {
    if (!activeFeedbackId) return;
    const item = session?.dialogueFeedback?.find((feedback) => feedback.id === activeFeedbackId);
    if (!item) return;
    const timer = window.setTimeout(() => navigateToFeedback(item), 0);
    return () => { window.clearTimeout(timer); feedbackNavigationRef.current = false; };
  }, [activeFeedbackId, session?.dialogueFeedback, screenplayDraft]);

  function navigateToFeedback(item: DialogueFeedback) {
    const textarea = screenplayRef.current;
    if (!textarea) return;
    feedbackNavigationRef.current = true;
    setActiveFeedbackId(item.id);
    textarea.focus({ preventScroll: true });
    textarea.setSelectionRange(item.start, item.end);
    const selectionRatio = item.start / Math.max(1, screenplayDraft.length);
    const targetTop = Math.max(0, selectionRatio * textarea.scrollHeight - textarea.clientHeight * 0.42);
    textarea.scrollTo({ top: targetTop, behavior: "smooth" });
    window.setTimeout(() => {
      textarea.setSelectionRange(item.start, item.end);
      feedbackNavigationRef.current = false;
    }, 350);
  }

  useEffect(() => {
    if (!session?.screenplay || !screenplayDraft.trim() || screenplayDraft === session.screenplay) return;
    const timer = window.setTimeout(() => {
      const updated: ProjectSession = { ...session, screenplay: screenplayDraft };
      sessionStorage.setItem("carabasaiCreativeSession", JSON.stringify(updated));
      const history = getCachedProjects<ProjectSession>().filter((item) => item.id !== session.id);
      saveProjects([updated, ...history].slice(0, 20));
      setSession(updated);
    }, 700);
    return () => window.clearTimeout(timer);
  }, [screenplayDraft, session]);

  useEffect(() => {
    if (!session?.id || session.screenplay) return;
    let cancelled = false;
    let timer: number | undefined;
    const check = async () => {
      try {
        const response = await authenticatedFetch(`/api/screenplay-jobs?projectId=${encodeURIComponent(session.id ?? "")}`);
        const data = await response.json() as { status?: string; screenplay?: string; director_notes?: string; dialogue_audit?: string; error?: string };
        if (cancelled || !response.ok) return;
        if (data.status === "complete" && data.screenplay) {
          const updated: ProjectSession = { ...session, screenplay: data.screenplay, screenplayDirectorNotes: data.director_notes, dialogueAudit: data.dialogue_audit, screenplayGeneration: { status: "complete", completedAt: Date.now() } };
          sessionStorage.setItem("carabasaiCreativeSession", JSON.stringify(updated));
          const history = getCachedProjects<ProjectSession>().filter((item) => item.id !== session.id);
          saveProjects([updated, ...history].slice(0, 20));
          setSession(updated);
          setScreenplayDraft(data.screenplay);
          setIsGeneratingScreenplay(false);
          return;
        }
        if (data.status === "failed") {
          setIsGeneratingScreenplay(false);
          setError(data.error || "SCREENPLAY COULD NOT BE GENERATED.");
          return;
        }
        if (data.status === "generating") {
          setIsGeneratingScreenplay(true);
          timer = window.setTimeout(check, 4000);
        }
      } catch {
        timer = window.setTimeout(check, 6000);
      }
    };
    void check();
    return () => { cancelled = true; if (timer) window.clearTimeout(timer); };
  }, [session?.id, session?.screenplay, session?.screenplayGeneration?.status]);

  if (!session?.projectDocument) {
    return <main className="min-h-screen bg-[#050505] px-4 py-5 pt-20 text-white md:pl-[calc(var(--studio-sidebar-width,260px)+32px)] md:pt-5"><StudioSidebar /><WorkflowNav /><div className="flex min-h-[70vh] items-center justify-center p-6"><div className="text-center"><p className="text-xs font-black text-[#FFDF00]">NO PROJECT DOCUMENT</p><Link href="/studio/creative-room" className="mt-6 inline-flex rounded-full border border-white/15 px-6 py-3 text-xs font-black">RETURN TO CREATIVE ROOM</Link></div></div></main>;
  }

  const document = session.projectDocument;
  const section = document.sections.find((item) => item.id === activeSection) ?? document.sections[0];
  const showScreenplay = Boolean(session.screenplay && activeSection === "screenplay");

  function persistDocument(nextDocument: ProjectDocument) {
    if (!session) return;
    const updated: ProjectSession = { ...session, projectDocument: nextDocument };
    sessionStorage.setItem("carabasaiCreativeSession", JSON.stringify(updated));
    const history = getCachedProjects<ProjectSession>().filter((item) => item.id !== session.id);
    saveProjects([updated, ...history].slice(0, 20));
    setSession(updated);
  }

  function addScreenplayToLibrary() {
    if (!session || !screenplayDraft.trim()) return;
    const updated: ProjectSession = { ...session, screenplay: screenplayDraft, screenplayLibraryAt: session.screenplayLibraryAt ?? Date.now() };
    sessionStorage.setItem("carabasaiCreativeSession", JSON.stringify(updated));
    const history = getCachedProjects<ProjectSession>().filter((item) => item.id !== session.id);
    saveProjects([updated, ...history].slice(0, 20));
    setSession(updated);
  }

  function captureScriptSelection() {
    const textarea = screenplayRef.current;
    if (feedbackNavigationRef.current) return;
    if (!textarea || textarea.selectionStart === textarea.selectionEnd) {
      setSelectedScriptText(null);
      setFeedbackSentiment(null);
      return;
    }
    let start = textarea.selectionStart;
    let end = textarea.selectionEnd;
    while (start > 0 && isWordCharacter(screenplayDraft[start - 1]) && isWordCharacter(screenplayDraft[start])) start -= 1;
    while (end < screenplayDraft.length && isWordCharacter(screenplayDraft[end - 1]) && isWordCharacter(screenplayDraft[end])) end += 1;
    if (start !== textarea.selectionStart || end !== textarea.selectionEnd) textarea.setSelectionRange(start, end);
    setSelectedScriptText({
      text: screenplayDraft.slice(start, end),
      start,
      end,
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
    const updated: ProjectSession = { ...session, dialogueFeedback: [feedback, ...(session.dialogueFeedback ?? [])] };
    sessionStorage.setItem("carabasaiCreativeSession", JSON.stringify(updated));
    const history = getCachedProjects<ProjectSession>().filter((item) => item.id !== session.id);
    saveProjects([updated, ...history].slice(0, 20));
    setSession(updated);
    setActiveFeedbackId(feedback.id);
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
    window.setTimeout(() => {
      screenplayRef.current?.focus({ preventScroll: true });
      screenplayRef.current?.setSelectionRange(feedback.start, feedback.end);
    }, 0);
  }

  function removeDialogueFeedback(id: string) {
    if (!session) return;
    const updated: ProjectSession = { ...session, dialogueFeedback: (session.dialogueFeedback ?? []).filter((item) => item.id !== id) };
    sessionStorage.setItem("carabasaiCreativeSession", JSON.stringify(updated));
    const history = getCachedProjects<ProjectSession>().filter((item) => item.id !== session.id);
    saveProjects([updated, ...history].slice(0, 20));
    setSession(updated);
  }

  async function downloadScreenplay() {
    if (!screenplayDraft.trim() || isDownloadingScreenplay) return;
    setIsDownloadingScreenplay(true);
    setError("");
    try {
      const response = await authenticatedFetch("/api/screenplay-pdf", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: session?.projectDocument?.title,
          logline: session?.projectDocument?.logline,
          screenplay: screenplayDraft,
          director: session?.secondDirector.name,
          screenwriter: session?.screenwriter.name,
        }),
      });
      if (!response.ok) {
        const data = await response.json() as { error?: string };
        throw new Error(data.error || "PDF COULD NOT BE CREATED.");
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = window.document.createElement("a");
      anchor.href = url;
      anchor.download = `${session?.projectDocument?.title || "screenplay"} - Carabasai.pdf`;
      anchor.style.display = "none";
      window.document.body.appendChild(anchor);
      anchor.click();
      window.setTimeout(() => {
        anchor.remove();
        URL.revokeObjectURL(url);
      }, 30_000);
    } catch (downloadError) {
      setError(downloadError instanceof Error ? downloadError.message : "PDF COULD NOT BE CREATED.");
    } finally {
      setIsDownloadingScreenplay(false);
    }
  }

  async function createScreenplay() {
    if (!session || isGeneratingScreenplay) return;
    const confirmed = await platformConfirm({
      eyebrow: "SCREENPLAY",
      title: "CREATE FINAL SCREENPLAY?",
      message: "The approved brief will be used to create this project's one final screenplay. After it is ready, creative development and the Project Notebook will be locked. The agents remain available for consultation, but they will not change the screenplay. All further edits are made by you in the screenplay editor.",
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
      const response = await authenticatedFetch("/api/screenplay-jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId: session.id,
          brief: session.notes,
          genre,
          conversation: session.messages ?? [],
          notes: session.notebook ?? [],
          team: { secondDirector: session.secondDirector.name, screenwriter: session.screenwriter.name },
        }),
      });
      const data = await response.json() as { status?: string; screenplay?: string; director_notes?: string; dialogue_audit?: string; error?: string };
      if (!response.ok) throw new Error(data.error || "SCREENPLAY COULD NOT BE GENERATED.");
      const updated: ProjectSession = data.screenplay
        ? { ...session, screenplay: data.screenplay, screenplayDirectorNotes: data.director_notes, dialogueAudit: data.dialogue_audit, screenplayGeneration: { status: "complete", completedAt: Date.now() } }
        : { ...session, screenplayGeneration: { status: "generating", startedAt: Date.now() } };
      sessionStorage.setItem("carabasaiCreativeSession", JSON.stringify(updated));
      const history = getCachedProjects<ProjectSession>().filter((item) => item.id !== session.id);
      saveProjects([updated, ...history].slice(0, 20));
      setSession(updated);
      if (data.screenplay) {
        setScreenplayDraft(data.screenplay);
        setIsGeneratingScreenplay(false);
      }
    } catch (screenplayError) {
      setIsGeneratingScreenplay(false);
      setError(screenplayError instanceof Error ? screenplayError.message : "SCREENPLAY COULD NOT BE GENERATED.");
    }
  }

  async function rewriteScreenplayWithFeedback(onlyId?: string) {
    if (!session?.screenplay || isGeneratingScreenplay) return;
    const pending = (session.dialogueFeedback ?? []).filter((item) => item.sentiment === "bad" && !item.acceptedAt && (onlyId ? item.id === onlyId : !item.rewrittenText));
    if (!pending.length) return;
    const confirmed = onlyId || await platformConfirm({
      eyebrow: "DIALOGUE FEEDBACK",
      title: "REWRITE ONLY THE FLAGGED FRAGMENTS?",
      message: `The screenwriter will rewrite ${pending.length} BAD fragment${pending.length === 1 ? "" : "s"}. Every other character in the screenplay will remain unchanged.`,
      confirmLabel: "REWRITE FRAGMENTS",
    });
    if (!confirmed) return;
    setIsGeneratingScreenplay(true);
    setError("");
    try {
      const response = await authenticatedFetch("/api/dialogue-rewrite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: currentAIProvider(),
          screenwriter: session.screenwriter.name,
          fragments: pending.map((item) => ({
            id: item.id,
            text: item.text,
            category: item.category,
            context: screenplayDraft.slice(Math.max(0, item.start - 350), Math.min(screenplayDraft.length, item.end + 350)),
          })),
        }),
      });
      const data = await response.json() as { rewrites?: Array<{ id: string; replacement: string }>; error?: string };
      if (!response.ok || !data.rewrites?.length) throw new Error(data.error || "DIALOGUE FRAGMENTS COULD NOT BE REWRITTEN.");
      const replacements = new Map(data.rewrites.map((item) => [item.id, item.replacement.trim()]));
      let patched = screenplayDraft;
      const applied = new Map<string, string>();
      for (const item of [...pending].sort((a, b) => b.start - a.start)) {
        const replacement = replacements.get(item.id);
        if (!replacement) continue;
        let start = item.start;
        let end = item.end;
        if (patched.slice(start, end) !== item.text) {
          start = patched.indexOf(item.text);
          end = start + item.text.length;
        }
        if (start < 0) continue;
        patched = `${patched.slice(0, start)}${replacement}${patched.slice(end)}`;
        applied.set(item.id, replacement);
      }
      if (!applied.size) throw new Error("THE FLAGGED TEXT HAS CHANGED. SELECT THE FRAGMENTS AGAIN.");
      const rewrittenAt = Date.now();
      const updatedFeedback = (session.dialogueFeedback ?? []).map((item) => {
        const replacement = applied.get(item.id);
        if (!replacement) return item;
        const nextStart = patched.indexOf(replacement);
        return { ...item, previousText: item.text, text: replacement, start: nextStart >= 0 ? nextStart : item.start, end: nextStart >= 0 ? nextStart + replacement.length : item.start + replacement.length, rewrittenText: replacement, rewrittenAt, rewriteCount: (item.rewriteCount ?? 0) + 1, acceptedAt: undefined };
      });
      const updated: ProjectSession = { ...session, screenplay: patched, dialogueFeedback: updatedFeedback };
      sessionStorage.setItem("carabasaiCreativeSession", JSON.stringify(updated));
      const history = getCachedProjects<ProjectSession>().filter((item) => item.id !== session.id);
      saveProjects([updated, ...history].slice(0, 20));
      setSession(updated);
      setScreenplayDraft(patched);
      setSelectedScriptText(null);
      setActiveFeedbackId(pending[0]?.id ?? "");
    } catch (rewriteError) {
      setError(rewriteError instanceof Error ? rewriteError.message : "DIALOGUE FRAGMENTS COULD NOT BE REWRITTEN.");
    } finally {
      setIsGeneratingScreenplay(false);
    }
  }

  function acceptDialogueRewrite(id: string) {
    if (!session) return;
    const accepted = session.dialogueFeedback?.find((item) => item.id === id);
    const updated: ProjectSession = { ...session, dialogueFeedback: (session.dialogueFeedback ?? []).map((item) => item.id === id ? { ...item, acceptedAt: Date.now() } : item) };
    sessionStorage.setItem("carabasaiCreativeSession", JSON.stringify(updated));
    const history = getCachedProjects<ProjectSession>().filter((item) => item.id !== session.id);
    saveProjects([updated, ...history].slice(0, 20));
    setSession(updated);
    setActiveFeedbackId("");
    setSelectedScriptText(null);
    setFeedbackSentiment(null);
    window.setTimeout(() => {
      const textarea = screenplayRef.current;
      if (!textarea) return;
      const caret = Math.min(accepted?.end ?? textarea.selectionEnd, screenplayDraft.length);
      textarea.setSelectionRange(caret, caret);
      textarea.blur();
    }, 0);
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
        <section className="flex h-[calc(100dvh-11.25rem)] min-h-[560px] flex-col overflow-hidden rounded-[24px] border border-white/10 bg-[#090909] sm:rounded-[28px] lg:h-[calc(100dvh-12.5rem)] lg:min-h-[620px]">
          <div className="panel-header h-[210px] shrink-0 overflow-y-auto border-b border-white/10 bg-[#353535] p-6 sm:h-[228px] sm:p-8"><p className="text-[10px] font-black tracking-[0.16em] text-[#FFDF00]">{showScreenplay ? "FINAL SCREENPLAY" : "PROJECT SUMMARY"}</p><h1 className="mt-3 text-3xl font-black tracking-[-0.04em] sm:text-5xl">{document.title}</h1><p className="mt-5 max-w-3xl text-sm leading-7 text-white/55">{document.logline}</p><p className="mt-5 text-[9px] text-white/25">{session.secondDirector.name} + {session.screenwriter.name}</p></div>
          <div className="flex gap-2 overflow-x-auto border-b border-white/10 bg-[#303030] p-3 sm:px-6">
            {document.sections.map((item) => <button key={item.id} type="button" onClick={() => setActiveSection(item.id)} className={`shrink-0 rounded-full px-4 py-2 text-[9px] font-black tracking-[0.1em] ${item.id === activeSection ? "bg-[#FFDF00] text-black" : "border border-white/10 text-white/40"}`}>{item.title}</button>)}
            {session.screenplay && <button type="button" onClick={() => setActiveSection("screenplay")} className={`shrink-0 rounded-full px-5 py-2 text-[9px] font-black tracking-[0.1em] ${showScreenplay ? "bg-[#FFDF00] text-black shadow-[0_0_24px_rgba(255,223,0,0.2)]" : "border border-[#FFDF00]/35 text-[#FFDF00]"}`}>SCREENPLAY</button>}
          </div>
          <div className={`min-h-0 flex-1 overscroll-contain bg-[#090909] ${showScreenplay ? "overflow-hidden" : "overflow-y-auto p-5 sm:p-8"}`}>
            {showScreenplay ? (
              <div className="flex h-full min-h-0 flex-col">
                <div className="shrink-0 border-b border-white/10 bg-[#0d0d0d] p-5 sm:px-8 sm:py-5">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div><p className="text-[10px] font-black tracking-[0.16em] text-[#FFDF00]">FINAL SCREENPLAY</p><h2 className="mt-2 text-2xl font-black">EDIT THE SCRIPT</h2><p className="mt-2 text-xs leading-5 text-white/35">Changes are saved to this project and remain editable.</p><p className="mt-2 text-xs font-bold leading-5 text-[#FFDF00]/70">Select any passage to mark what works or what needs improvement.</p></div>
                  <div className="flex gap-2"><button type="button" onClick={() => void downloadScreenplay()} disabled={isDownloadingScreenplay} className="rounded-full border border-white/15 px-4 py-2 text-[9px] font-black text-white/55 hover:border-[#FFDF00]/40 hover:text-[#FFDF00] disabled:opacity-40">{isDownloadingScreenplay ? "CREATING PDF..." : "DOWNLOAD PDF"}</button><button type="button" onClick={addScreenplayToLibrary} className="rounded-full bg-[#FFDF00] px-5 py-2 text-[9px] font-black text-black">{session.screenplayLibraryAt ? "ADDED ✓" : "ADD TO MY SCREENPLAYS"}</button></div>
                </div>
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto p-5 sm:p-8">
                {selectedScriptText && <div className="sticky top-3 z-20 mt-4 w-fit max-w-full border border-[#FFDF00]/30 bg-[#11100a]/95 px-3 py-2 shadow-xl backdrop-blur-xl"><div className="flex min-w-0 items-center gap-3"><p className="max-w-[420px] truncate text-[9px] text-white/40">“{selectedScriptText.text.replace(/\s+/g, " ").slice(0, 140)}”</p><button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => setFeedbackSentiment("good")} className={`shrink-0 border px-3 py-1.5 text-[8px] font-black ${feedbackSentiment === "good" ? "border-emerald-400 bg-emerald-400 text-black" : "border-emerald-300/30 text-emerald-300"}`}>GOOD</button><button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => setFeedbackSentiment("bad")} className={`shrink-0 border px-3 py-1.5 text-[8px] font-black ${feedbackSentiment === "bad" ? "border-red-400 bg-red-400 text-black" : "border-red-300/30 text-red-300"}`}>BAD</button><button type="button" onClick={() => { setSelectedScriptText(null); setFeedbackSentiment(null); }} className="shrink-0 px-1 text-sm text-white/25">×</button></div>{feedbackSentiment && <div className="mt-2 flex max-w-[720px] flex-wrap gap-1.5 border-t border-white/10 pt-2">{(feedbackSentiment === "good" ? GOOD_DIALOGUE_CATEGORIES : BAD_DIALOGUE_CATEGORIES).map((category) => <button key={category} type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => saveDialogueFeedback(category)} className="border border-white/10 px-2 py-1.5 text-[7px] font-black text-white/60 transition hover:border-[#FFDF00]/40 hover:text-[#FFDF00]">{category}</button>)}</div>}</div>}
                <div className="relative mt-5 h-[clamp(260px,32dvh,420px)] overflow-hidden rounded-[20px] border border-[#FFDF00]/20 bg-black/35 transition focus-within:border-[#FFDF00]/60">
                  <pre ref={screenplayHighlightRef} aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden whitespace-pre-wrap break-words p-5 font-mono text-sm leading-7 text-white/85 sm:p-7">{highlightedScreenplay(screenplayDraft, selectedScriptText && feedbackSentiment ? [{ id: "active-selection", ...selectedScriptText, sentiment: feedbackSentiment, category: "PENDING", createdAt: Number.MAX_SAFE_INTEGER }, ...(session.dialogueFeedback ?? [])] : session.dialogueFeedback ?? [])}</pre>
                  <textarea ref={screenplayRef} value={screenplayDraft} onScroll={(event) => { if (screenplayHighlightRef.current) { screenplayHighlightRef.current.scrollTop = event.currentTarget.scrollTop; screenplayHighlightRef.current.scrollLeft = event.currentTarget.scrollLeft; } }} onSelect={captureScriptSelection} onMouseUp={captureScriptSelection} onKeyUp={captureScriptSelection} onChange={(event) => { setScreenplayDraft(event.target.value); setSelectedScriptText(null); }} spellCheck className="absolute inset-0 h-full w-full resize-none overflow-y-scroll bg-transparent p-5 font-mono text-sm leading-7 text-transparent caret-white outline-none [scrollbar-color:rgba(255,223,0,0.45)_rgba(255,255,255,0.05)] [scrollbar-width:thin] selection:bg-white/30 selection:text-transparent sm:p-7" aria-label="Editable and scrollable screenplay. Select text to rate it." />
                </div>
                </div>
                {(session.dialogueFeedback?.length ?? 0) > 0 && <section className="z-10 shrink-0 border-t border-white/10 bg-[#0d0d0d] p-4 shadow-[0_-18px_40px_rgba(0,0,0,0.55)] sm:px-6"><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-[9px] font-black tracking-[0.12em] text-[#FFDF00]">DIALOGUE FEEDBACK · {session.dialogueFeedback?.length}</p><p className="mt-1 text-[10px] text-white/30">Marked fragments remain with the project. Rewritten text stays gold until you approve it.</p></div><button type="button" onClick={() => void rewriteScreenplayWithFeedback()} disabled={isGeneratingScreenplay || !(session.dialogueFeedback ?? []).some((item) => item.sentiment === "bad" && !item.rewrittenText && !item.acceptedAt)} className="rounded-full bg-[#FFDF00] px-5 py-3 text-[9px] font-black text-black disabled:opacity-30">{isGeneratingScreenplay ? "REWRITING..." : "REWRITE BAD FRAGMENTS"}</button></div><div className="mt-3 max-h-36 space-y-2 overflow-y-auto pr-1 [scrollbar-color:rgba(255,223,0,0.35)_transparent] [scrollbar-width:thin]">{[...(session.dialogueFeedback ?? [])].sort((a, b) => b.createdAt - a.createdAt).map((item) => { const awaitingApproval = Boolean(item.rewrittenText && !item.acceptedAt); return <div key={item.id} onClick={() => navigateToFeedback(item)} className={`flex cursor-pointer items-start gap-3 rounded-[12px] border px-3 py-2 ${awaitingApproval ? "border-[#FFDF00]/60 bg-[#FFDF00]/[0.09]" : activeFeedbackId === item.id ? "border-white/25 bg-white/[0.04]" : "border-white/5"}`}><span className={`mt-0.5 shrink-0 rounded-full px-2 py-1 text-[7px] font-black ${awaitingApproval ? "bg-[#FFDF00] text-black" : item.acceptedAt || item.sentiment === "good" ? "bg-emerald-400/15 text-emerald-300" : "bg-red-400/15 text-red-300"}`}>{awaitingApproval ? "REWRITTEN" : item.acceptedAt ? "APPROVED" : item.sentiment.toUpperCase()} · {item.category}</span><div className="min-w-0 flex-1">{item.previousText && awaitingApproval && <p className="truncate text-[10px] text-white/25 line-through">{item.previousText.replace(/\s+/g, " ")}</p>}<p className={`mt-1 whitespace-pre-wrap text-[10px] leading-5 ${awaitingApproval ? "font-bold text-[#FFDF00]" : item.acceptedAt || item.sentiment === "good" ? "text-emerald-200/70" : "text-red-200/70"}`}>{item.text}</p></div>{awaitingApproval ? <div className="flex shrink-0 gap-1"><button type="button" onClick={(event) => { event.stopPropagation(); acceptDialogueRewrite(item.id); }} className="border border-[#FFDF00]/50 bg-[#FFDF00] px-3 py-1.5 text-[8px] font-black text-black">OK</button><button type="button" onClick={(event) => { event.stopPropagation(); void rewriteScreenplayWithFeedback(item.id); }} disabled={isGeneratingScreenplay} className="border border-white/15 px-3 py-1.5 text-[8px] font-black text-white/60 disabled:opacity-30">AGAIN</button></div> : <button type="button" onClick={(event) => { event.stopPropagation(); removeDialogueFeedback(item.id); }} className="text-sm text-white/20 hover:text-red-300">×</button>}</div>; })}</div></section>}
              </div>
            ) : (
            <>
            {session.screenplay && <div className="mb-5 border-l-2 border-[#FFDF00] bg-[#FFDF00]/5 px-4 py-3 text-[10px] font-bold text-white/45">The screenplay is complete. Summary decisions are now read-only.</div>}
            <h2 className="text-2xl font-black">{section.title}</h2>
            <p className="mt-3 max-w-3xl text-xs leading-6 text-white/40">{section.summary}</p>
            <ul className="mt-5 divide-y divide-white/[0.06]">{section.points.map((point, pointIndex) => {
              const pointId = `${section.id}:${pointIndex}`;
              const unresolved = isUnresolvedPoint(point);
              return <li key={pointId} className={`flex flex-wrap items-start gap-3 px-2 py-3 text-sm leading-6 ${highlightedPoints.includes(point) ? "bg-[#FFDF00]/5 text-[#FFDF00]" : "text-white/75"}`}><span className={unresolved ? "flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-red-400/15 text-xs font-black text-red-300" : "text-[#FFDF00]"}>{unresolved ? "!" : "✓"}</span>{editingPoint === pointId ? <input value={editingValue} onChange={(event) => setEditingValue(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") savePoint(section.id, pointIndex); if (event.key === "Escape") setEditingPoint(""); }} autoFocus className="min-w-0 flex-1 rounded-lg border border-[#FFDF00]/25 bg-black/30 px-2 py-1 text-sm text-white outline-none" /> : <span className="min-w-0 flex-1">{point}</span>}{!session.screenplay && <><button type="button" onClick={() => editingPoint === pointId ? savePoint(section.id, pointIndex) : (setEditingPoint(pointId), setEditingValue(point))} className="shrink-0 text-xs text-white/25 hover:text-[#FFDF00]">{editingPoint === pointId ? "✓" : "✎"}</button><button type="button" onClick={() => void platformConfirm({ eyebrow: "PROJECT DOCUMENT", title: "DELETE KEY POINT?", message: "This point will be removed from the current project document.", confirmLabel: "DELETE POINT", tone: "danger" }).then((confirmed) => { if (confirmed) deletePoint(section.id, pointIndex); })} className="shrink-0 text-sm text-white/15 hover:text-red-300" aria-label="Delete point">×</button>{unresolved && <div className="ml-8 w-full"><button type="button" onClick={() => askTeam({ id: pointId, label: section.title, question: `Помогите принять конкретное решение по пункту: ${point}` })} className="rounded-full border border-red-300/20 px-4 py-2 text-[8px] font-black text-red-200">ASK THE TEAM</button></div>}</>}</li>;
            })}</ul>
            </>
            )}
          </div>
          {!session.screenplay && <div className="shrink-0 border-t border-white/10 bg-[#0B0B0B] px-4 py-3 sm:px-6 sm:py-4">
            <div className="flex items-center gap-4">
              <p className="hidden min-w-0 flex-1 text-[10px] leading-5 text-white/35 sm:block">The screenplay brief is ready for the selected screenwriter and director.</p>
              {error && <p className="min-w-0 flex-1 truncate text-[10px] text-red-300" title={error}>{error}</p>}
              <button type="button" onClick={() => void createScreenplay()} disabled={isGeneratingScreenplay} className="ml-auto h-11 w-full shrink-0 rounded-full bg-[#FFDF00] px-6 text-[10px] font-black tracking-[0.12em] text-black shadow-[0_0_24px_rgba(255,223,0,0.12)] disabled:opacity-35 sm:w-auto sm:min-w-[280px]">{isGeneratingScreenplay ? "SCREENWRITER + DIRECTOR ARE WORKING..." : "CREATE SCREENPLAY"}</button>
            </div>
          </div>}
        </section>

        <aside className={`space-y-5 ${showScreenplay ? "[&>section:first-child:not(:last-child)]:hidden" : "[&>section:last-child]:hidden"}`}>
          {!session.screenplay && (document.openQuestions?.length ?? 0) > 0 && <section className="rounded-[28px] border border-[#FFDF00]/15 bg-[#FFDF00]/[0.025] p-5"><div className="flex items-center justify-between gap-3"><p className="text-[10px] font-black tracking-[0.16em] text-[#FFDF00]">UNRESOLVED KEY POINTS</p><button type="button" onClick={() => void letTeamDecideAll()} disabled={Boolean(resolvingQuestion)} className="rounded-full bg-[#FFDF00] px-3 py-2 text-[8px] font-black text-black disabled:opacity-30">{resolvingQuestion === "all" ? "DECIDING ALL..." : "LET TEAM DECIDE ALL"}</button></div><div className="mt-4 space-y-3">{document.openQuestions?.map((question) => <div key={question.id} className="rounded-[16px] border border-white/10 bg-black/20 p-4"><p className="text-[9px] font-black text-white/40">{question.label}</p><p className="mt-2 text-xs leading-5 text-white/70">{question.question}</p><div className="mt-4 grid grid-cols-2 gap-2"><button type="button" onClick={() => askTeam(question)} className="rounded-full border border-white/10 px-3 py-2 text-[8px] font-black text-white/55">ASK THE TEAM</button><button type="button" onClick={() => void letTeamDecide(question)} disabled={Boolean(resolvingQuestion)} className="rounded-full bg-[#FFDF00] px-3 py-2 text-[8px] font-black text-black disabled:opacity-30">{resolvingQuestion === question.id ? "DECIDING..." : "LET TEAM DECIDE"}</button></div></div>)}</div>{error && <p className="mt-4 text-[9px] text-red-300">{error}</p>}</section>}
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
