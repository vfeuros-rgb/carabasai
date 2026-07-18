"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useRef, useState } from "react";
import AIProviderSwitch, { currentAIProvider } from "../AIProviderSwitch";
import { authenticatedFetch } from "../../../lib/authenticated-fetch";
import StudioSidebar from "../../components/StudioSidebar";
import WorkflowNav from "../../components/WorkflowNav";
import { deleteProject, getCachedProjects, saveProjects, setProjectFavorite, syncProjects } from "../../../lib/project-store";
import { platformConfirm } from "../../../lib/platform-dialog";

type AgentId = "secondDirector" | "screenwriter";

type CrewMember = {
  id?: string;
  name: string;
  specialty: string;
  description: string;
  image?: string;
  influences: string[];
  biography: string;
  worldview: string;
  method: string;
  voice: string;
  speechRules: string;
  creativeFriction: string;
};

const CREATIVE_RELATIONSHIPS: Record<string, { label: string; description: string }> = {
  "GRISHA PRAVDIN|VERA SUVOROVA": {
    label: "POWERFUL PAIR",
    description: "His hard realism tests the world. Her lived-in dialogue makes its people painfully specific.",
  },
  "AMBROSE PEAK|VERA SUVOROVA": {
    label: "QUIETLY DANGEROUS PAIR",
    description: "He uncovers the buried wound. She makes its damage tangible in ordinary life.",
  },
  "AMBROSE PEAK|CLARA WAKE": {
    label: "PERFECT HORROR ENGINE",
    description: "He controls the dread. She reveals the system that made the monster inevitable.",
  },
};

type CreativeSession = {
  id?: string;
  startedAt?: number;
  title?: string;
  notes: string;
  secondDirector: CrewMember;
  screenwriter: CrewMember;
  references: Array<{ name: string; type: string; size: number; dataUrl?: string }>;
  notebook?: NotebookNote[];
  messages?: Message[];
  favorite?: boolean;
  projectDocument?: unknown;
  draftQuestion?: string;
  coverPath?: string;
  coverModel?: string;
  screenplay?: string;
  screenplayDirectorNotes?: string;
};

const CURRENT_COVER_MODEL = "flux-2-dev-16x9-v3";

type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
  speaker?: AgentId;
  hidden?: boolean;
  attachments?: ChatAttachment[];
};

type ChatAttachment = {
  name: string;
  type: string;
  dataUrl: string;
};

type NotebookNote = {
  id: string;
  author: AgentId;
  title: string;
  detail: string;
  accepted: boolean;
};

const INITIAL_AGENTS: Record<AgentId, boolean> = {
  secondDirector: true,
  screenwriter: true,
};

function createId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

async function requestProjectDocument(payload: unknown) {
  let lastError = "COULD NOT BUILD PROJECT DOCUMENT.";
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await authenticatedFetch("/api/project-document", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...(payload as object), provider: currentAIProvider() }),
      });
      const data = await response.json();
      if (response.ok) return data;
      lastError = data.error ?? lastError;
      if (![429, 500, 502, 503, 504].includes(response.status)) break;
    } catch (requestError) {
      lastError = requestError instanceof Error ? requestError.message : lastError;
    }
    await new Promise((resolve) => window.setTimeout(resolve, 700 * (attempt + 1)));
  }
  throw new Error(lastError);
}

function Portrait({ member }: { member: CrewMember }) {
  if (member.image) {
    return (
      <Image
        src={member.image}
        alt={member.name}
        width={48}
        height={48}
        className="h-12 w-12 rounded-full border border-white/10 object-cover"
      />
    );
  }

  return (
    <div className="flex h-12 w-12 items-center justify-center rounded-full border border-white/10 bg-[#FFDF00]/10 text-xs font-black text-[#FFDF00]">
      {member.name
        .split(" ")
        .map((word) => word[0])
        .join("")}
    </div>
  );
}

function AttachmentPreview({
  file,
  dark = false,
}: {
  file: { name: string; type: string; dataUrl?: string };
  dark?: boolean;
}) {
  if (file.type.startsWith("image/") && file.dataUrl) {
    return (
      <div className="w-32 overflow-hidden rounded-[12px] border border-white/10 bg-black/20">
        <Image
          src={file.dataUrl}
          alt={file.name}
          width={256}
          height={160}
          unoptimized
          className="h-20 w-full object-cover"
        />
        <p className={`truncate px-2 py-2 text-[8px] font-black uppercase ${dark ? "text-black/55" : "text-white/45"}`}>
          {file.name}
        </p>
      </div>
    );
  }

  return (
    <div className={`flex max-w-48 items-center gap-2 rounded-[12px] border px-3 py-2 ${dark ? "border-black/10 bg-black/5 text-black/55" : "border-white/10 bg-black/20 text-white/45"}`}>
      <span className="text-base">▧</span>
      <span className="truncate text-[8px] font-black uppercase">{file.name}</span>
    </div>
  );
}

export default function CreativeRoomPage() {
  const router = useRouter();
  const [session, setSession] = useState<CreativeSession | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [typingAgent, setTypingAgent] = useState<AgentId | null>(null);
  const [notebook, setNotebook] = useState<NotebookNote[]>([]);
  const [mobileNotebookOpen, setMobileNotebookOpen] = useState(false);
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const attachmentInputRef = useRef<HTMLInputElement>(null);
  const [enabledAgents, setEnabledAgents] =
    useState<Record<AgentId, boolean>>(INITIAL_AGENTS);
  const hasStarted = useRef(false);
  const [sessionHistory, setSessionHistory] = useState<CreativeSession[]>([]);
  const [historyWidth, setHistoryWidth] = useState(240);
  const [historyCollapsed, setHistoryCollapsed] = useState(false);
  const [mobileHistoryOpen, setMobileHistoryOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [expandedSessionId, setExpandedSessionId] = useState<string | null>(null);
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState("");
  const [isBuildingDocument, setIsBuildingDocument] = useState(false);
  const [showDocumentConfirm, setShowDocumentConfirm] = useState(false);
  const [documentBuildFailed, setDocumentBuildFailed] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesScrollRef = useRef<HTMLDivElement>(null);
  const notebookScrollRef = useRef<HTMLDivElement>(null);
  const coverGenerationStarted = useRef(new Set<string>());

  useEffect(() => {
    const notebookScroller = notebookScrollRef.current;
    if (!notebookScroller || notebook.length === 0) return;
    notebookScroller.scrollTo({ top: notebookScroller.scrollHeight, behavior: "smooth" });
  }, [notebook.length]);

  useEffect(() => {
    if (!session?.id || !session.notes.trim()) return;
    if (session.coverPath && session.coverModel === CURRENT_COVER_MODEL) return;
    if (coverGenerationStarted.current.has(session.id)) return;

    coverGenerationStarted.current.add(session.id);
    void authenticatedFetch("/api/project-cover", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectId: session.id,
        brief: session.notes,
        director: session.secondDirector.name,
        screenwriter: session.screenwriter.name,
      }),
    }).then(async (response) => {
      const payload = await response.json() as {
        coverPath?: string;
        coverModel?: string;
        title?: string;
        error?: string;
      };
      if (!response.ok || !payload.coverPath) {
        throw new Error(payload.error || "PROJECT COVER COULD NOT BE GENERATED.");
      }

      const coverModel = payload.coverModel ?? CURRENT_COVER_MODEL;
      const updatedSession: CreativeSession = {
        ...session,
        ...(payload.title ? { title: payload.title } : {}),
        coverPath: payload.coverPath,
        coverModel,
      };
      sessionStorage.setItem("carabasaiCreativeSession", JSON.stringify(updatedSession));
      const updatedProjects = getCachedProjects<CreativeSession>().map((project) =>
        project.id === session.id ? updatedSession : project
      );
      saveProjects(updatedProjects);
      setSession(updatedSession);
      setSessionHistory(updatedProjects);
    }).catch((coverError) => {
      // The conversation remains fully usable when the image provider is
      // temporarily unavailable. A later account visit can retry the cover.
      console.error("Background project cover generation failed", coverError);
      coverGenerationStarted.current.delete(session.id!);
    });
  }, [session]);

  useEffect(() => {
    const storedSession = sessionStorage.getItem("carabasaiCreativeSession");
    if (!storedSession) return;

    try {
      const restoredSession = JSON.parse(storedSession) as CreativeSession;
      if (!restoredSession.id) {
        restoredSession.id = createId();
        restoredSession.startedAt = Date.now();
        restoredSession.title = restoredSession.notes.slice(0, 42);
      }
      // This state is intentionally restored once from the browser-only session store.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSession(restoredSession);
      setNotebook(restoredSession.notebook ?? []);
      setMessages(restoredSession.messages ?? []);
      if (restoredSession.draftQuestion) {
        setDraft(restoredSession.draftQuestion);
        delete restoredSession.draftQuestion;
        sessionStorage.setItem("carabasaiCreativeSession", JSON.stringify(restoredSession));
      }
      const storedHistory = getCachedProjects<CreativeSession>();
      setSessionHistory([
        restoredSession,
        ...storedHistory.filter((item) => item.id !== restoredSession.id),
      ].slice(0, 20));
      void syncProjects<CreativeSession>().then(setSessionHistory).catch(console.error);
      const savedWidth = Number(localStorage.getItem("carabasaiHistoryWidth"));
      if (savedWidth >= 220 && savedWidth <= 480) setHistoryWidth(savedWidth);
      setHistoryCollapsed(localStorage.getItem("carabasaiHistoryCollapsed") === "true");
      if (restoredSession.messages?.length) hasStarted.current = true;
    } catch {
      sessionStorage.removeItem("carabasaiCreativeSession");
    }
  }, []);

  useEffect(() => {
    if (!session) return;
    const savedSession = { ...session, notebook, messages };
    sessionStorage.setItem(
      "carabasaiCreativeSession",
      JSON.stringify(savedSession)
    );
    const history = getCachedProjects<CreativeSession>()
      .filter((item) => item.id !== session.id);
    const nextHistory = [savedSession, ...history].slice(0, 20);
    saveProjects(nextHistory);
  }, [messages, notebook, session]);

  function openSavedSession(saved: CreativeSession) {
    hasStarted.current = Boolean(saved.messages?.length);
    setSession(saved);
    setMessages(saved.messages ?? []);
    setNotebook(saved.notebook ?? []);
    setError("");
  }

  function openSavedSummary(saved: CreativeSession) {
    sessionStorage.setItem("carabasaiCreativeSession", JSON.stringify(saved));
    router.push("/studio/project");
  }

  function updateSessionHistory(id: string | undefined, action: "favorite" | "delete") {
    if (!id) return;
    if (id === session?.id && action === "favorite") {
      setSession((current) => current ? { ...current, favorite: !current.favorite } : current);
    }
    setSessionHistory((current) => {
      const updated = action === "delete"
        ? current.filter((item) => item.id !== id)
        : current.map((item) => item.id === id ? { ...item, favorite: !item.favorite } : item);
      const sorted = [...updated].sort((a, b) => Number(Boolean(b.favorite)) - Number(Boolean(a.favorite)));
      if (action === "favorite") {
        const favorite = Boolean(sorted.find((item) => item.id === id)?.favorite);
        void setProjectFavorite(id, favorite).catch(console.error);
      }
      if (action === "delete") void deleteProject(id);
      return sorted;
    });
    if (id === session?.id && action === "delete") {
      sessionStorage.removeItem("carabasaiCreativeSession");
      window.location.assign("/studio");
    }
  }

  function saveSessionTitle(id: string | undefined) {
    if (!id || !editingTitle.trim()) return;
    setSessionHistory((current) => {
      const updated = current.map((item) => item.id === id ? { ...item, title: editingTitle.trim() } : item);
      saveProjects(updated);
      return updated;
    });
    if (id === session?.id) setSession((current) => current ? { ...current, title: editingTitle.trim() } : current);
    setEditingSessionId(null);
  }

  function resizeHistory(event: React.PointerEvent<HTMLButtonElement>) {
    event.currentTarget.setPointerCapture(event.pointerId);
    const startX = event.clientX;
    const startWidth = historyWidth;
    const move = (moveEvent: PointerEvent) =>
      setHistoryWidth(Math.min(480, Math.max(220, startWidth + moveEvent.clientX - startX)));
    const stop = () => {
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", stop);
    };
    document.addEventListener("pointermove", move);
    document.addEventListener("pointerup", stop);
  }

  function toggleHistory() {
    setHistoryCollapsed((current) => {
      localStorage.setItem("carabasaiHistoryCollapsed", String(!current));
      return !current;
    });
  }

  useEffect(() => {
    const container = messagesScrollRef.current;
    if (container) container.scrollTo({ top: container.scrollHeight, behavior: "smooth" });
  }, [messages, isLoading, error]);

  async function requestAgentResponse(
    activeSession: CreativeSession,
    conversation: Message[],
    activeAgents: Record<AgentId, boolean>
  ) {
    setIsLoading(true);
    setError("");

    try {
      const response = await authenticatedFetch("/api/creative-room", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: currentAIProvider(),
          session: activeSession,
          messages: conversation.map(({ role, content, speaker, attachments: files }) => ({
            role,
            content:
              role === "assistant" && speaker
                ? `${speaker}: ${content}`
                : content,
            attachments: files,
          })),
          enabledAgents: (Object.keys(activeAgents) as AgentId[]).filter(
            (agent) => activeAgents[agent]
          ),
        }),
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error ?? "THE CREATIVE AGENTS COULD NOT RESPOND.");
      }

      const incomingMessages = data.messages as Array<{
        speaker: AgentId;
        content: string;
      }>;

      for (const [messageIndex, message] of incomingMessages.entries()) {
        setTypingAgent(message.speaker);
        await new Promise((resolve) =>
          window.setTimeout(
            resolve,
            messageIndex === 0
              ? Math.min(420, 140 + message.content.length * 2)
              : Math.min(1450, 520 + message.content.length * 6)
          )
        );
        setMessages((current) => [
          ...current,
          {
            id: createId(),
            role: "assistant",
            speaker: message.speaker,
            content: message.content,
          },
        ]);
        await new Promise((resolve) => window.setTimeout(resolve, messageIndex === 0 ? 260 : 420));
      }

      setTypingAgent(null);
      setNotebook((current) => {
        const incomingNotes = (
          (data.notes ?? []) as Array<{
            author: AgentId;
            title: string;
            detail: string;
          }>
        );
        const merged = [...current];
        for (const note of incomingNotes) {
          const normalizedTitle = note.title.trim().toLowerCase();
          const existingIndex = merged.findIndex((item) => item.title.trim().toLowerCase() === normalizedTitle);
          const nextNote = { ...note, id: existingIndex >= 0 ? merged[existingIndex].id : createId(), accepted: true };
          if (existingIndex >= 0) merged[existingIndex] = nextNote;
          else merged.push(nextNote);
        }
        return merged;
      });
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "THE CREATIVE AGENTS COULD NOT RESPOND."
      );
    } finally {
      setTypingAgent(null);
      setIsLoading(false);
    }
  }

  useEffect(() => {
    if (!session || hasStarted.current) return;
    hasStarted.current = true;

    const openingMessage: Message = {
      id: createId(),
      role: "user",
      content:
        "Начните рабочую сессию без философского вступления. Сначала определите, какой конкретики не хватает в брифе. Коротко назовите это и задайте один или два простых главных вопроса о проекте. Если бриф уже достаточно конкретный, предложите ближайшее практическое решение.",
      hidden: true,
      attachments: session.references
        .filter((file) => file.dataUrl)
        .map((file) => ({
          name: file.name,
          type: file.type,
          dataUrl: file.dataUrl as string,
        })),
    };
    setMessages([openingMessage]);
    void requestAgentResponse(session, [openingMessage], INITIAL_AGENTS);
  }, [session]);

  async function sendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const content = draft.trim();
    if ((!content && attachments.length === 0) || !session || isLoading) return;

    const nextMessage: Message = {
      id: createId(),
      role: "user",
      content,
      attachments,
    };
    const nextConversation = [...messages, nextMessage];
    setMessages(nextConversation);
    setDraft("");
    setAttachments([]);
    await requestAgentResponse(session, nextConversation, enabledAgents);
  }

  async function addAttachments(files: FileList | null) {
    if (!files) return;
    const accepted = Array.from(files).filter(
      (file) =>
        (file.type.startsWith("image/") ||
          file.type === "application/pdf" ||
          file.type.startsWith("text/")) &&
        file.size <= 8 * 1024 * 1024
    );
    const loaded = await Promise.all(
      accepted.slice(0, 4).map(
        (file) =>
          new Promise<ChatAttachment>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () =>
              resolve({ name: file.name, type: file.type, dataUrl: String(reader.result) });
            reader.onerror = () => reject(reader.error);
            reader.readAsDataURL(file);
          })
      )
    );
    setAttachments((current) => [...current, ...loaded].slice(0, 4));
    if (attachmentInputRef.current) attachmentInputRef.current.value = "";
  }

  async function buildProjectDocument() {
    if (!session || isLoading || isBuildingDocument) return;
    const acceptedNotes = notebook.filter((note) => note.accepted);
    if (acceptedNotes.length === 0) {
      setError("SELECT AT LEAST ONE PROJECT NOTE BEFORE CONTINUING.");
      return;
    }
    setIsBuildingDocument(true);
    setError("");
    setDocumentBuildFailed(false);
    try {
      const data = await requestProjectDocument({
          brief: session.notes,
          messages: messages.filter((message) => !message.hidden).map(({ role, content, speaker }) => ({ role, content, speaker })),
          notes: acceptedNotes,
          team: { secondDirector: session.secondDirector.name, screenwriter: session.screenwriter.name },
          existingDocument: session.projectDocument,
      });
      const completedSession = { ...session, notebook, messages, projectDocument: data };
      sessionStorage.setItem("carabasaiCreativeSession", JSON.stringify(completedSession));
      const history = getCachedProjects<CreativeSession>().filter((item) => item.id !== session.id);
      saveProjects([completedSession, ...history].slice(0, 20));
      router.push("/studio/project");
    } catch (documentError) {
      setDocumentBuildFailed(true);
      setError(documentError instanceof Error ? documentError.message : "COULD NOT BUILD PROJECT DOCUMENT.");
    } finally {
      setIsBuildingDocument(false);
    }
  }

  function toggleAgent(agent: AgentId) {
    if (isLoading) return;
    setEnabledAgents((current) => {
      const enabledCount = Object.values(current).filter(Boolean).length;
      if (current[agent] && enabledCount === 1) return current;
      return { ...current, [agent]: !current[agent] };
    });
  }

  function toggleNote(id: string) {
    setNotebook((current) =>
      current.map((note) =>
        note.id === id ? { ...note, accepted: !note.accepted } : note
      )
    );
  }

  if (!session) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#050505] px-5 text-white">
        <div className="max-w-lg text-center">
          <p className="text-xs font-black uppercase tracking-[0.22em] text-[#FFDF00]">
            CREATIVE ROOM
          </p>
          <h1 className="mt-5 text-4xl font-black uppercase tracking-[-0.05em]">
            NO ACTIVE SESSION
          </h1>
          <p className="mt-5 text-sm uppercase leading-7 text-white/45">
            ASSEMBLE YOUR CREATIVE LEADERSHIP AND ADD A PROJECT BRIEF FIRST.
          </p>
          <Link
            href="/studio"
            className="mt-8 inline-flex min-h-12 items-center rounded-full bg-[#FFDF00] px-7 text-sm font-black uppercase text-black"
          >
            RETURN TO STUDIO
          </Link>
        </div>
      </main>
    );
  }

  const agents = [
    ["secondDirector", session.secondDirector],
    ["screenwriter", session.screenwriter],
  ] as const;
  const relationship = CREATIVE_RELATIONSHIPS[
    `${session.secondDirector.name}|${session.screenwriter.name}`
  ];

  return (
    <main className="min-h-screen bg-[#050505] px-4 py-5 pt-20 text-white sm:px-8 md:pl-[calc(var(--studio-sidebar-width,260px)+32px)] md:pt-5 lg:pr-12">
      <StudioSidebar />
      <WorkflowNav />
      {!mobileHistoryOpen && (
        <button type="button" onClick={() => setMobileMenuOpen(true)} className="hidden" aria-label="Open menu" />
      )}
      {mobileMenuOpen && (
        <div className="hidden">
          <button type="button" aria-label="Close mobile menu" onClick={() => setMobileMenuOpen(false)} className="absolute inset-0 bg-black/25" />
          <div className="absolute right-4 top-16 w-[min(320px,calc(100vw-32px))] rounded-[20px] border border-white/10 bg-[#0B0B0B]/98 p-4 shadow-2xl">
            <div className="flex items-center justify-between">
              <p className="text-[10px] font-black tracking-[0.16em] text-[#FFDF00]">CARABASAI MENU</p>
              <button type="button" onClick={() => setMobileMenuOpen(false)} className="h-9 w-9 rounded-full border border-white/10 text-white/45">×</button>
            </div>
            <Link href="/studio" className="mt-4 flex w-full items-center justify-between rounded-[14px] border border-white/10 bg-white/[0.03] px-4 py-3 text-[10px] font-black tracking-[0.1em] text-white/75">NEW SESSION <span className="text-[#FFDF00]">+</span></Link>
            <Link href="/account" className="mt-2 flex w-full items-center justify-between rounded-[14px] border border-white/10 bg-white/[0.03] px-4 py-3 text-[10px] font-black tracking-[0.1em] text-white/75">ACCOUNT <span className="text-[#FFDF00]">→</span></Link>
            <button type="button" onClick={() => { setMobileMenuOpen(false); setHistoryCollapsed((current) => { localStorage.setItem("carabasaiHistoryCollapsed", String(!current)); return !current; }); }} className="mt-2 hidden w-full items-center justify-between rounded-[14px] border border-white/10 bg-white/[0.03] px-4 py-3 text-left text-[10px] font-black tracking-[0.1em] text-white/75 xl:flex">SESSION HISTORY <span className="text-[#FFDF00]">{historyCollapsed ? "+" : "−"}</span></button>
            <p className="mt-4 border-t border-white/10 pt-4 text-[9px] font-black tracking-[0.12em] text-white/35 xl:hidden">SESSION HISTORY</p>
            <div className="mt-3 max-h-[48vh] space-y-2 overflow-y-auto xl:hidden">
              {sessionHistory.map((saved) => (
                <div key={saved.id ?? saved.startedAt} className={`flex items-center gap-2 rounded-[13px] border p-2 ${saved.id === session.id ? "border-[#FFDF00]/30 bg-[#FFDF00]/5" : "border-white/10 bg-white/[0.03]"}`}>
                  {editingSessionId === saved.id ? (
                    <input value={editingTitle} onChange={(event) => setEditingTitle(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") saveSessionTitle(saved.id); if (event.key === "Escape") setEditingSessionId(null); }} autoFocus className="min-w-0 flex-1 rounded-lg border border-[#FFDF00]/30 bg-black/40 px-2 py-2 text-[10px] text-white outline-none" />
                  ) : (
                    <button type="button" onClick={() => { setMobileMenuOpen(false); openSavedSession(saved); }} className="min-w-0 flex-1 px-2 py-2 text-left"><p className="truncate text-[10px] font-black text-white/70">{saved.title || saved.notes}</p><p className="mt-1 text-[8px] text-white/25">{saved.startedAt ? new Date(saved.startedAt).toLocaleDateString("en-GB") : ""}</p></button>
                  )}
                  <button type="button" onClick={() => editingSessionId === saved.id ? saveSessionTitle(saved.id) : (setEditingSessionId(saved.id ?? null), setEditingTitle(!saved.title || saved.title === saved.notes.slice(0, 42) ? saved.notes : saved.title))} className="h-8 w-7 shrink-0 text-xs text-white/30" aria-label="Edit session title">{editingSessionId === saved.id ? "✓" : "✎"}</button>
                  {Boolean(saved.projectDocument) && <button type="button" onClick={() => { setMobileMenuOpen(false); openSavedSummary(saved); }} className="h-8 w-8 text-xs text-[#FFDF00]" aria-label="Open summary">▤</button>}
                  <button type="button" onClick={() => updateSessionHistory(saved.id, "favorite")} className={`h-8 w-8 text-base ${saved.favorite ? "text-[#FFDF00]" : "text-white/20"}`} aria-label="Favorite session">★</button>
                  <button type="button" onClick={() => void platformConfirm({ eyebrow: "SESSION HISTORY", title: "DELETE SESSION?", message: "This creative session will be permanently removed.", confirmLabel: "DELETE SESSION", tone: "danger" }).then((confirmed) => { if (confirmed) updateSessionHistory(saved.id, "delete"); })} className="h-8 w-7 shrink-0 text-sm text-white/20" aria-label="Delete session">×</button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
      {mobileHistoryOpen && <button type="button" aria-label="Close history overlay" onClick={() => setMobileHistoryOpen(false)} className="fixed inset-0 z-20 bg-black/70 xl:hidden" />}
      {historyCollapsed && !mobileHistoryOpen ? (
        <button type="button" onClick={toggleHistory} className="fixed left-0 top-6 z-40 hidden h-12 w-11 items-center justify-center rounded-r-full border border-l-0 border-white/10 bg-[#111] text-[#FFDF00] xl:flex" aria-label="Open session history">›</button>
      ) : (
      <nav className="hidden" style={{ width: historyWidth }}>
        <div className="flex items-center justify-between gap-3">
          <p className="text-[10px] font-black uppercase tracking-[0.15em] text-[#FFDF00]">
            SESSION HISTORY
          </p>
          <div className="flex shrink-0 items-center gap-2">
            <Link href="/studio" className="rounded-full px-2 py-2 text-[9px] font-black uppercase text-white/35 hover:text-[#FFDF00]">
              + NEW
            </Link>
            <button type="button" onClick={() => { if (window.innerWidth < 1280) setMobileHistoryOpen(false); else toggleHistory(); }} className="flex h-8 w-8 items-center justify-center rounded-full border border-white/10 text-lg text-white/30 hover:text-white" aria-label="Close session history">‹</button>
          </div>
        </div>
        <div className="mt-6 flex-1 space-y-2 overflow-y-auto">
          {[...sessionHistory].sort((a, b) => Number(Boolean(b.favorite)) - Number(Boolean(a.favorite))).map((saved) => (
            <div
              key={saved.id ?? saved.startedAt}
              className={`group flex w-full items-center gap-1 rounded-[14px] border p-2 transition ${
                saved.id === session.id
                  ? "border-[#FFDF00]/30 bg-[#FFDF00]/5"
                  : "border-white/5 bg-white/[0.025] hover:border-white/15"
              }`}
            >
              <div className="min-w-0 flex-1 px-1 py-1">
                {editingSessionId === saved.id ? (
                  <input value={editingTitle} onChange={(event) => setEditingTitle(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") saveSessionTitle(saved.id); if (event.key === "Escape") setEditingSessionId(null); }} autoFocus className="w-full rounded-lg border border-[#FFDF00]/30 bg-black/40 px-2 py-2 text-[10px] text-white outline-none" />
                ) : (
                  <button type="button" onClick={() => openSavedSession(saved)} className="w-full text-left">
                    <p className={`${expandedSessionId === saved.id ? "whitespace-pre-wrap break-words" : "truncate"} text-[10px] font-black text-white/70`}>{expandedSessionId === saved.id && saved.title === saved.notes.slice(0, 42) ? saved.notes : saved.title || saved.notes}</p>
                    <p className="mt-2 truncate text-[8px] uppercase text-white/25">{saved.secondDirector.name} + {saved.screenwriter.name}</p>
                  </button>
                )}
                {expandedSessionId === saved.id && (
                  <div className="mt-3 border-t border-white/8 pt-3">
                    <p className="mt-3 text-[8px] uppercase tracking-[0.08em] text-white/25">{saved.startedAt ? new Date(saved.startedAt).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" }) : "DATE NOT RECORDED"}</p>
                  </div>
                )}
              </div>
              <button type="button" onClick={() => editingSessionId === saved.id ? saveSessionTitle(saved.id) : (setEditingSessionId(saved.id ?? null), setEditingTitle(!saved.title || saved.title === saved.notes.slice(0, 42) ? saved.notes : saved.title))} className="h-8 w-8 shrink-0 text-xs text-white/25 hover:text-white" aria-label={editingSessionId === saved.id ? "Save session title" : "Edit session title"}>{editingSessionId === saved.id ? "✓" : "✎"}</button>
              <button type="button" onClick={() => setExpandedSessionId((current) => current === saved.id ? null : saved.id ?? null)} className="h-8 w-8 shrink-0 text-sm text-white/30 hover:text-white" aria-label={expandedSessionId === saved.id ? "Collapse session details" : "Expand session details"}>{expandedSessionId === saved.id ? "⌃" : "⌄"}</button>
              {Boolean(saved.projectDocument) && <button type="button" onClick={() => openSavedSummary(saved)} className="h-8 w-8 shrink-0 text-xs text-[#FFDF00]" aria-label="Open summary">▤</button>}
              <button type="button" onClick={() => updateSessionHistory(saved.id, "favorite")} className={`h-8 w-8 shrink-0 text-base ${saved.favorite ? "text-[#FFDF00]" : "text-white/20 hover:text-[#FFDF00]"}`} aria-label={saved.favorite ? "Remove from favorites" : "Add to favorites"}>★</button>
              <button type="button" onClick={() => void platformConfirm({ eyebrow: "SESSION HISTORY", title: "DELETE SESSION?", message: "This creative session will be permanently removed.", confirmLabel: "DELETE SESSION", tone: "danger" }).then((confirmed) => { if (confirmed) updateSessionHistory(saved.id, "delete"); })} className="h-8 w-8 shrink-0 text-sm text-white/15 hover:text-red-300" aria-label="Delete session">×</button>
            </div>
          ))}
        </div>
        <p className="border-t border-white/10 pt-4 text-[8px] uppercase leading-4 text-white/20">
          SAVED IN THIS BROWSER
        </p>
        <button type="button" onPointerDown={resizeHistory} onPointerUp={() => localStorage.setItem("carabasaiHistoryWidth", String(historyWidth))} className="absolute bottom-0 right-0 top-0 w-2 cursor-col-resize touch-none hover:bg-[#FFDF00]/20" aria-label="Resize session history" />
      </nav>
      )}
      <div className="mx-auto grid h-[calc(100dvh-11.25rem)] min-h-[540px] w-full max-w-7xl grid-rows-[auto_minmax(0,1fr)] gap-2 md:h-[calc(100dvh-5.5rem)] md:min-h-0 lg:grid-cols-[320px_1fr] lg:grid-rows-1 lg:gap-5">
        <aside className="hidden space-y-4 lg:block lg:max-h-full lg:self-start lg:overflow-y-auto lg:pr-1">
          {agents.map(([agent, member], index) => (
            <div
              key={member.name}
              className={`rounded-[24px] border bg-white/[0.025] p-5 transition ${
                enabledAgents[agent]
                  ? "border-white/10 opacity-100"
                  : "border-white/5 opacity-45"
              }`}
            >
              <div className="flex items-center gap-4">
                <Portrait member={member} />
                <div className="min-w-0">
                  <p className="text-[10px] font-black uppercase tracking-[0.15em] text-[#FFDF00]">
                    {index === 0 ? "SECOND DIRECTOR" : "SCREENWRITER"}
                  </p>
                  <p className="mt-1 truncate text-base font-black uppercase">
                    {member.name}
                  </p>
                </div>
              </div>
              <p className="mt-4 text-[10px] uppercase leading-5 text-white/40">
                {member.specialty}
              </p>
              <p className="mt-3 text-[9px] font-black uppercase leading-5 text-white/25">
                DNA / {member.influences.join(" + ")}
              </p>
              <button
                type="button"
                role="switch"
                aria-checked={enabledAgents[agent]}
                onClick={() => toggleAgent(agent)}
                className="mt-5 flex w-full cursor-pointer items-center justify-between border-t border-white/10 pt-4 text-left"
              >
                <span className="text-[9px] font-black uppercase tracking-[0.14em] text-white/45">
                  {enabledAgents[agent] ? "IN CONVERSATION" : "DISCONNECTED"}
                </span>
                <span
                  className={`flex h-6 w-6 items-center justify-center rounded-full border text-[11px] transition ${
                    enabledAgents[agent]
                      ? "border-[#FFDF00] bg-[#FFDF00] text-black"
                      : "border-white/20 text-transparent"
                  }`}
                >
                  ✓
                </span>
              </button>
            </div>
          ))}

          <div className="hidden h-[440px] flex-col overflow-hidden rounded-[24px] border border-white/10 bg-white/[0.025] p-5 lg:flex">
            <div className="flex shrink-0 items-center justify-between gap-4">
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.15em] text-[#FFDF00]">
                  PROJECT NOTEBOOK
                </p>
                <p className="mt-2 text-[9px] uppercase leading-5 text-white/30">
                  APPROVE IDEAS THAT SHOULD MOVE FORWARD
                </p>
              </div>
              <span className="text-[10px] font-black text-white/35">
                {notebook.filter((note) => note.accepted).length}/{notebook.length}
              </span>
            </div>

            <div ref={notebookScrollRef} className="mt-5 min-h-0 flex-1 overflow-y-auto overscroll-contain pr-1 [scrollbar-color:rgba(255,223,0,0.35)_transparent] [scrollbar-width:thin]">
              {notebook.length === 0 ? (
                <p className="text-[10px] uppercase leading-5 text-white/25">
                  USEFUL DECISIONS WILL APPEAR HERE DURING THE CONVERSATION.
                </p>
              ) : (
              <div className="space-y-3">
                {notebook.map((note) => {
                  const author = session[note.author];
                  return (
                    <button
                      key={note.id}
                      type="button"
                      onClick={() => toggleNote(note.id)}
                      className={`w-full cursor-pointer rounded-[16px] border p-3 text-left transition ${
                        note.accepted
                          ? "border-[#FFDF00]/35 bg-[#FFDF00]/8"
                          : "border-white/10 bg-black/20"
                      }`}
                    >
                      <div className="flex items-start gap-3">
                        <span
                          className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[9px] ${
                            note.accepted
                              ? "border-[#FFDF00] bg-[#FFDF00] text-black"
                              : "border-white/20 text-transparent"
                          }`}
                        >
                          ✓
                        </span>
                        <div className="min-w-0">
                          <p className="text-[9px] font-black uppercase tracking-[0.12em] text-white/30">
                            {author.name}
                          </p>
                          <p className="mt-1 text-[11px] font-black uppercase leading-5 text-white/80">
                            {note.title}
                          </p>
                          <p className="mt-1 text-[10px] leading-5 text-white/40">
                            {note.detail}
                          </p>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
              )}
            </div>
          </div>

          <details className="director-brief-panel group overflow-hidden rounded-[20px] border border-white/10 bg-[#090909]">
            <summary className="flex cursor-pointer list-none items-center justify-between px-5 py-4 marker:hidden">
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.15em] text-white/45">DIRECTOR&apos;S BRIEF</p>
                <p className="mt-1 max-w-[220px] truncate text-[9px] text-white/25">{session.notes}</p>
              </div>
              <span className="flex h-7 w-7 items-center justify-center rounded-full border border-white/10 text-sm text-white/35 transition-transform group-open:rotate-180 group-open:border-[#FFDF00]/30 group-open:text-[#FFDF00]">⌄</span>
            </summary>
            <div className="max-h-72 overflow-y-auto overscroll-contain border-t border-white/8 px-5 py-4 [scrollbar-color:rgba(255,223,0,0.35)_transparent] [scrollbar-width:thin]">
              <p className="whitespace-pre-wrap text-xs uppercase leading-6 text-white/65">{session.notes}</p>
              {session.references.length > 0 && (
                <div className="mt-5 border-t border-white/10 pt-4">
                  <p className="text-[10px] font-black uppercase text-white/30">REFERENCES / {session.references.length}</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {session.references.map((file) => <AttachmentPreview key={`${file.name}-${file.size}`} file={file} />)}
                  </div>
                </div>
              )}
            </div>
          </details>
        </aside>

        <section className="grid grid-cols-2 gap-1.5 lg:hidden" aria-label="Conversation participants">
          {agents.map(([agent, member], index) => (
            <button
              key={member.name}
              type="button"
              role="switch"
              aria-checked={enabledAgents[agent]}
              onClick={() => toggleAgent(agent)}
              className={`flex min-w-0 items-center gap-1.5 rounded-[14px] border px-2 py-1.5 text-left transition ${enabledAgents[agent] ? "border-[#FFDF00]/30 bg-[#FFDF00]/6" : "border-white/8 bg-white/[0.02] opacity-45"}`}
            >
              <div className="scale-[0.72]">
                <Portrait member={member} />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[7px] font-black tracking-[0.1em] text-[#FFDF00]">{index === 0 ? "DIRECTOR" : "WRITER"}</p>
                <p className="mt-0.5 truncate text-[9px] font-black">{member.name}</p>
              </div>
              <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[9px] ${enabledAgents[agent] ? "border-[#FFDF00] bg-[#FFDF00] text-black" : "border-white/20 text-transparent"}`}>✓</span>
            </button>
          ))}
        </section>

        <section className="flex h-full min-h-0 flex-col overflow-hidden rounded-[24px] border border-white/10 bg-white/[0.025] sm:rounded-[28px]">
          <div className="flex flex-col gap-2 border-b border-white/10 px-4 py-3 sm:gap-5 sm:px-7 sm:py-5 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.18em] text-[#FFDF00]">CREATIVE DEVELOPMENT</p>
              <h1 className="mt-1 text-lg font-black uppercase tracking-[-0.04em] sm:mt-2 sm:text-3xl">DEVELOP THE TREATMENT WITH YOUR TEAM.</h1>
              {relationship && (
                <div className="group relative mt-2 inline-flex sm:mt-4">
                  <span className="cursor-help rounded-full border border-[#FFDF00]/25 bg-[#FFDF00]/5 px-3 py-1.5 text-[8px] font-black uppercase tracking-[0.12em] text-[#FFDF00] sm:px-4 sm:py-2 sm:text-[9px]">
                    ✦ {relationship.label}
                  </span>
                  <div className="pointer-events-none absolute left-0 top-full z-20 mt-2 hidden w-64 rounded-[14px] border border-white/10 bg-[#111] p-3 text-[10px] normal-case leading-5 text-white/55 shadow-2xl group-hover:block">
                    {relationship.description}
                  </div>
                </div>
              )}
            </div>
          </div>

          <div ref={messagesScrollRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain p-3 sm:space-y-5 sm:p-7">
            {messages
              .filter((message) => !message.hidden)
              .map((message) => {
                if (message.role === "user") {
                  return (
                    <div
                      key={message.id}
                      className="chat-message-user ml-auto max-w-[92%] rounded-[14px] bg-[#FFDF00] px-3.5 py-2.5 text-black sm:max-w-[82%]"
                    >
                      <p className="mb-2 text-[9px] font-black uppercase tracking-[0.16em] opacity-50">
                        YOU / DIRECTOR
                      </p>
                      <p className="whitespace-pre-wrap text-sm leading-7">
                        {message.content}
                      </p>
                      {message.attachments && message.attachments.length > 0 && (
                        <div className="mt-3 flex flex-wrap gap-2">
                          {message.attachments.map((file) => (
                            <AttachmentPreview key={file.name} file={file} dark />
                          ))}
                        </div>
                      )}
                    </div>
                  );
                }

                const speaker = message.speaker ?? "screenwriter";
                const member = session[speaker];
                const isDirector = speaker === "secondDirector";

                return (
                  <div
                    key={message.id}
                    className="flex max-w-[94%] items-start gap-3 sm:max-w-[84%]"
                  >
                    <div className="shrink-0 pt-1">
                      <Portrait member={member} />
                    </div>
                    <div
                      className={`rounded-[22px] border px-5 py-4 text-white ${isDirector ? "chat-message-director" : "chat-message-screenwriter"} ${
                        isDirector
                          ? "border-[#FFDF00]/15 bg-[#17150d]"
                          : "border-[#8EA6B8]/15 bg-[#11161a]"
                      }`}
                    >
                      <p
                        className={`mb-2 text-[9px] font-black uppercase tracking-[0.16em] ${
                          isDirector ? "text-[#FFDF00]" : "text-[#A9BDCA]"
                        }`}
                      >
                        {member.name} / {isDirector ? "SECOND DIRECTOR" : "SCREENWRITER"}
                      </p>
                      <p className="whitespace-pre-wrap text-sm leading-7 text-white/80">
                        {message.content}
                      </p>
                    </div>
                  </div>
                );
              })}

            {isLoading && typingAgent && (
              <div className="flex max-w-[84%] items-center gap-3">
                <Portrait member={session[typingAgent]} />
                <div className="rounded-[18px] border border-white/10 bg-black/30 px-4 py-3">
                  <p className="text-[10px] uppercase tracking-[0.12em] text-white/35">
                        {session[typingAgent].name} IS TYPING
                    <span className="ml-1 animate-pulse">...</span>
                  </p>
                </div>
              </div>
            )}

            {isLoading && !typingAgent && (
              <div className="flex items-center gap-3 text-xs uppercase text-white/35">
                <span className="h-2 w-2 animate-pulse rounded-full bg-[#FFDF00]" />
                TEAM IS THINKING...
              </div>
            )}

            {error && (
              <div className="flex items-center justify-between gap-4 rounded-[18px] border border-red-400/20 bg-red-400/5 px-5 py-4 text-xs uppercase leading-6 text-red-200">
                <span>{error}</span>
                <button
                  type="button"
                  onClick={() => documentBuildFailed ? void buildProjectDocument() : requestAgentResponse(session, messages, enabledAgents)}
                  className="shrink-0 rounded-full border border-red-200/30 px-4 py-2 text-[10px] font-black tracking-[0.12em] transition hover:bg-red-200 hover:text-black"
                >
                  {documentBuildFailed ? "RETRY DOCUMENT" : "RECONNECT"}
                </button>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          <form
            onSubmit={sendMessage}
            className="border-t border-white/10 p-2.5 sm:p-5"
          >
            {notebook.some((note) => note.accepted) && showDocumentConfirm && (
              <div className="flex justify-end">
                  <div className="flex items-center gap-2 rounded-full border border-[#FFDF00]/20 bg-[#FFDF00]/5 p-1 pl-4">
                    <span className="text-[9px] font-black uppercase text-white/45">Build project document?</span>
                    <button type="button" onClick={() => setShowDocumentConfirm(false)} className="rounded-full px-3 py-2 text-[9px] font-black text-white/35">CANCEL</button>
                    <button type="button" onClick={() => void buildProjectDocument()} disabled={isBuildingDocument} className="rounded-full bg-[#FFDF00] px-4 py-2 text-[9px] font-black text-black disabled:opacity-30">{isBuildingDocument ? "BUILDING..." : session.projectDocument ? "UPDATE SUMMARY" : "CONTINUE"}</button>
                  </div>
              </div>
            )}
            {attachments.length > 0 && (
              <div className="mb-2 flex flex-wrap gap-2 sm:mb-3">
                {attachments.map((file) => (
                  <div key={file.name} className="relative">
                    <AttachmentPreview file={file} />
                    <button
                      type="button"
                      aria-label={`Remove ${file.name}`}
                      onClick={() => setAttachments((current) => current.filter((item) => item !== file))}
                      className="absolute -right-2 -top-2 flex h-6 w-6 items-center justify-center rounded-full bg-white text-xs font-black text-black"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}
            <div className="studio-composer overflow-hidden rounded-[18px] border border-white/10 bg-[#090909]">
              <input
                ref={attachmentInputRef}
                type="file"
                multiple
                accept="image/*,.pdf,.txt,.md"
                onChange={(event) => void addAttachments(event.target.files)}
                className="hidden"
              />
              <textarea
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                placeholder="DIRECT THE CONVERSATION..."
                rows={1}
                className="min-h-14 max-h-28 w-full resize-none bg-transparent px-4 py-4 text-base leading-6 text-white outline-none placeholder:text-white/20 sm:text-sm"
              />
              <div className="flex flex-wrap items-center gap-1.5 border-t border-white/8 px-2 py-2">
                <button
                  type="button"
                  onClick={() => setMobileNotebookOpen(true)}
                  aria-label="Open project notebook"
                  aria-expanded={mobileNotebookOpen}
                  className={`relative flex h-8 w-8 shrink-0 items-center justify-center rounded-full border text-xs transition lg:hidden ${mobileNotebookOpen ? "border-[#FFDF00] bg-[#FFDF00] text-black" : "border-white/10 text-white/45 hover:border-[#FFDF00]/40 hover:text-[#FFDF00]"}`}
                >
                  ▤
                  {notebook.length > 0 && <span className="absolute -right-1.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-[#FFDF00] px-1 text-[7px] font-black text-black">{notebook.filter((note) => note.accepted).length}/{notebook.length}</span>}
                </button>
                <button
                  type="button"
                  onClick={() => attachmentInputRef.current?.click()}
                  disabled={isLoading}
                  aria-label="Attach references"
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-white/10 text-white/65 transition hover:border-white/20 hover:text-white disabled:opacity-25"
                >
                  <svg viewBox="0 0 24 24" width="17" height="17" fill="none" aria-hidden="true">
                    <path d="m8.5 12.5 6.15-6.15a3.2 3.2 0 0 1 4.53 4.53l-8.31 8.31a5 5 0 0 1-7.07-7.07l8.13-8.13a2.8 2.8 0 0 1 3.96 3.96l-7.8 7.8a1.25 1.25 0 0 1-1.77-1.77l6.55-6.55" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
                <AIProviderSwitch />
                {notebook.some((note) => note.accepted) && <button type="button" onClick={() => setShowDocumentConfirm(true)} className="ml-auto h-8 rounded-full border border-white/10 px-3 text-[8px] font-black uppercase text-white/40">{session.projectDocument ? "UPDATE SUMMARY" : "REVIEW"} →</button>}
              <button
                type="submit"
                disabled={(!draft.trim() && attachments.length === 0) || isLoading}
                className={`${notebook.some((note) => note.accepted) ? "" : "ml-auto"} h-8 shrink-0 rounded-full bg-[#FFDF00] px-4 text-[9px] font-black uppercase text-black disabled:cursor-not-allowed disabled:opacity-25`}
              >
                SEND
              </button>
              </div>
            </div>
          </form>
          {mobileNotebookOpen && <>
            <button type="button" onClick={() => setMobileNotebookOpen(false)} className="fixed inset-0 z-[90] bg-black/55 backdrop-blur-[2px] lg:hidden" aria-label="Close project notebook" />
            <section className="fixed bottom-24 left-3 right-3 z-[95] max-h-[58vh] overflow-hidden rounded-[22px] border border-[#FFDF00]/25 bg-[#0B0B0B] shadow-[0_-20px_60px_rgba(0,0,0,0.75)] lg:hidden" aria-label="Project notebook">
              <div className="flex items-center justify-between border-b border-white/10 px-4 py-4">
                <div>
                  <p className="text-[10px] font-black tracking-[0.15em] text-[#FFDF00]">PROJECT NOTEBOOK</p>
                  <p className="mt-1 text-[8px] uppercase text-white/30">SELECT IDEAS TO MOVE FORWARD</p>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-[9px] font-black text-white/35">{notebook.filter((note) => note.accepted).length}/{notebook.length}</span>
                  <button type="button" onClick={() => setMobileNotebookOpen(false)} className="flex h-8 w-8 items-center justify-center rounded-full border border-white/10 text-sm text-white/55" aria-label="Close notebook">×</button>
                </div>
              </div>
              <div className="max-h-[calc(58vh-72px)] space-y-2 overflow-y-auto p-3">
                {notebook.length === 0 ? <p className="p-4 text-[9px] uppercase leading-5 text-white/25">USEFUL DECISIONS WILL APPEAR HERE DURING THE CONVERSATION.</p> : notebook.map((note) => {
                  const author = session[note.author];
                  return <button key={note.id} type="button" onClick={() => toggleNote(note.id)} className={`w-full rounded-[15px] border p-3 text-left transition ${note.accepted ? "border-[#FFDF00]/40 bg-[#FFDF00]/8" : "border-white/10 bg-white/[0.025]"}`}>
                    <div className="flex items-start gap-3">
                      <span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[9px] ${note.accepted ? "border-[#FFDF00] bg-[#FFDF00] text-black" : "border-white/20 text-transparent"}`}>✓</span>
                      <div className="min-w-0">
                        <p className="text-[8px] font-black uppercase tracking-[0.1em] text-white/30">{author.name}</p>
                        <p className="mt-1 text-[10px] font-black uppercase leading-5 text-white/80">{note.title}</p>
                        <p className="mt-1 text-[9px] leading-5 text-white/40">{note.detail}</p>
                      </div>
                    </div>
                  </button>;
                })}
              </div>
            </section>
          </>}
        </section>
      </div>
    </main>
  );
}
