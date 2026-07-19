"use client";

import Link from "next/link";
import { ChangeEvent, FormEvent, useEffect, useRef, useState } from "react";
import { createClient } from "../../lib/supabase/client";
import TurnstileWidget from "./TurnstileWidget";
import StudioSidebar from "../components/StudioSidebar";
import { ACTIVE_PROJECT_KEY, deleteProject, getCachedProjects, saveProjects, setProjectFavorite, syncProjects } from "../../lib/project-store";
import { platformConfirm, platformPrompt } from "../../lib/platform-dialog";
import { createMediaUrl } from "../../lib/supabase/media";
import { authenticatedFetch } from "../../lib/authenticated-fetch";

type Mode = "sign-in" | "sign-up";
type WorkspaceActor = { image: string; actorName?: string; storagePath?: string; source?: "portfolio" | "generated" };
type AccountSession = { id?: string; title?: string; notes?: string; startedAt?: number; favorite?: boolean; coverPath?: string; coverModel?: string; secondDirector?: { name?: string }; screenwriter?: { name?: string }; references?: { dataUrl?: string; type?: string }[]; messages?: unknown[]; notebook?: unknown[]; projectDocument?: { title?: string; logline?: string }; screenplay?: string; screenplayLibraryAt?: number; stage?: "crew" | "dialogue" | "summary"; characterCasting?: { myCast?: WorkspaceActor[]; generationMessages?: Array<{ image?: string; candidate?: WorkspaceActor }> } };
const CURRENT_COVER_MODEL = "flux-2-dev-poster-9x16-v1";

export default function AccountPage() {
  const [mode, setMode] = useState<Mode>("sign-in");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirmation, setPasswordConfirmation] = useState("");
  const [accepted, setAccepted] = useState(false);
  const [captchaToken, setCaptchaToken] = useState("");
  const [message, setMessage] = useState("");
  const [userEmail, setUserEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [recoveryMode, setRecoveryMode] = useState(false);
  const [avatarUrl, setAvatarUrl] = useState("");
  const [awaitingConfirmation, setAwaitingConfirmation] = useState(false);
  const [captchaVersion, setCaptchaVersion] = useState(0);
  const [recoverySent, setRecoverySent] = useState(false);
  const [recoveryCooldown, setRecoveryCooldown] = useState(0);
  const [recoveryCode, setRecoveryCode] = useState("");
  const [historyOpen, setHistoryOpen] = useState(true);
  const [accountSessions, setAccountSessions] = useState<AccountSession[]>([]);
  const [projectCoverUrls, setProjectCoverUrls] = useState<Record<string, string>>({});
  const [authReady, setAuthReady] = useState(false);
  const [projectsOpen, setProjectsOpen] = useState(false);
  const [projectActionId, setProjectActionId] = useState<string | null>(null);
  const [deleteSwipeId, setDeleteSwipeId] = useState<string | null>(null);
  const [favoriteSwipeId, setFavoriteSwipeId] = useState<string | null>(null);
  const [castView, setCastView] = useState<"cast" | "screen-tests">("cast");
  const [screenplayOpenId, setScreenplayOpenId] = useState<string | null>(null);
  const [libraryScreenplayDraft, setLibraryScreenplayDraft] = useState("");
  const [screenplayDownloading, setScreenplayDownloading] = useState(false);
  const projectSwipeRef = useRef<{ x: number; y: number; id: string } | null>(null);
  const projectSwipeMoved = useRef(false);
  const coverAttempts = useRef(new Set<string>());

  const presetAvatars = ["🎬", "🎭", "🎞️", "🕯️", "🎥", "✍️"];
  const castActors = Array.from(new Map(accountSessions.flatMap((project) => project.characterCasting?.myCast ?? []).map((actor) => [actor.storagePath ?? actor.image, actor])).values());
  const screenTestActors = Array.from(new Map(accountSessions.flatMap((project) => (project.characterCasting?.generationMessages ?? []).flatMap((message) => message.image && message.candidate ? [{ ...message.candidate, image: message.image }] : [])).map((actor) => [actor.storagePath ?? actor.image, actor])).values());
  const workspaceActors = castView === "cast" ? castActors : screenTestActors;
  const screenplayProjects = accountSessions.filter((project) => project.screenplay?.trim() && project.screenplayLibraryAt).sort((a, b) => (b.screenplayLibraryAt ?? 0) - (a.screenplayLibraryAt ?? 0));
  const openScreenplay = accountSessions.find((project) => project.id === screenplayOpenId);

  function openLibraryScreenplay(project: AccountSession) {
    setScreenplayOpenId(project.id ?? null);
    setLibraryScreenplayDraft(project.screenplay ?? "");
  }

  function saveLibraryScreenplay() {
    if (!openScreenplay?.id || !libraryScreenplayDraft.trim()) return;
    const next = getCachedProjects<AccountSession>().map((project) => project.id === openScreenplay.id ? { ...project, screenplay: libraryScreenplayDraft } : project);
    saveProjects(next);
    setAccountSessions(next);
    const activeRaw = sessionStorage.getItem("carabasaiCreativeSession");
    if (activeRaw) {
      const active = JSON.parse(activeRaw) as AccountSession;
      if (active.id === openScreenplay.id) sessionStorage.setItem("carabasaiCreativeSession", JSON.stringify({ ...active, screenplay: libraryScreenplayDraft }));
    }
    setMessage("SCREENPLAY SAVED.");
  }

  async function downloadLibraryScreenplay() {
    if (!openScreenplay || !libraryScreenplayDraft.trim() || screenplayDownloading) return;
    setScreenplayDownloading(true);
    try {
      const response = await authenticatedFetch("/api/screenplay-pdf", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: openScreenplay.projectDocument?.title ?? openScreenplay.title, logline: openScreenplay.projectDocument?.logline ?? openScreenplay.notes, screenplay: libraryScreenplayDraft, director: openScreenplay.secondDirector?.name, screenwriter: openScreenplay.screenwriter?.name }) });
      if (!response.ok) throw new Error("PDF COULD NOT BE CREATED.");
      const url = URL.createObjectURL(await response.blob());
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${openScreenplay.title || "screenplay"} - Carabasai.pdf`;
      anchor.style.display = "none";
      document.body.appendChild(anchor);
      anchor.click();
      window.setTimeout(() => { anchor.remove(); URL.revokeObjectURL(url); }, 30_000);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "PDF COULD NOT BE CREATED.");
    } finally {
      setScreenplayDownloading(false);
    }
  }

  useEffect(() => {
    try {
      createClient().auth.getUser().then(({ data }) => {
        setUserEmail(data.user?.email ?? "");
        setName(String(data.user?.user_metadata.full_name ?? ""));
        setAvatarUrl(String(data.user?.user_metadata.avatar_url ?? ""));
      }).finally(() => setAuthReady(true));
    } catch { queueMicrotask(() => setAuthReady(true)); }
    const search = new URLSearchParams(window.location.search);
    const requestedMode = search.get("mode");
    if (requestedMode === "sign-up" || requestedMode === "sign-in") queueMicrotask(() => setMode(requestedMode));
    const confirmation = search.get("confirmation");
    if (confirmation) queueMicrotask(() => setMessage(confirmation === "success" ? "EMAIL CONFIRMED. YOUR ACCOUNT IS READY." : "EMAIL CONFIRMATION FAILED OR EXPIRED."));
    queueMicrotask(() => setAccountSessions(getCachedProjects<AccountSession>()));
    void syncProjects<AccountSession>().then(setAccountSessions).catch(console.error);
  }, []);

  useEffect(() => {
    const refreshCloudProjects = () => void syncProjects<AccountSession>().then(setAccountSessions).catch(console.error);
    const refreshWhenVisible = () => { if (document.visibilityState === "visible") refreshCloudProjects(); };
    window.addEventListener("focus", refreshCloudProjects);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      window.removeEventListener("focus", refreshCloudProjects);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, []);

  useEffect(() => {
    if (recoveryCooldown <= 0) return;
    const timer = window.setInterval(() => setRecoveryCooldown((current) => Math.max(0, current - 1)), 1000);
    return () => window.clearInterval(timer);
  }, [recoveryCooldown]);

  useEffect(() => {
    let cancelled = false;
    const covers = accountSessions.filter((project) => project.id && project.coverPath);
    if (!covers.length) return;
    void Promise.all(covers.map(async (project) => {
      try {
        const url = await createMediaUrl(project.coverPath!, 60 * 60 * 6);
        return { id: project.id!, url, valid: true as const };
      } catch {
        return { id: project.id!, valid: false as const };
      }
    })).then((entries) => {
      if (cancelled) return;
      setProjectCoverUrls(Object.fromEntries(
        entries.filter((entry): entry is { id: string; url: string; valid: true } => entry.valid)
          .map((entry) => [entry.id, entry.url])
      ));
      const invalidIds = new Set(entries.filter((entry) => !entry.valid).map((entry) => entry.id));
      invalidIds.forEach((id) => console.warn("Project cover URL is temporarily unavailable", id));
    });
    return () => { cancelled = true; };
  }, [accountSessions]);

  useEffect(() => {
    const project = accountSessions.find((item) =>
      item.id && item.notes?.trim() && !item.coverPath && !coverAttempts.current.has(item.id)
    );
    if (!userEmail || !project?.id || !project.notes) return;
    coverAttempts.current.add(project.id);
    void authenticatedFetch("/api/project-cover", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectId: project.id,
        brief: project.notes,
        director: project.secondDirector?.name,
        screenwriter: project.screenwriter?.name,
      }),
    }).then(async (response) => {
      const payload = await response.json() as { coverPath?: string; coverModel?: string; title?: string; error?: string };
      if (!response.ok || !payload.coverPath) throw new Error(payload.error || "PROJECT COVER COULD NOT BE GENERATED.");
      const next = getCachedProjects<AccountSession>().map((item) =>
        item.id === project.id ? {
          ...item,
          ...(payload.title ? { title: payload.title } : {}),
          coverPath: payload.coverPath,
          coverModel: payload.coverModel ?? CURRENT_COVER_MODEL,
        } : item
      );
      saveProjects(next);
      setAccountSessions(next);
    }).catch((error) => {
      console.error("Project cover backfill failed", error);
      coverAttempts.current.delete(project.id!);
    });
  }, [accountSessions, userEmail]);

  function changeMode(next: Mode) {
    setMode(next); setMessage(""); setCaptchaToken(""); setPasswordConfirmation("");
  }

  async function authenticate(event: FormEvent) {
    event.preventDefault();
    if (!captchaToken) { setMessage("COMPLETE THE SECURITY CHECK."); return; }
    if (mode === "sign-up" && !accepted) { setMessage("ACCEPT THE TERMS TO CONTINUE."); return; }
    if (mode === "sign-up" && password !== passwordConfirmation) { setMessage("PASSWORDS DO NOT MATCH."); return; }
    setLoading(true); setMessage(mode === "sign-in" ? "SIGNING IN..." : "CREATING ACCOUNT...");
    try {
      const supabase = createClient();
      const result = mode === "sign-in"
        ? await supabase.auth.signInWithPassword({ email, password, options: { captchaToken } })
        : await supabase.auth.signUp({
            email,
            password,
            options: {
              data: { full_name: name.trim(), terms_accepted_at: new Date().toISOString() },
              captchaToken,
              emailRedirectTo: `${window.location.origin}/auth/callback`,
            },
          });
      if (result.error) throw result.error;
      if (mode === "sign-up" && !result.data.session) {
        setAwaitingConfirmation(true);
        setMessage("");
      } else {
        setUserEmail(result.data.user?.email ?? email);
        setMessage("ACCOUNT CONNECTED.");
        if (mode === "sign-in") {
          window.location.assign("/studio");
        }
      }
    } catch (error) {
      const rawMessage = error instanceof Error ? error.message : "COULD NOT CONNECT ACCOUNT.";
      setMessage(/rate limit|too many/i.test(rawMessage) ? "EMAIL SENDING LIMIT REACHED FOR THIS PROJECT. A DIFFERENT EMAIL WILL NOT BYPASS IT. WAIT ABOUT AN HOUR OR CONNECT CUSTOM SMTP." : rawMessage);
      setCaptchaToken("");
      setCaptchaVersion((current) => current + 1);
    }
    finally { setLoading(false); }
  }

  async function signOut() { await createClient().auth.signOut(); setUserEmail(""); setMessage("SIGNED OUT."); }

  function openProject(project: AccountSession) {
    window.sessionStorage.setItem("carabasaiCreativeSession", JSON.stringify(project));
    if (project.id) window.localStorage.setItem(ACTIVE_PROJECT_KEY, project.id);
    window.dispatchEvent(new Event("carabasai-sidebar-change"));
    setProjectsOpen(false);
    const destination = project.projectDocument || project.stage === "summary"
      ? "/studio/project"
      : project.messages?.length || project.stage === "dialogue"
        ? "/studio/creative-room"
        : "/studio";
    window.location.assign(destination);
  }

  function openProjectStage(project: AccountSession, stage: "crew" | "dialogue" | "summary") {
    window.sessionStorage.setItem("carabasaiCreativeSession", JSON.stringify(project));
    if (project.id) window.localStorage.setItem(ACTIVE_PROJECT_KEY, project.id);
    window.dispatchEvent(new Event("carabasai-sidebar-change"));
    setProjectsOpen(false);
    window.location.assign(stage === "summary" ? "/studio/project" : stage === "dialogue" ? "/studio/creative-room" : "/studio");
  }

  function persistAccountProjects(next: AccountSession[]) {
    const sorted = [...next].sort((a, b) => Number(Boolean(b.favorite)) - Number(Boolean(a.favorite)));
    setAccountSessions(sorted);
    saveProjects(sorted);
  }

  function toggleProjectFavorite(project: AccountSession) {
    const favorite = !project.favorite;
    setAccountSessions(accountSessions.map((item) => item.id === project.id ? { ...item, favorite } : item)
      .sort((a, b) => Number(Boolean(b.favorite)) - Number(Boolean(a.favorite))));
    if (project.id) void setProjectFavorite(project.id, favorite).catch(console.error);
    setFavoriteSwipeId(null);
    setProjectActionId(null);
  }

  async function renameProject(project: AccountSession) {
    const title = (await platformPrompt({ eyebrow: "PROJECT DETAILS", title: "RENAME PROJECT.", message: "Give this production a clear working title.", defaultValue: project.title || project.notes || "UNTITLED PROJECT", confirmLabel: "SAVE TITLE" }))?.trim();
    if (title) persistAccountProjects(accountSessions.map((item) => item.id === project.id ? { ...item, title } : item));
    setProjectActionId(null);
  }

  async function removeAccountProject(project: AccountSession) {
    if (!project.id) return;
    const name = project.title || project.notes || "UNTITLED PROJECT";
    const confirmed = await platformConfirm({ eyebrow: "PROJECT ACTION", title: "DELETE PROJECT?", message: `“${name}” will be permanently removed from your studio and every synced device.`, confirmLabel: "DELETE PROJECT", tone: "danger" });
    if (!confirmed) return;
    setAccountSessions((current) => current.filter((item) => item.id !== project.id));
    setDeleteSwipeId(null);
    setProjectActionId(null);
    await deleteProject(project.id);
  }

  function renderAccountProject(project: AccountSession, index: number) {
    const key = project.id ?? String(project.startedAt ?? index);
    const deleteRevealed = deleteSwipeId === key;
    const favoriteRevealed = favoriteSwipeId === key;
    const progress = project.projectDocument || project.stage === "summary" ? 70 : project.messages?.length || project.stage === "dialogue" ? 45 : project.notes ? 20 : 10;
    const reachedDialogue = Boolean(project.messages?.length || project.stage === "dialogue" || project.stage === "summary" || project.projectDocument);
    const reachedSummary = Boolean(project.projectDocument || project.stage === "summary");
    const currentStage = reachedSummary ? "SCREENPLAY" : reachedDialogue ? "DIALOGUE" : "CREW SETUP";
    const stages: Array<{ id: "crew" | "dialogue" | "summary"; label: string; reached: boolean }> = [
      { id: "crew", label: "CREW SETUP", reached: true },
      { id: "dialogue", label: "DIALOGUE", reached: reachedDialogue },
      { id: "summary", label: "SCREENPLAY", reached: reachedSummary },
    ];
    const image = (project.id ? projectCoverUrls[project.id] : undefined) || project.references?.find((item) => item.type?.startsWith("image/"))?.dataUrl;
    return <div key={key} className={`relative h-full min-w-0 w-full max-w-full rounded-[20px] ${deleteRevealed ? "bg-red-950/50" : favoriteRevealed ? "bg-[#FFDF00]/20" : "bg-transparent"}`}>
      {favoriteRevealed && <button type="button" onClick={() => toggleProjectFavorite(project)} className="absolute bottom-0 left-0 top-0 flex w-16 items-center justify-center text-xl text-[#FFDF00] md:hidden" aria-label="Add project to favorites">★</button>}
      {deleteRevealed && <button type="button" onClick={() => void removeAccountProject(project)} className="absolute bottom-0 right-0 top-0 flex w-16 items-center justify-center text-lg text-red-400 md:hidden" aria-label="Delete project">⌫</button>}
      <article
        data-disable-menu-swipe
        className={`relative flex h-full min-w-0 w-full max-w-full flex-col overflow-visible rounded-[20px] border border-white/10 bg-[#0B0B0B] transition-all md:translate-x-0 md:hover:-translate-y-1 md:hover:border-[#FFDF00]/30 ${deleteRevealed ? "-translate-x-16" : favoriteRevealed ? "translate-x-16" : "translate-x-0"}`}
        onTouchStart={(event) => { const touch = event.touches[0]; projectSwipeMoved.current = false; projectSwipeRef.current = { x: touch.clientX, y: touch.clientY, id: key }; }}
        onTouchEnd={(event) => {
          const start = projectSwipeRef.current;
          const touch = event.changedTouches[0];
          const horizontal = start ? touch.clientX - start.x : 0;
          const vertical = start ? Math.abs(touch.clientY - start.y) : 999;
          if (start?.id === key && vertical < 45) {
            if (deleteRevealed && horizontal > 35) { setDeleteSwipeId(null); projectSwipeMoved.current = true; }
            else if (favoriteRevealed && horizontal < -35) { setFavoriteSwipeId(null); projectSwipeMoved.current = true; }
            else if (!deleteRevealed && !favoriteRevealed && horizontal < -45) { setDeleteSwipeId(key); setFavoriteSwipeId(null); projectSwipeMoved.current = true; }
            else if (!deleteRevealed && !favoriteRevealed && horizontal > 45) { setFavoriteSwipeId(key); setDeleteSwipeId(null); projectSwipeMoved.current = true; }
          }
          projectSwipeRef.current = null;
        }}
      >
        <div role="button" tabIndex={0} onClick={() => { if (projectSwipeMoved.current) { projectSwipeMoved.current = false; return; } openProject(project); }} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") openProject(project); }} className="flex min-w-0 w-full max-w-full flex-1 cursor-pointer flex-col overflow-hidden rounded-[20px] text-left">
          <div
            className="flex aspect-[9/16] w-full items-center justify-center rounded-t-[20px] bg-[#101010] bg-cover bg-center"
            style={image ? { backgroundImage: `url(${image})` } : undefined}
          >
            {!image && <span className="px-3 text-center text-[7px] font-black tracking-[0.12em] text-white/20">GENERATING COVER...</span>}
          </div>
          <div className="flex min-w-0 flex-1 flex-col p-4 md:p-5">
            <p className="text-[8px] font-black tracking-[0.12em] text-[#FFDF00]">IN PROGRESS</p>
            <h3 className="mt-2 min-h-10 line-clamp-2 pr-8 text-base font-black uppercase leading-tight text-white md:mt-3 md:min-h-[45px] md:text-lg">{project.title || "UNTITLED PROJECT"}</h3>
            <details onClick={(event) => event.stopPropagation()} className="group mt-3 min-h-[58px] text-[10px] leading-5 text-white/35">
              <summary className="line-clamp-2 cursor-pointer list-none pr-3 marker:hidden group-open:line-clamp-none">{project.notes || "NO PROJECT BRIEF"}</summary>
              <span className="mt-1 block text-[8px] font-black text-[#FFDF00]/60 group-open:hidden">SHOW FULL BRIEF</span>
            </details>
            <div className="mt-auto flex items-center justify-between pt-4 text-[9px] font-black tracking-[0.1em]"><span className="text-white/55">{currentStage}</span><span className="text-white/35">{progress}%</span></div>
            <div className="mt-2 h-1 overflow-hidden rounded-full bg-white/8"><div className="h-full bg-[#FFDF00]" style={{ width: `${progress}%` }} /></div>
          </div>
        </div>
        <div className="flex flex-wrap gap-1.5 border-t border-white/8 px-4 py-3 md:px-5">
          {stages.filter((stage) => stage.reached).map((stage) => <button
            key={stage.id}
            type="button"
            onClick={(event) => { event.stopPropagation(); openProjectStage(project, stage.id); }}
            className={`rounded-full border px-2.5 py-1.5 text-[7px] font-black tracking-[0.08em] transition ${stage.label === currentStage ? "border-[#FFDF00]/55 bg-[#FFDF00]/10 text-[#FFDF00]" : "border-white/10 text-white/35 hover:border-[#FFDF00]/30 hover:text-white"}`}
          >{stage.label}</button>)}
        </div>
        <div className="absolute right-3 top-3 z-10 flex items-center gap-1">
          {project.favorite && <button type="button" onClick={(event) => { event.stopPropagation(); toggleProjectFavorite(project); }} className="flex h-8 w-8 items-center justify-center rounded-full bg-black/65 text-sm text-[#FFDF00] backdrop-blur-sm hover:text-white" title="Remove from favorites" aria-label="Remove project from favorites">★</button>}
          <button type="button" onClick={() => { setDeleteSwipeId(null); setFavoriteSwipeId(null); setProjectActionId((current) => current === key ? null : key); }} className="flex h-8 w-8 items-center justify-center rounded-full bg-black/65 text-lg text-white/65 backdrop-blur-sm hover:text-[#FFDF00]" aria-label="Project actions">⋮</button>
        </div>
        {projectActionId === key && <div className="absolute right-3 top-12 z-20 w-44 rounded-[13px] border border-white/10 bg-[#111] p-1.5 shadow-2xl">
          <button type="button" onClick={() => renameProject(project)} className="flex h-9 w-full items-center justify-between rounded-lg px-3 text-[8px] font-black tracking-[0.1em] text-white/55 hover:bg-white/5 hover:text-white">RENAME <span>✎</span></button>
          <button type="button" onClick={() => toggleProjectFavorite(project)} className="flex h-9 w-full items-center justify-between rounded-lg px-3 text-[8px] font-black tracking-[0.1em] text-white/55 hover:bg-white/5 hover:text-white">{project.favorite ? "REMOVE FAVORITE" : "ADD TO FAVORITES"} <span className={project.favorite ? "text-[#FFDF00]" : "text-white/25"}>★</span></button>
          <button type="button" onClick={() => void removeAccountProject(project)} className="flex h-9 w-full items-center justify-between rounded-lg px-3 text-[8px] font-black tracking-[0.1em] text-red-400/70 hover:bg-red-500/5 hover:text-red-400">DELETE <span>⌫</span></button>
        </div>}
      </article>
    </div>;
  }

  async function sendRecovery(event: FormEvent) {
    event.preventDefault(); setLoading(true); setMessage("");
    if (!captchaToken) { setMessage("COMPLETE THE SECURITY CHECK."); setLoading(false); return; }
    if (recoveryCooldown > 0) { setLoading(false); return; }
    const { error } = await createClient().auth.resetPasswordForEmail(email, { captchaToken });
    if (error) {
      const rateLimited = /rate limit|too many/i.test(error.message);
      setMessage(rateLimited ? "EMAIL SERVICE IS TEMPORARILY BUSY. PLEASE TRY AGAIN LATER." : error.message);
      if (rateLimited) setRecoveryCooldown(60);
      setCaptchaToken("");
      setCaptchaVersion((current) => current + 1);
    } else {
      setRecoverySent(true);
      setRecoveryCooldown(60);
      setMessage("");
      setCaptchaToken("");
      setCaptchaVersion((current) => current + 1);
    }
    setLoading(false);
  }

  async function verifyRecoveryCode(event: FormEvent) {
    event.preventDefault();
    const normalizedCode = recoveryCode.replace(/\D/g, "");
    if (normalizedCode.length !== 6) {
      setMessage("ENTER THE 6-DIGIT CODE FROM THE EMAIL.");
      return;
    }
    setLoading(true); setMessage("");
    const { error } = await createClient().auth.verifyOtp({
      email,
      token: normalizedCode,
      type: "recovery",
    });
    if (error) {
      setMessage("THE CODE IS INCORRECT OR EXPIRED. REQUEST A NEW CODE.");
      setLoading(false);
      return;
    }
    window.sessionStorage.setItem("carabasai-password-recovery", "ready");
    window.location.assign("/account/reset-password");
  }

  async function saveAvatar(nextAvatar: string) {
    setLoading(true); setMessage("");
    const { error } = await createClient().auth.updateUser({ data: { avatar_url: nextAvatar } });
    if (error) setMessage(error.message); else { setAvatarUrl(nextAvatar); setMessage("AVATAR UPDATED."); }
    setLoading(false);
  }

  async function uploadAvatar(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]; if (!file) return;
    if (!file.type.startsWith("image/") || file.size > 5 * 1024 * 1024) { setMessage("CHOOSE AN IMAGE UP TO 5 MB."); return; }
    setLoading(true); setMessage("");
    const supabase = createClient();
    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) { setMessage("SIGN IN FIRST."); setLoading(false); return; }
    const extension = file.name.split(".").pop()?.toLowerCase() || "jpg";
    const path = `${userData.user.id}/avatar-${Date.now()}.${extension}`;
    const { error: uploadError } = await supabase.storage.from("avatars").upload(path, file, { upsert: true });
    if (uploadError) { setMessage(uploadError.message); setLoading(false); return; }
    const publicUrl = supabase.storage.from("avatars").getPublicUrl(path).data.publicUrl;
    await saveAvatar(publicUrl);
  }

  if (!authReady) return <main className="min-h-screen bg-[#050505]" aria-label="Loading account" />;

  if (userEmail) return <main className="min-h-screen bg-[#050505] text-white">
    <StudioSidebar />
    <aside className="hidden">
      <p className="text-[11px] font-black tracking-[0.2em] text-[#FFDF00]">CARABASAI STUDIO</p>
      <nav className="mt-6 grid gap-2">
        <Link href="/studio" className="flex h-11 items-center justify-between rounded-xl border border-white/10 bg-white/[0.025] px-4 text-[10px] font-black tracking-[0.12em] text-white/65">STUDIO HOME <span className="text-[#FFDF00]">⌂</span></Link>
        <Link href="/account" className="flex h-11 items-center justify-between rounded-xl bg-[#FFDF00] px-4 text-[10px] font-black tracking-[0.12em] text-black">MY ACCOUNT <span>○</span></Link>
        <a href="mailto:info@carabasai.com" className="flex h-11 items-center justify-between rounded-xl border border-white/10 bg-white/[0.025] px-4 text-[10px] font-black tracking-[0.12em] text-white/65">HELP DESK <span className="text-[#FFDF00]">?</span></a>
      </nav>
      <div className="mt-auto hidden border-t border-white/10 pt-4 md:block">
        <button type="button" onClick={() => setHistoryOpen((current) => !current)} className="flex w-full items-center justify-between py-2 text-[9px] font-black tracking-[0.14em] text-[#FFDF00]">SESSION HISTORY <span>{historyOpen ? "−" : "+"}</span></button>
        {historyOpen && <div className="mt-2 max-h-40 space-y-2 overflow-y-auto">{accountSessions.length ? accountSessions.map((session) => <Link key={session.id ?? session.startedAt ?? session.notes} href="/studio" className="block truncate rounded-lg border border-white/8 bg-white/[0.02] px-3 py-2 text-[9px] text-white/45">{session.title || session.notes || "UNTITLED SESSION"}</Link>) : <p className="py-2 text-[8px] leading-4 text-white/20">YOUR SAVED SESSIONS WILL APPEAR HERE.</p>}</div>}
      </div>
      <div className="hidden">
        <div className="flex items-center gap-3 px-2">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full border border-[#FFDF00]/30 bg-black/40 text-sm">{avatarUrl.startsWith("http") ? <img src={avatarUrl} alt="Avatar" className="h-full w-full object-cover" /> : avatarUrl || name.charAt(0).toUpperCase() || "A"}</div>
          <div className="hidden min-w-0 md:block"><p className="truncate text-[10px] font-black text-white/80">{name || "Carabasai creator"}</p><p className="mt-1 truncate text-[8px] text-white/30">{userEmail}</p></div>
        </div>
        <button type="button" onClick={signOut} className="mt-4 flex h-10 w-full items-center justify-center rounded-full border border-white/10 text-[9px] font-black text-white/35 hover:border-white/20 hover:text-white/60"><span className="md:hidden">↪</span><span className="hidden md:inline">SIGN OUT</span></button>
      </div>
    </aside>

    <section className="min-h-screen pt-16 md:pl-[var(--studio-sidebar-width,260px)] md:pt-0">
      <div className="mx-auto w-full max-w-[1500px] px-4 py-7 sm:px-8 sm:py-10 lg:px-14">
        <header><p className="text-[10px] font-black tracking-[0.18em] text-[#FFDF00]">{name || "CREATOR"}</p><h1 className="mt-3 text-3xl font-black tracking-[-0.05em] sm:text-4xl">WELCOME BACK TO YOUR STUDIO.</h1><p className="mt-3 text-sm text-white/35">{accountSessions.length} active {accountSessions.length === 1 ? "project" : "projects"} in your workspace.</p></header>

        <section className="mt-12"><div className="mb-4 flex items-center justify-between"><h2 className="text-sm font-black tracking-[0.08em]">PRODUCTION WALL</h2><button className="rounded-full border border-white/12 px-4 py-2 text-[9px] font-black text-white/50">OPEN WALL ↗</button></div><div className="relative h-[290px] overflow-hidden rounded-[24px] border border-white/10 bg-[url('/studio-bg.jpeg')] bg-cover bg-center"><div className="absolute inset-0 bg-gradient-to-r from-black/70 via-black/25 to-black/60"/><div className="absolute bottom-7 left-7"><p className="text-[10px] font-black tracking-[0.16em] text-[#FFDF00]">YOUR VISUAL WORKSPACE</p><p className="mt-2 max-w-md text-sm text-white/55">Images, videos, references and generated frames will live here.</p></div></div></section>

        <section className="mt-10 min-w-0"><div className="mb-5 flex items-center justify-between"><h2 className="text-sm font-black tracking-[0.08em]">ACTIVE PROJECTS</h2><button type="button" onClick={() => setProjectsOpen(true)} className="text-[10px] font-black text-white/45 hover:text-[#FFDF00]">VIEW ALL PROJECTS →</button></div><div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-4 md:grid-cols-2 xl:grid-cols-4">{accountSessions.slice(0,4).map((project, index) => renderAccountProject(project, index))}{accountSessions.length === 0 && <Link href="/studio" className="col-span-full flex min-h-52 items-center justify-center rounded-[20px] border border-dashed border-white/15 text-[10px] font-black text-white/35 hover:border-[#FFDF00]/35 hover:text-[#FFDF00]">START YOUR FIRST PROJECT +</Link>}</div></section>
        <section className="mt-10 overflow-hidden rounded-[24px] border border-white/10 bg-[#090909]">
          <header className="flex flex-wrap items-center justify-between gap-4 border-b border-white/10 bg-[#353535] px-5 py-4 sm:px-6">
            <div><p className="text-[9px] font-black tracking-[.16em] text-[#FFDF00]">WORKSPACE CASTING LIBRARY</p><h2 className="mt-1 text-lg font-black">CAST &amp; SCREEN TESTS</h2></div>
            <div className="flex items-center gap-2">
              <div className="flex rounded-full border border-white/12 bg-[#090909] p-1">
                <button type="button" onClick={() => setCastView("cast")} className={`rounded-full px-4 py-2 text-[8px] font-black ${castView === "cast" ? "bg-[#FFDF00] text-black" : "text-white/45"}`}>CAST</button>
                <button type="button" onClick={() => setCastView("screen-tests")} className={`rounded-full px-4 py-2 text-[8px] font-black ${castView === "screen-tests" ? "bg-[#FFDF00] text-black" : "text-white/45"}`}>SCREEN TESTS</button>
              </div>
              <Link href={castView === "cast" ? "/studio/cast" : "/studio/cast/screen-tests"} className="rounded-full border border-white/12 px-4 py-2.5 text-[8px] font-black text-white/55 hover:border-[#FFDF00]/40 hover:text-[#FFDF00]">OPEN ALL →</Link>
            </div>
          </header>
          <div className="flex min-h-48 gap-3 overflow-x-auto p-5 sm:p-6">
            {workspaceActors.length ? workspaceActors.slice(0, 12).map((actor) => <Link key={actor.storagePath ?? actor.image} href={castView === "cast" ? "/studio/cast" : "/studio/cast/screen-tests"} className="group relative aspect-[9/16] h-44 shrink-0 overflow-hidden rounded-[14px] border border-white/10 bg-[#303030] hover:border-[#FFDF00]/60"><img src={actor.image} alt={actor.actorName ?? "Casting actor"} className="h-full w-full object-cover object-top" /><div className="absolute inset-x-0 bottom-0 bg-black/75 px-2.5 py-2"><p className="truncate text-[8px] font-black">{actor.actorName ?? "CASTING ACTOR"}</p></div></Link>) : <div className="flex w-full items-center justify-center text-[10px] text-white/30">{castView === "cast" ? "Actors added to your cast will appear here." : "Generated screen tests will appear here."}</div>}
          </div>
        </section>
        <section className="mt-10 overflow-hidden rounded-[24px] border border-white/10 bg-[#090909]">
          <header className="flex flex-wrap items-center justify-between gap-4 border-b border-white/10 bg-[#353535] px-5 py-4 sm:px-6">
            <div><p className="text-[9px] font-black tracking-[.16em] text-[#FFDF00]">SCREENPLAY LIBRARY</p><h2 className="mt-1 text-lg font-black">BEST SCREENPLAYS</h2></div>
            <p className="text-[9px] text-white/35">{screenplayProjects.length} SAVED</p>
          </header>
          <div className="flex min-h-48 gap-3 overflow-x-auto p-5 sm:p-6">
            {screenplayProjects.length ? screenplayProjects.map((project) => <button key={project.id} type="button" onClick={() => openLibraryScreenplay(project)} className="group flex h-44 w-56 shrink-0 flex-col justify-between rounded-[16px] border border-white/10 bg-[#151515] p-5 text-left transition hover:border-[#FFDF00]/60 hover:bg-[#1b1b1b]"><div><p className="text-[8px] font-black tracking-[.14em] text-[#FFDF00]">SCREENPLAY</p><h3 className="mt-3 line-clamp-2 text-lg font-black leading-6">{project.projectDocument?.title ?? project.title ?? "UNTITLED"}</h3><p className="mt-3 line-clamp-2 text-[10px] leading-5 text-white/35">{project.projectDocument?.logline ?? project.notes}</p></div><p className="text-[8px] font-black text-white/35 group-hover:text-[#FFDF00]">OPEN SCREENPLAY →</p></button>) : <div className="flex w-full items-center justify-center text-center text-[10px] text-white/30">Screenplays added from a project will appear here.</div>}
          </div>
        </section>
        {message && <p className="mt-6 text-[10px] leading-5 text-white/50">{message}</p>}
      </div>
      {projectsOpen && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm sm:p-6"><button aria-label="Close projects" onClick={() => setProjectsOpen(false)} className="absolute inset-0"/><div className="relative max-h-[86vh] w-full max-w-6xl overflow-y-auto rounded-[28px] border border-white/12 bg-[#090909] p-5 sm:p-7"><div className="flex items-center justify-between"><h2 className="text-2xl font-black">ALL PROJECTS</h2><button onClick={() => setProjectsOpen(false)} className="h-10 w-10 rounded-full border border-white/10 text-white/50">×</button></div><div className="mt-6 grid min-w-0 grid-cols-[minmax(0,1fr)] gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">{accountSessions.map((project, index) => renderAccountProject(project, index))}</div></div></div>}
      {openScreenplay && <div className="fixed inset-0 z-[12000] flex items-center justify-center bg-black/90 p-3 backdrop-blur-md sm:p-6"><button type="button" aria-label="Close screenplay" onClick={() => setScreenplayOpenId(null)} className="absolute inset-0"/><section role="dialog" aria-modal="true" aria-label="Saved screenplay" className="relative flex h-[90dvh] w-full max-w-6xl flex-col overflow-hidden rounded-[24px] border border-white/12 bg-[#090909]"><header className="flex shrink-0 flex-wrap items-center justify-between gap-4 border-b border-white/10 bg-[#303030] px-5 py-4 sm:px-7"><div><p className="text-[9px] font-black tracking-[.16em] text-[#FFDF00]">MY SCREENPLAYS</p><h2 className="mt-1 text-xl font-black">{openScreenplay.projectDocument?.title ?? openScreenplay.title ?? "UNTITLED"}</h2></div><div className="flex items-center gap-2"><button type="button" onClick={() => void downloadLibraryScreenplay()} disabled={screenplayDownloading} className="rounded-full border border-white/15 px-4 py-2.5 text-[8px] font-black text-white/60 disabled:opacity-30">{screenplayDownloading ? "CREATING PDF..." : "DOWNLOAD PDF"}</button><button type="button" onClick={saveLibraryScreenplay} className="rounded-full bg-[#FFDF00] px-5 py-2.5 text-[8px] font-black text-black">SAVE CHANGES</button><button type="button" onClick={() => setScreenplayOpenId(null)} className="flex h-9 w-9 items-center justify-center rounded-full border border-white/15 text-lg text-white/50">×</button></div></header><textarea value={libraryScreenplayDraft} onChange={(event) => setLibraryScreenplayDraft(event.target.value)} spellCheck className="min-h-0 flex-1 resize-none overflow-y-auto bg-black p-6 font-mono text-sm leading-7 text-white/85 outline-none sm:p-9 [scrollbar-color:rgba(255,223,0,.4)_transparent] [scrollbar-width:thin]"/></section></div>}
    </section>
  </main>;

  if (recoveryMode && !userEmail) return <main className="flex min-h-screen items-center justify-center bg-[#050505] p-5 text-white">{recoverySent && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-5 backdrop-blur-sm"><section role="dialog" aria-modal="true" className="w-full max-w-md rounded-[28px] border border-[#FFDF00]/25 bg-[#0A0A0A] p-7 text-center"><div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-[#FFDF00] text-2xl text-black">✉</div><p className="mt-6 text-[10px] font-black tracking-[0.16em] text-[#FFDF00]">RECOVERY CODE SENT</p><h2 className="mt-3 text-2xl font-black">ENTER THE CODE.</h2><p className="mt-4 text-sm leading-6 text-white/50">We sent a 6-digit code to <span className="font-bold text-white/80">{email}</span>.</p><form onSubmit={verifyRecoveryCode} className="mt-6"><input type="text" inputMode="numeric" autoComplete="one-time-code" maxLength={6} required value={recoveryCode} onChange={(event) => setRecoveryCode(event.target.value.replace(/\D/g, "").slice(0, 6))} placeholder="000000" className="h-16 w-full rounded-[16px] border border-white/15 bg-black/40 text-center text-2xl font-black tracking-[0.35em] outline-none focus:border-[#FFDF00]/60" /><button disabled={loading || recoveryCode.length !== 6} className="mt-4 h-12 w-full rounded-full bg-[#FFDF00] text-[10px] font-black text-black disabled:opacity-30">{loading ? "CHECKING CODE..." : "VERIFY CODE"}</button></form>{message && <p className="mt-4 text-[10px] leading-5 text-white/55">{message}</p>}<button type="button" disabled={recoveryCooldown > 0 || loading} onClick={() => { setRecoverySent(false); setRecoveryCode(""); setMessage(""); }} className="mt-4 h-10 w-full rounded-full border border-white/10 text-[9px] font-black text-white/45 disabled:opacity-25">{recoveryCooldown > 0 ? `NEW CODE IN ${recoveryCooldown}s` : "REQUEST ANOTHER CODE"}</button><button type="button" onClick={() => { setRecoverySent(false); setRecoveryCode(""); setMessage(""); }} className="mt-5 text-[10px] font-black text-white/45 hover:text-[#FFDF00]">← BACK</button></section></div>}<section className="w-full max-w-md rounded-[28px] border border-white/10 bg-white/[0.025] p-6 sm:p-8"><p className="text-[10px] font-black tracking-[0.18em] text-[#FFDF00]">PASSWORD RECOVERY</p><h1 className="mt-4 text-3xl font-black">RESET YOUR PASSWORD.</h1><p className="mt-4 text-sm leading-6 text-white/40">We will send a 6-digit recovery code to your email.</p><form onSubmit={sendRecovery} className="mt-7 space-y-3"><input type="email" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="EMAIL" autoComplete="email" className="h-14 w-full rounded-[14px] border border-white/10 bg-black/30 px-4 text-sm outline-none focus:border-[#FFDF00]/50" /><TurnstileWidget key={`recovery-${captchaVersion}`} onToken={setCaptchaToken} /><button disabled={loading || !captchaToken || recoveryCooldown > 0} className="h-12 w-full rounded-full bg-[#FFDF00] text-[10px] font-black text-black disabled:opacity-30">{loading ? "PLEASE WAIT..." : recoveryCooldown > 0 ? `NEW CODE IN ${recoveryCooldown}s` : !captchaToken ? "COMPLETE SECURITY CHECK" : "SEND RECOVERY CODE"}</button></form>{message && <p className="mt-5 text-[10px] leading-5 text-white/55">{message}</p>}<button type="button" onClick={() => { setRecoveryMode(false); setCaptchaToken(""); setMessage(""); setRecoveryCode(""); }} className="mt-7 text-[10px] font-black text-white/40">← BACK TO SIGN IN</button></section></main>;

  return <main className="flex min-h-screen items-center justify-center bg-[#050505] p-5 text-white">{awaitingConfirmation && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-5 backdrop-blur-sm"><section role="dialog" aria-modal="true" className="w-full max-w-md rounded-[28px] border border-[#FFDF00]/25 bg-[#0A0A0A] p-7 text-center shadow-2xl"><div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-[#FFDF00] text-2xl text-black">✉</div><p className="mt-6 text-[10px] font-black tracking-[0.16em] text-[#FFDF00]">CONFIRM YOUR EMAIL</p><h2 className="mt-3 text-2xl font-black">CHECK YOUR INBOX.</h2><p className="mt-4 text-sm leading-6 text-white/50">We sent a confirmation link to <span className="font-bold text-white/80">{email}</span>. Open the email and follow the link to activate your account.</p><p className="mt-4 text-[10px] leading-5 text-white/30">If this email already has an account, sign in or use password recovery instead.</p><button type="button" onClick={() => { setAwaitingConfirmation(false); setMode("sign-in"); }} className="mt-7 h-11 w-full rounded-full border border-white/15 text-[10px] font-black text-white/65">BACK TO SIGN IN</button></section></div>}<section className="w-full max-w-md rounded-[28px] border border-white/10 bg-white/[0.025] p-6 sm:p-8">
    <p className="text-[10px] font-black tracking-[0.18em] text-[#FFDF00]">CARABASAI ACCOUNT</p>
    <h1 className="mt-4 text-3xl font-black tracking-[-0.04em]">{mode === "sign-up" ? "CREATE YOUR ACCOUNT." : "WELCOME BACK."}</h1>
    <p className="mt-4 text-sm leading-6 text-white/40">Keep sessions, references, generated images and video outside this browser.</p>
    {userEmail ? <div className="mt-8 rounded-[18px] border border-[#FFDF00]/20 bg-[#FFDF00]/5 p-5"><div className="flex items-center gap-4"><div className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-full border border-[#FFDF00]/35 bg-black/40 text-2xl">{avatarUrl.startsWith("http") ? <img src={avatarUrl} alt="Avatar" className="h-full w-full object-cover" /> : avatarUrl || name.charAt(0).toUpperCase() || "A"}</div><div><p className="text-[9px] font-black tracking-[0.14em] text-[#FFDF00]">CONNECTED</p><p className="mt-1 text-base font-black text-white/85">{name || "Carabasai creator"}</p><p className="mt-1 text-xs text-white/45">{userEmail}</p></div></div><p className="mt-6 text-[9px] font-black tracking-[0.12em] text-white/35">CHOOSE AVATAR</p><div className="mt-3 grid grid-cols-6 gap-2">{presetAvatars.map((avatar) => <button key={avatar} type="button" onClick={() => saveAvatar(avatar)} className="aspect-square rounded-full border border-white/10 bg-black/30 text-lg hover:border-[#FFDF00]/50">{avatar}</button>)}</div><label className="mt-4 flex cursor-pointer items-center justify-center rounded-full border border-white/15 px-5 py-3 text-[10px] font-black hover:border-[#FFDF00]/40"><input type="file" accept="image/*" onChange={uploadAvatar} className="hidden" />UPLOAD YOUR IMAGE</label><button type="button" onClick={signOut} className="mt-3 w-full rounded-full border border-white/10 px-5 py-3 text-[10px] font-black text-white/45">SIGN OUT</button></div> : <>
      <div className="mt-7 grid grid-cols-2 rounded-full border border-white/10 bg-black/25 p-1"><button type="button" onClick={() => changeMode("sign-in")} className={`rounded-full py-2.5 text-[9px] font-black ${mode === "sign-in" ? "bg-[#FFDF00] text-black" : "text-white/35"}`}>SIGN IN</button><button type="button" onClick={() => changeMode("sign-up")} className={`rounded-full py-2.5 text-[9px] font-black ${mode === "sign-up" ? "bg-[#FFDF00] text-black" : "text-white/35"}`}>CREATE ACCOUNT</button></div>
      <form onSubmit={authenticate} className="mt-5 space-y-3">
        {mode === "sign-up" && <input type="text" required value={name} onChange={(event) => setName(event.target.value)} placeholder="YOUR NAME" autoComplete="name" className="h-14 w-full rounded-[14px] border border-white/10 bg-black/30 px-4 text-sm outline-none focus:border-[#FFDF00]/50" />}
        <input type="email" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="EMAIL" autoComplete="email" className="h-14 w-full rounded-[14px] border border-white/10 bg-black/30 px-4 text-sm outline-none focus:border-[#FFDF00]/50" />
        <input type="password" required minLength={8} value={password} onChange={(event) => setPassword(event.target.value)} placeholder="PASSWORD" autoComplete={mode === "sign-up" ? "new-password" : "current-password"} className="h-14 w-full rounded-[14px] border border-white/10 bg-black/30 px-4 text-sm outline-none focus:border-[#FFDF00]/50" />
        {mode === "sign-up" && <input type="password" required minLength={8} value={passwordConfirmation} onChange={(event) => setPasswordConfirmation(event.target.value)} placeholder="REPEAT PASSWORD" autoComplete="new-password" className="h-14 w-full rounded-[14px] border border-white/10 bg-black/30 px-4 text-sm outline-none focus:border-[#FFDF00]/50" />}
        {mode === "sign-up" && <label className="flex cursor-pointer items-start gap-3 py-2 text-[10px] leading-5 text-white/45"><input type="checkbox" checked={accepted} onChange={(event) => setAccepted(event.target.checked)} className="mt-1 accent-[#FFDF00]" /><span>By registering, you agree to the <Link href="/terms" target="_blank" className="text-white/75 underline">Terms of Use</Link> and <Link href="/privacy" target="_blank" className="text-white/75 underline">Privacy Policy</Link>.</span></label>}
        <TurnstileWidget key={`${mode}-${captchaVersion}`} onToken={(token) => { setCaptchaToken(token); if (token) setMessage(""); }} />
        <button type="submit" disabled={loading || !captchaToken} className="h-12 w-full rounded-full bg-[#FFDF00] text-[10px] font-black text-black disabled:cursor-not-allowed disabled:opacity-30">{loading ? "PLEASE WAIT..." : !captchaToken ? "COMPLETE SECURITY CHECK" : mode === "sign-up" ? "CREATE ACCOUNT" : "SIGN IN"}</button>
      </form>
      <p className="mt-5 text-center text-[10px] text-white/35">{mode === "sign-up" ? "Already have an account? " : "New to Carabasai? "}<button type="button" onClick={() => changeMode(mode === "sign-up" ? "sign-in" : "sign-up")} className="font-black text-[#FFDF00]">{mode === "sign-up" ? "Sign in" : "Create account"}</button></p>
      {mode === "sign-in" && <button type="button" onClick={() => { setCaptchaToken(""); setCaptchaVersion((current) => current + 1); setRecoveryMode(true); setMessage(""); }} className="mt-4 w-full text-center text-[10px] font-black text-white/45 hover:text-[#FFDF00]">FORGOT PASSWORD?</button>}
    </>}
    {message && <p className="mt-5 text-[10px] leading-5 text-white/50">{message}</p>}
    <Link href="/studio" className="mt-8 inline-flex text-[10px] font-black text-white/35 hover:text-[#FFDF00]">← BACK TO STUDIO</Link>
  </section></main>;
}
