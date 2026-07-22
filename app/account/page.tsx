"use client";

import Link from "next/link";
import { ChangeEvent, FormEvent, useEffect, useRef, useState } from "react";
import { createClient } from "../../lib/supabase/client";
import TurnstileWidget from "./TurnstileWidget";
import StudioSidebar from "../components/StudioSidebar";
import { ACTIVE_PROJECT_KEY, deleteProject, getCachedProjects, getTrashedProjects, permanentlyDeleteProject, restoreProject, saveProjects, setProjectFavorite, syncProjects } from "../../lib/project-store";
import { platformConfirm, platformPrompt } from "../../lib/platform-dialog";
import { createMediaUrl, createMediaUrls } from "../../lib/supabase/media";
import { authenticatedFetch } from "../../lib/authenticated-fetch";
import { locationSpecialists } from "../../lib/location-design";

type Mode = "sign-in" | "sign-up";
type WorkspaceActor = { image: string; actorName?: string; storagePath?: string; source?: "portfolio" | "generated" };
type ProjectAsset = { id?: string; image?: string; storagePath?: string; name?: string; prompt?: string; accepted?: boolean };
type FilmDetailKey = "genre" | "country" | "duration" | "premiere" | "watch" | "budget" | "production" | "rating" | "quality";
type AccountSession = { id?: string; title?: string; notes?: string; projectDescription?: string; trashedAt?: number; startedAt?: number; favorite?: boolean; coverPath?: string; coverModel?: string; filmDetails?: { hiddenFields?: FilmDetailKey[]; country?: string; watchPlatforms?: string[] }; secondDirector?: { name?: string }; screenwriter?: { name?: string }; characterCastingSpecialist?: { name?: string }; references?: { dataUrl?: string; type?: string }[]; messages?: unknown[]; notebook?: unknown[]; projectDocument?: { title?: string; logline?: string; sections?: Array<{ id?: string; title?: string; summary?: string; points?: string[] }> }; screenplay?: string; screenplayLibraryAt?: number; stage?: "crew" | "dialogue" | "summary" | "casting" | "costume" | "locations" | "cinematography" | "storyboard"; characterCasting?: { specialistId?: string; characters?: Array<{ id?: string; role?: string; name?: string; actorName?: string; image?: string; storagePath?: string }>; myCast?: WorkspaceActor[]; generationMessages?: Array<{ image?: string; candidate?: WorkspaceActor }> }; costumeDesign?: { specialistName?: string; characters?: Record<string, { name?: string; variants?: ProjectAsset[]; approvedIds?: string[] }> }; locationDesign?: { specialistId?: string; locations?: ProjectAsset[]; units?: Array<{ label?: string; variants?: ProjectAsset[]; approvedIds?: string[] }> }; cinematography?: { specialistName?: string; soundSpecialistName?: string }; frames?: ProjectAsset[]; videos?: ProjectAsset[] };
type ProjectOverviewTab = "about" | "screenplay" | "characters" | "costumes" | "locations" | "frames" | "video";
const FILM_DETAIL_ITEMS: Array<[FilmDetailKey, string, string]> = [
  ["genre", "GENRE", "TO BE SELECTED"], ["country", "COUNTRY", "TO BE CONFIRMED"], ["duration", "DURATION", "AFTER FINAL CUT"],
  ["premiere", "PREMIERE", "NOT PREMIERED"], ["watch", "WHERE TO WATCH", "NOT SELECTED"], ["budget", "BUDGET", "CALCULATED AT PREMIERE"],
  ["production", "PRODUCTION", "STUDIO NAME NOT SET"], ["rating", "RATING", "AFTER PREMIERE"], ["quality", "QUALITY", "AFTER FINAL RENDER"],
];

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
  const [projectLocationUrls, setProjectLocationUrls] = useState<Record<string, string>>({});
  const [authReady, setAuthReady] = useState(false);
  const [projectsOpen, setProjectsOpen] = useState(false);
  const [projectActionId, setProjectActionId] = useState<string | null>(null);
  const [deleteSwipeId, setDeleteSwipeId] = useState<string | null>(null);
  const [favoriteSwipeId, setFavoriteSwipeId] = useState<string | null>(null);
  const [castView, setCastView] = useState<"cast" | "screen-tests">("cast");
  const [screenplayOpenId, setScreenplayOpenId] = useState<string | null>(null);
  const [libraryScreenplayDraft, setLibraryScreenplayDraft] = useState("");
  const [screenplayDownloading, setScreenplayDownloading] = useState(false);
  const [projectOverviewId, setProjectOverviewId] = useState<string | null>(null);
  const [projectOverviewTab, setProjectOverviewTab] = useState<ProjectOverviewTab>("about");
  const [projectOverviewTitle, setProjectOverviewTitle] = useState("");
  const [projectOverviewDescription, setProjectOverviewDescription] = useState("");
  const [descriptionEditing, setDescriptionEditing] = useState(false);
  const [watchPlatformsOpen, setWatchPlatformsOpen] = useState(false);
  const [posterUploading, setPosterUploading] = useState(false);
  const [trashOpen, setTrashOpen] = useState(false);
  const [filmCrewOpen, setFilmCrewOpen] = useState(false);
  const [overviewCastOpen, setOverviewCastOpen] = useState(false);
  const [filmPrivacyEditing, setFilmPrivacyEditing] = useState(false);
  const [hiddenFilmDetailsDraft, setHiddenFilmDetailsDraft] = useState<FilmDetailKey[]>([]);
  const [trashedProjects, setTrashedProjects] = useState<AccountSession[]>([]);
  const projectPosterInputRef = useRef<HTMLInputElement>(null);
  const projectSwipeRef = useRef<{ x: number; y: number; id: string } | null>(null);
  const projectSwipeMoved = useRef(false);

  const presetAvatars = ["🎬", "🎭", "🎞️", "🕯️", "🎥", "✍️"];
  const castActors = Array.from(new Map(accountSessions.flatMap((project) => project.characterCasting?.myCast ?? []).map((actor) => [actor.storagePath ?? actor.image, actor])).values());
  const screenTestActors = Array.from(new Map(accountSessions.flatMap((project) => (project.characterCasting?.generationMessages ?? []).flatMap((message) => message.image && message.candidate ? [{ ...message.candidate, image: message.image }] : [])).map((actor) => [actor.storagePath ?? actor.image, actor])).values());
  const workspaceActors = castView === "cast" ? castActors : screenTestActors;
  const screenplayProjects = accountSessions.filter((project) => project.screenplay?.trim() && project.screenplayLibraryAt).sort((a, b) => (b.screenplayLibraryAt ?? 0) - (a.screenplayLibraryAt ?? 0));
  const openScreenplay = accountSessions.find((project) => project.id === screenplayOpenId);
  const overviewProject = accountSessions.find((project) => project.id === projectOverviewId);
  const overviewPosterUrl = overviewProject ? ((overviewProject.id && projectCoverUrls[overviewProject.id]) || "/project-cover-placeholder.png") : undefined;
  const overviewLocationPaths = [...new Set([
    ...(overviewProject?.locationDesign?.units ?? []).flatMap((unit) => (unit.variants ?? []).map((variant) => variant.storagePath)),
    ...Object.values(overviewProject?.costumeDesign?.characters ?? {}).flatMap((state) => (state.variants ?? []).map((variant) => variant.storagePath)),
  ].filter((path): path is string => Boolean(path)))];
  const overviewLocationPathKey = overviewLocationPaths.join("\n");
  const inferredGenre = (() => {
    const text = `${overviewProject?.projectDocument?.logline ?? ""} ${overviewProject?.screenplay ?? ""}`.toLowerCase();
    if (/ужас|хоррор|демон|призрак|убийц/.test(text)) return "HORROR";
    if (/расслед|полици|преступ|детектив/.test(text)) return "CRIME / THRILLER";
    if (/любов|роман|отношен/.test(text)) return "ROMANCE / DRAMA";
    if (/космос|будущ|робот|иноплан/.test(text)) return "SCIENCE FICTION";
    if (/смеш|комеди|шут/.test(text)) return "COMEDY";
    return "DRAMA";
  })();
  const filmDetailItems: Array<[FilmDetailKey, string, string]> = overviewProject ? [
    ["genre", "GENRE", inferredGenre], ["country", "COUNTRY", overviewProject.filmDetails?.country || "DETECTING…"], ["duration", "DURATION", "AFTER FINAL CUT"],
    ["premiere", "PREMIERE", "NOT PREMIERED"], ["watch", "WHERE TO WATCH", overviewProject.filmDetails?.watchPlatforms?.join(" · ") || "SELECT PLATFORMS"], ["budget", "BUDGET", "CALCULATED AT PREMIERE"],
    ["production", "PRODUCTION", "STUDIO NAME NOT SET"], ["rating", "RATING", "AFTER PREMIERE"], ["quality", "QUALITY", "AFTER FINAL RENDER"],
  ] : FILM_DETAIL_ITEMS;

  useEffect(() => {
    if (!overviewProject?.id || overviewProject.filmDetails?.country) return;
    fetch("/api/viewer-country").then((response) => response.json()).then((data: { country?: string }) => {
      if (!data.country) return;
      const next = getCachedProjects<AccountSession>().map((item) => item.id === overviewProject.id ? { ...item, filmDetails: { ...item.filmDetails, country: data.country } } : item);
      persistAccountProjects(next);
    }).catch(() => undefined);
  }, [overviewProject?.id, overviewProject?.filmDetails?.country]);

  function projectDescription(project: AccountSession) {
    return (project.projectDescription || project.projectDocument?.logline || project.notes || "No project description yet.").trim();
  }

  function projectCharacters(project: AccountSession) {
    const roles = project.characterCasting?.characters ?? [];
    const cast = project.characterCasting?.myCast ?? [];
    const assigned = roles.map((item) => {
      const actor = cast.find((candidate) => (item.storagePath && candidate.storagePath === item.storagePath) || candidate.image === item.image);
      return {
        ...item,
        actorName: item.actorName || actor?.actorName || "ACTOR NOT ASSIGNED",
        role: item.role || item.name || "ROLE NOT SET",
      };
    });
    const assignedImages = new Set(assigned.flatMap((item) => [item.storagePath, item.image].filter(Boolean)));
    const unassigned = cast.filter((actor) => !assignedImages.has(actor.storagePath) && !assignedImages.has(actor.image)).map((actor) => ({ ...actor, role: "ROLE NOT SET" }));
    return [...assigned, ...unassigned];
  }

  function projectCostumes(project: AccountSession) {
    return Object.entries(project.costumeDesign?.characters ?? {}).flatMap(([characterId, state]) => {
      const character = project.characterCasting?.characters?.find((item) => item.id === characterId);
      return (state.variants ?? []).map((item) => ({
        ...item,
        image: item.storagePath ? projectLocationUrls[item.storagePath] : item.image,
        name: character?.actorName || character?.name || state.name || item.name || "ACTOR NOT ASSIGNED",
        actorName: character?.actorName || character?.name || "ACTOR NOT ASSIGNED",
        role: character?.role || character?.name || characterId.replace(/^story-\d+-?/i, "") || "ROLE NOT SET",
        accepted: Boolean(item.id && state.approvedIds?.includes(item.id)),
      }));
    });
  }

  function locationName(label?: string) {
    return (label || "UNTITLED LOCATION")
      .replace(/^(?:INT\.|EXT\.|INT\/EXT\.|INT-EXT\.|I\/E\.|ИНТ\.|НАТ\.|ИНТ\/НАТ\.|ИНТ-НАТ\.)\s*/i, "")
      .replace(/\s+[—–-]\s+(?:DAY|NIGHT|MORNING|EVENING|DAWN|DUSK|ДЕНЬ|НОЧЬ|УТРО|ВЕЧЕР|РАССВЕТ|СУМЕРКИ).*$/i, "")
      .trim();
  }

  function projectLocations(project: AccountSession) {
    return (project.locationDesign?.units ?? []).flatMap((unit) =>
      (unit.variants ?? []).map((item) => ({
        ...item,
        image: item.storagePath ? projectLocationUrls[item.storagePath] : item.image,
        name: locationName(unit.label),
        accepted: Boolean(item.id && unit.approvedIds?.includes(item.id)),
      }))
    );
  }

  function projectLocationCount(project: AccountSession) {
    return new Set((project.locationDesign?.units ?? []).map((unit) => locationName(unit.label)).filter(Boolean)).size;
  }

  function renderLocationAssets(items: ProjectAsset[]) {
    if (!items.length) return <div className="flex min-h-64 items-center justify-center border border-dashed border-white/10 text-center text-[10px] text-white/30">GENERATED LOCATIONS WILL BE STORED HERE.</div>;
    const groups = Object.entries(items.reduce<Record<string, ProjectAsset[]>>((result, item) => {
      const name = item.name || "UNTITLED LOCATION";
      (result[name] ??= []).push(item);
      return result;
    }, {}));
    return <div className="space-y-7">{groups.map(([name, assets]) => <section key={name}>
      <div className="mb-3 flex items-center justify-between border-b border-white/10 pb-2"><p className="text-[9px] font-black text-[#FFDF00]">{name}</p><p className="text-[8px] text-white/35">{assets?.length ?? 0} GENERATIONS</p></div>
      <div className="flex gap-3 overflow-x-auto pb-4">{assets.map((item, index) => <article key={item.id || item.storagePath || index} className="relative aspect-video w-[280px] shrink-0 overflow-hidden bg-[#111] sm:w-[340px] lg:w-[380px]">{item.image ? <img src={item.image} alt={name} loading="lazy" decoding="async" className="h-full w-full object-contain object-center" /> : <div className="flex h-full items-center justify-center text-[9px] text-white/20">{item.storagePath ? "LOADING…" : "NO PREVIEW"}</div>}{item.accepted && <span className="absolute right-3 top-3 bg-black/75 px-2.5 py-1.5 text-[7px] font-black text-[#FFDF00] backdrop-blur">APPROVED</span>}</article>)}</div>
    </section>)}</div>;
  }

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
      const response = await authenticatedFetch("/api/screenplay-pdf", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: openScreenplay.title ?? openScreenplay.projectDocument?.title, logline: openScreenplay.projectDocument?.logline ?? openScreenplay.notes, screenplay: libraryScreenplayDraft, secondDirector: openScreenplay.secondDirector?.name, screenwriter: openScreenplay.screenwriter?.name }) });
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
    queueMicrotask(() => { setAccountSessions(getCachedProjects<AccountSession>()); setTrashedProjects(getTrashedProjects<AccountSession>()); });
    void syncProjects<AccountSession>().then((projects) => { setAccountSessions(projects); setTrashedProjects(getTrashedProjects<AccountSession>()); }).catch(console.error);
  }, []);

  useEffect(() => {
    const refreshCloudProjects = () => void syncProjects<AccountSession>().then((projects) => { setAccountSessions(projects); setTrashedProjects(getTrashedProjects<AccountSession>()); }).catch(console.error);
    const refreshWhenVisible = () => { if (document.visibilityState === "visible") refreshCloudProjects(); };
    window.addEventListener("focus", refreshCloudProjects);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      window.removeEventListener("focus", refreshCloudProjects);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, []);

  useEffect(() => {
    if (!projectOverviewId || !overviewLocationPaths.length) return;
    void createMediaUrls(overviewLocationPaths, 60 * 60 * 6)
      .then((urls) => setProjectLocationUrls((current) => ({ ...current, ...urls })))
      .catch(console.error);
  }, [projectOverviewId, overviewLocationPathKey]);

  useEffect(() => {
    if (recoveryCooldown <= 0) return;
    const timer = window.setInterval(() => setRecoveryCooldown((current) => Math.max(0, current - 1)), 1000);
    return () => window.clearInterval(timer);
  }, [recoveryCooldown]);

  useEffect(() => {
    let cancelled = false;
    const covers = [...accountSessions, ...trashedProjects].filter((project) => project.id && project.coverPath);
    if (!covers.length) return;
    void Promise.all(covers.map(async (project) => {
      try {
        const url = await createMediaUrl(project.coverPath!, 60 * 60 * 6);
        await new Promise<void>((resolve, reject) => {
          const preview = new Image();
          const timeout = window.setTimeout(() => reject(new Error("Cover preview timed out")), 15000);
          preview.onload = () => { window.clearTimeout(timeout); resolve(); };
          preview.onerror = () => { window.clearTimeout(timeout); reject(new Error("Cover preview is unavailable")); };
          preview.src = url;
        });
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
  }, [accountSessions, trashedProjects]);

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

  function openProjectOverview(project: AccountSession) {
    const id = project.id ?? crypto.randomUUID();
    if (!project.id) {
      project.id = id;
      persistAccountProjects(accountSessions.map((item) => item === project ? { ...item, id } : item));
    }
    setProjectOverviewId(id);
    setProjectOverviewTab("about");
    setProjectOverviewTitle(project.title || project.projectDocument?.title || "UNTITLED PROJECT");
    setProjectOverviewDescription(projectDescription(project));
    setDescriptionEditing(false);
    setOverviewCastOpen(false);
    setFilmCrewOpen(false);
    setWatchPlatformsOpen(false);
    setHiddenFilmDetailsDraft(project.filmDetails?.hiddenFields ?? []);
    setFilmPrivacyEditing(false);
    setProjectsOpen(false);
  }

  function saveFilmDetailPrivacy() {
    if (!overviewProject?.id) return;
    const filmDetails = { ...overviewProject.filmDetails, hiddenFields: hiddenFilmDetailsDraft };
    const next = accountSessions.map((item) => item.id === overviewProject.id ? { ...item, filmDetails } : item);
    persistAccountProjects(next);
    const activeRaw = sessionStorage.getItem("carabasaiCreativeSession");
    if (activeRaw) {
      const active = JSON.parse(activeRaw) as AccountSession;
      if (active.id === overviewProject.id) sessionStorage.setItem("carabasaiCreativeSession", JSON.stringify({ ...active, filmDetails }));
    }
    setFilmPrivacyEditing(false);
    setMessage("FILM VISIBILITY SAVED.");
  }

  function enterProject(project: AccountSession) {
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

  function enterProjectFromOverview(project: AccountSession) {
    window.sessionStorage.setItem("carabasaiCreativeSession", JSON.stringify(project));
    if (project.id) window.localStorage.setItem(ACTIVE_PROJECT_KEY, project.id);
    window.dispatchEvent(new Event("carabasai-sidebar-change"));
    setProjectsOpen(false);
    const destinations: Record<ProjectOverviewTab, string> = {
      about: project.projectDocument ? "/studio/project" : "/studio",
      screenplay: "/studio/project",
      characters: "/studio/character-casting",
      costumes: "/studio/costume",
      locations: "/studio/locations",
      frames: "/studio/project?section=frames",
      video: "/studio/project?section=video",
    };
    window.location.assign(destinations[projectOverviewTab]);
  }

  function enterProjectStage(project: AccountSession, stage: "crew" | "dialogue" | "summary") {
    const id = project.id ?? crypto.randomUUID();
    const activeProject = project.id ? project : { ...project, id };
    if (!project.id) {
      persistAccountProjects(accountSessions.map((item) => item === project ? activeProject : item));
    }
    window.sessionStorage.setItem("carabasaiCreativeSession", JSON.stringify(activeProject));
    window.localStorage.setItem(ACTIVE_PROJECT_KEY, id);
    window.dispatchEvent(new Event("carabasai-sidebar-change"));
    setProjectsOpen(false);
    const destination = stage === "crew"
      ? "/studio"
      : stage === "dialogue"
        ? "/studio/creative-room"
        : "/studio/project";
    window.location.assign(destination);
  }

  function saveProjectOverview() {
    if (!overviewProject?.id) return;
    const title = projectOverviewTitle.trim() || "UNTITLED PROJECT";
    const projectDescription = projectOverviewDescription.trim();
    const next = accountSessions.map((item) => item.id === overviewProject.id ? {
      ...item,
      title,
      projectDescription,
      ...(item.projectDocument ? { projectDocument: { ...item.projectDocument, title, logline: projectDescription } } : {}),
    } : item);
    persistAccountProjects(next);
    const activeRaw = sessionStorage.getItem("carabasaiCreativeSession");
    if (activeRaw) {
      const active = JSON.parse(activeRaw) as AccountSession;
      if (active.id === overviewProject.id) sessionStorage.setItem("carabasaiCreativeSession", JSON.stringify({ ...active, title, projectDescription, ...(active.projectDocument ? { projectDocument: { ...active.projectDocument, title, logline: projectDescription } } : {}) }));
    }
    setMessage("PROJECT DETAILS SAVED.");
    setDescriptionEditing(false);
  }

  function toggleWatchPlatform(platform: string) {
    if (!overviewProject?.id) return;
    const current = overviewProject.filmDetails?.watchPlatforms ?? [];
    const watchPlatforms = current.includes(platform) ? current.filter((item) => item !== platform) : [...current, platform];
    const next = accountSessions.map((item) => item.id === overviewProject.id ? { ...item, filmDetails: { ...item.filmDetails, watchPlatforms } } : item);
    persistAccountProjects(next);
  }

  async function replaceProjectPoster(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !overviewProject?.id) return;
    if (!file.type.startsWith("image/") || file.size > 12 * 1024 * 1024) { setMessage("CHOOSE AN IMAGE UP TO 12 MB."); return; }
    setPosterUploading(true);
    try {
      const supabase = createClient();
      const { data } = await supabase.auth.getUser();
      if (!data.user) throw new Error("SIGN IN FIRST.");
      const extension = file.name.split(".").pop()?.toLowerCase() || "jpg";
      const coverPath = `${data.user.id}/${overviewProject.id}/project-covers/custom-${file.lastModified}.${extension}`;
      const { error } = await supabase.storage.from("carabasai-media").upload(coverPath, file, { contentType: file.type, cacheControl: "86400", upsert: true });
      if (error) throw error;
      const next = accountSessions.map((item) => item.id === overviewProject.id ? { ...item, coverPath, coverModel: "manual" } : item);
      persistAccountProjects(next);
      setProjectCoverUrls((current) => ({ ...current, [overviewProject.id!]: URL.createObjectURL(file) }));
      setMessage("PROJECT POSTER UPDATED.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "PROJECT POSTER COULD NOT BE UPDATED.");
    } finally {
      setPosterUploading(false);
    }
  }

  async function removeProjectPoster() {
    if (!overviewProject?.id || !overviewProject.coverPath) return;
    const confirmed = await platformConfirm({ eyebrow: "FILM COVER", title: "DELETE COVER?", message: "The saved film cover will be deleted. The standard CARABASAI template will be shown until a new cover is added.", confirmLabel: "DELETE COVER", tone: "danger" });
    if (!confirmed) return;
    setPosterUploading(true);
    try {
      const { error } = await createClient().storage.from("carabasai-media").remove([overviewProject.coverPath]);
      if (error) throw error;
      const next = accountSessions.map((item) => item.id === overviewProject.id ? { ...item, coverPath: undefined, coverModel: undefined } : item);
      persistAccountProjects(next);
      setProjectCoverUrls((current) => {
        const updated = { ...current };
        delete updated[overviewProject.id!];
        return updated;
      });
      const activeRaw = sessionStorage.getItem("carabasaiCreativeSession");
      if (activeRaw) {
        const active = JSON.parse(activeRaw) as AccountSession;
        if (active.id === overviewProject.id) sessionStorage.setItem("carabasaiCreativeSession", JSON.stringify({ ...active, coverPath: undefined, coverModel: undefined }));
      }
      setMessage("PROJECT COVER DELETED.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "PROJECT COVER COULD NOT BE DELETED.");
    } finally {
      setPosterUploading(false);
    }
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
    const confirmed = await platformConfirm({ eyebrow: "PROJECT ACTION", title: "MOVE PROJECT TO TRASH?", message: `“${name}” will leave your workspace but can be restored from Trash with all its generations.`, confirmLabel: "MOVE TO TRASH", tone: "danger" });
    if (!confirmed) return;
    setAccountSessions((current) => current.filter((item) => item.id !== project.id));
    setDeleteSwipeId(null);
    setProjectActionId(null);
    await deleteProject(project.id);
    setTrashedProjects(getTrashedProjects<AccountSession>());
  }

  async function restoreTrashedProject(project: AccountSession) {
    if (!project.id) return;
    try {
      await restoreProject(project.id);
      setAccountSessions(getCachedProjects<AccountSession>());
      setTrashedProjects(getTrashedProjects<AccountSession>());
      setMessage("PROJECT RESTORED.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "PROJECT COULD NOT BE RESTORED."); }
  }

  async function deleteTrashedProjectForever(project: AccountSession) {
    if (!project.id) return;
    const name = project.title || project.notes || "UNTITLED PROJECT";
    const confirmed = await platformConfirm({ eyebrow: "TRASH", title: "DELETE PROJECT FOREVER?", message: `“${name}” and every screenplay, character, costume, location, frame, video and generated file attached to it will be permanently deleted. This cannot be undone.`, confirmLabel: "DELETE FOREVER", tone: "danger" });
    if (!confirmed) return;
    try {
      await permanentlyDeleteProject(project.id);
      setTrashedProjects(getTrashedProjects<AccountSession>());
      setMessage("PROJECT PERMANENTLY DELETED.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "PROJECT COULD NOT BE DELETED."); }
  }

  function renderProjectAssets(items: Array<ProjectAsset & { actorName?: string; role?: string }>, empty: string, landscape = false) {
    if (!items.length) return <div className="flex min-h-64 items-center justify-center border border-dashed border-white/10 text-center text-[10px] text-white/30">{empty}</div>;
    return <div className={`grid gap-3 ${landscape ? "grid-cols-1 sm:grid-cols-2 xl:grid-cols-3" : "grid-cols-2 sm:grid-cols-3 xl:grid-cols-4"}`}>{items.map((item, index) => {
      const src = item.image;
      return <article key={item.id || item.storagePath || `${item.name}-${index}`} className="overflow-hidden border border-white/10 bg-[#111]">
        <div className={`${landscape ? "aspect-video" : "aspect-[9/16]"} bg-[#111]`}>{src ? <img src={src} alt={item.name || item.actorName || item.role || "Project asset"} loading="lazy" decoding="async" className={`h-full w-full ${landscape ? "object-contain object-center" : "object-cover object-top"}`} /> : <div className="flex h-full items-center justify-center text-[9px] text-white/20">{item.storagePath ? "LOADING…" : "NO PREVIEW"}</div>}</div>
        <div className="p-3"><p className="truncate text-[9px] font-black text-white/85">{item.actorName || item.name || "ACTOR NOT ASSIGNED"}</p>{item.role && <p className="mt-1 truncate text-[8px] text-white/40">{item.role}</p>}{item.accepted && <p className="mt-2 text-[7px] font-black text-[#FFDF00]">APPROVED</p>}</div>
      </article>;
    })}</div>;
  }

  function renderAccountProject(project: AccountSession, index: number) {
    const key = project.id ?? String(project.startedAt ?? index);
    const deleteRevealed = deleteSwipeId === key;
    const favoriteRevealed = favoriteSwipeId === key;
    const image = project.coverPath && project.id ? (projectCoverUrls[project.id] || "/project-cover-placeholder.png") : "/project-cover-placeholder.png";
    return <div key={key} className={`relative h-full min-w-0 w-full max-w-full rounded-[20px] ${deleteRevealed ? "bg-red-950/50" : favoriteRevealed ? "bg-[#FFDF00]/20" : "bg-transparent"}`}>
      {favoriteRevealed && <button type="button" onClick={() => toggleProjectFavorite(project)} className="absolute bottom-0 left-0 top-0 flex w-16 items-center justify-center text-xl text-[#FFDF00] md:hidden" aria-label="Add project to favorites">★</button>}
      {deleteRevealed && <button type="button" onClick={() => void removeAccountProject(project)} className="absolute bottom-0 right-0 top-0 flex w-16 items-center justify-center text-lg text-red-400 md:hidden" aria-label="Delete project">⌫</button>}
      <article
        data-disable-menu-swipe
        className={`relative flex h-full min-w-0 w-full max-w-full flex-col overflow-visible transition-all md:translate-x-0 md:hover:-translate-y-1 ${deleteRevealed ? "-translate-x-16" : favoriteRevealed ? "translate-x-16" : "translate-x-0"}`}
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
        <div role="button" tabIndex={0} onClick={() => { if (projectSwipeMoved.current) { projectSwipeMoved.current = false; return; } openProjectOverview(project); }} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") openProjectOverview(project); }} className="min-w-0 w-full cursor-pointer text-left">
          <div className="aspect-[3/4] w-full overflow-hidden rounded-[18px] border border-white/10 bg-[#101010]"><img src={image} alt="Project cover" onError={(event) => { event.currentTarget.onerror = null; event.currentTarget.src = "/project-cover-placeholder.png"; }} className="h-full w-full object-cover" /></div>
          <h3 className="mt-3 truncate px-1 text-sm font-black uppercase tracking-[.03em] text-white">{project.title || "UNTITLED PROJECT"}</h3>
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
        <header className="flex flex-wrap items-start justify-between gap-5"><div><p className="text-[10px] font-black tracking-[0.18em] text-[#FFDF00]">{name || "CREATOR"}</p><h1 className="mt-3 text-3xl font-black tracking-[-0.05em] sm:text-4xl">WELCOME BACK TO YOUR STUDIO.</h1><p className="mt-3 text-sm text-white/35">{accountSessions.length} active {accountSessions.length === 1 ? "project" : "projects"} in your workspace.</p></div><button type="button" onClick={() => { setTrashedProjects(getTrashedProjects<AccountSession>()); setTrashOpen(true); }} className="border border-white/12 bg-[#111] px-5 py-3 text-[9px] font-black text-white/50 hover:border-red-400/40 hover:text-red-300">TRASH · {trashedProjects.length}</button></header>

        <section className="mt-12"><div className="mb-4 flex items-center justify-between"><h2 className="text-sm font-black tracking-[0.08em]">PRODUCTION WALL</h2><button className="rounded-full border border-white/12 px-4 py-2 text-[9px] font-black text-white/50">OPEN WALL ↗</button></div><div className="relative h-[290px] overflow-hidden rounded-[24px] border border-white/10 bg-[url('/studio-bg.jpeg')] bg-cover bg-center"><div className="absolute inset-0 bg-gradient-to-r from-black/70 via-black/25 to-black/60"/><div className="absolute bottom-7 left-7"><p className="text-[10px] font-black tracking-[0.16em] text-[#FFDF00]">YOUR VISUAL WORKSPACE</p><p className="mt-2 max-w-md text-sm text-white/55">Images, videos, references and generated frames will live here.</p></div></div></section>

        <section className="mt-10 min-w-0"><div className="mb-5 flex items-center justify-between"><h2 className="text-sm font-black tracking-[0.08em]">ACTIVE PROJECTS</h2><button type="button" onClick={() => setProjectsOpen(true)} className="text-[10px] font-black text-white/45 hover:text-[#FFDF00]">VIEW ALL PROJECTS →</button></div><div className="grid min-w-0 grid-cols-2 gap-x-5 gap-y-8 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">{accountSessions.slice(0,6).map((project, index) => renderAccountProject(project, index))}{accountSessions.length === 0 && <Link href="/studio" className="col-span-full flex min-h-52 items-center justify-center rounded-[20px] border border-dashed border-white/15 text-[10px] font-black text-white/35 hover:border-[#FFDF00]/35 hover:text-[#FFDF00]">START YOUR FIRST PROJECT +</Link>}</div></section>
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
      {trashOpen && <div className="fixed inset-0 z-[12100] flex items-center justify-center bg-black/90 p-3 sm:p-6"><button type="button" aria-label="Close trash" onClick={() => setTrashOpen(false)} className="absolute inset-0"/><section role="dialog" aria-modal="true" aria-label="Trash" className="relative flex max-h-[88dvh] w-full max-w-5xl flex-col overflow-hidden border border-white/15 bg-[#090909]"><header className="flex shrink-0 items-center justify-between border-b border-white/10 bg-[#252525] px-5 py-4 sm:px-7"><div><p className="text-[8px] font-black tracking-[.16em] text-red-300">RECOVERY</p><h2 className="mt-1 text-2xl font-black">TRASH</h2></div><button type="button" onClick={() => setTrashOpen(false)} className="h-9 w-9 border border-white/15 text-lg text-white/50">×</button></header><nav className="shrink-0 border-b border-white/10 px-5 py-3 sm:px-7"><span className="inline-flex bg-[#FFDF00] px-4 py-2 text-[8px] font-black text-black">PROJECTS · {trashedProjects.length}</span></nav><div className="min-h-0 flex-1 overflow-y-auto p-5 sm:p-7">{trashedProjects.length ? <div className="grid gap-3 sm:grid-cols-2">{trashedProjects.map((project) => { const image = (project.id ? projectCoverUrls[project.id] : undefined) || project.references?.find((item) => item.type?.startsWith("image/"))?.dataUrl; return <article key={project.id} className="grid grid-cols-[88px_minmax(0,1fr)] overflow-hidden border border-white/10 bg-[#141414]"><div className="aspect-[9/16] bg-[#202020]">{image && <img src={image} alt="Deleted project poster" className="h-full w-full object-cover" />}</div><div className="flex min-w-0 flex-col p-4"><p className="truncate text-sm font-black">{project.title || "UNTITLED PROJECT"}</p><p className="mt-2 line-clamp-2 text-[9px] leading-4 text-white/35">{projectDescription(project)}</p><div className="mt-auto flex flex-wrap gap-2 pt-4"><button type="button" onClick={() => void restoreTrashedProject(project)} className="bg-[#FFDF00] px-4 py-2 text-[8px] font-black text-black">RESTORE</button><button type="button" onClick={() => void deleteTrashedProjectForever(project)} className="border border-red-400/30 px-4 py-2 text-[8px] font-black text-red-300">DELETE FOREVER</button></div></div></article>; })}</div> : <div className="flex min-h-60 items-center justify-center border border-dashed border-white/10 text-[10px] text-white/25">TRASH IS EMPTY.</div>}</div></section></div>}
      {overviewProject && <div className="fixed inset-0 z-[11900] overflow-y-auto bg-black [scrollbar-width:thin] [scrollbar-color:rgba(255,223,0,.35)_transparent]">
        <section role="dialog" aria-modal="true" aria-label="Project overview" className="relative min-h-dvh w-full bg-black">
          <aside className="hidden">
            <div className="flex items-start justify-between gap-3"><div className="min-w-0 flex-1"><p className="text-[8px] font-black tracking-[.16em] text-[#FFDF00]">PROJECT ARCHIVE</p><input value={projectOverviewTitle} onChange={(event) => setProjectOverviewTitle(event.target.value)} aria-label="Project title" className="mt-2 w-full border-b border-white/10 bg-transparent pb-2 text-2xl font-black text-white outline-none focus:border-[#FFDF00]" /></div><button type="button" onClick={() => setProjectOverviewId(null)} className="h-9 w-9 shrink-0 border border-white/15 text-lg text-white/50">×</button></div>
            <button type="button" onClick={() => projectPosterInputRef.current?.click()} className="group relative mx-auto mt-5 block aspect-[9/16] w-full max-w-[270px] overflow-hidden border border-white/12 bg-[#202020]">
              {overviewPosterUrl ? <img src={overviewPosterUrl} alt="Project poster" className="h-full w-full object-cover" /> : <span className="flex h-full items-center justify-center text-[9px] text-white/25">NO POSTER</span>}
              <span className="absolute inset-x-0 bottom-0 bg-black/80 px-4 py-3 text-[8px] font-black text-white/70 opacity-0 transition group-hover:opacity-100">{posterUploading ? "UPLOADING..." : "REPLACE POSTER"}</span>
            </button>
            <input ref={projectPosterInputRef} type="file" accept="image/*" onChange={(event) => void replaceProjectPoster(event)} className="hidden" />
          </aside>
          <div className="min-w-0">
            <div className="relative h-dvh min-h-[620px] overflow-hidden bg-black">
              <div className="absolute inset-y-0 left-0 w-full lg:w-[72%]">
                <img src="/project-overview-cinema.png" alt="Cinema audience" className="h-full w-full object-cover object-center" />
                <div className="absolute inset-0 bg-gradient-to-r from-black/10 via-black/10 to-black lg:from-black/5 lg:via-black/5" />
                <div className="absolute inset-0 bg-gradient-to-t from-black via-transparent to-black/25" />
              </div>
              <button type="button" onClick={() => setProjectOverviewId(null)} aria-label="Close" className="absolute right-5 top-5 z-40 flex h-10 w-10 items-center justify-center rounded-full border border-white/25 bg-black/55 text-xl text-white/80 backdrop-blur hover:bg-white hover:text-black">×</button>
              <div className="absolute inset-y-0 right-0 z-10 flex w-full flex-col px-6 pb-[6vh] pt-[7vh] text-right sm:px-10 lg:w-[38%] lg:px-[4vw]">
                {descriptionEditing ? <input autoFocus value={projectOverviewTitle} onChange={(event) => setProjectOverviewTitle(event.target.value)} aria-label="Film title" className="w-full bg-transparent text-3xl font-black uppercase leading-none tracking-[-.035em] text-white outline-none sm:text-5xl lg:text-[2.7vw]" /> : <h2 className="text-3xl font-black uppercase leading-none tracking-[-.035em] sm:text-5xl lg:text-[2.7vw]">{projectOverviewTitle || overviewProject.title || overviewProject.projectDocument?.title || "UNTITLED PROJECT"}</h2>}
                <div className="relative ml-auto mt-5 w-full max-w-xl">{descriptionEditing ? <textarea value={projectOverviewDescription} onChange={(event) => setProjectOverviewDescription(event.target.value)} maxLength={1200} aria-label="Film description" className="min-h-20 w-full resize-none bg-transparent pb-2 pr-8 text-right text-sm font-semibold leading-6 text-white/90 outline-none" /> : <p className="line-clamp-3 pr-8 text-right text-sm font-semibold leading-6 text-white/90">{projectOverviewDescription}</p>}<button type="button" onClick={() => descriptionEditing ? saveProjectOverview() : setDescriptionEditing(true)} className="absolute right-0 top-0 text-xl text-[#FFDF00]">{descriptionEditing ? "✓" : "✎"}</button></div>
                <div className="relative mt-[8vh]"><p className="text-xs font-black tracking-[.08em] text-white/90">В РОЛЯХ</p><div className={`mt-5 flex items-start justify-end gap-5 ${overviewCastOpen ? "absolute right-0 z-30 w-max max-w-[78vw] bg-black/90 p-5" : ""}`}>{overviewProject.characterCasting?.characters?.filter((actor) => actor.image).slice(0, overviewCastOpen ? 999 : 4).map((actor) => <div key={actor.id || actor.actorName || actor.role} className="w-20 shrink-0 text-right"><div className="ml-auto h-16 w-16 overflow-hidden rounded-full bg-[#222] lg:h-[4.4vw] lg:w-[4.4vw] lg:max-h-20 lg:max-w-20"><img src={actor.image} alt={actor.actorName || actor.name || actor.role || "Actor"} className="h-full w-full object-cover object-top" /></div><p className="mt-2 truncate text-[9px] font-black">{actor.actorName || actor.name || "ACTOR"}</p><p className="mt-1 truncate text-[7px] text-white/40">{actor.role || "ROLE"}</p></div>)}{(overviewProject.characterCasting?.characters?.filter((actor) => actor.image).length ?? 0) > 4 && <button type="button" onClick={() => setOverviewCastOpen((current) => !current)} className="mt-5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#FFDF00] text-xl font-black text-black">{overviewCastOpen ? "−" : "+"}</button>}</div></div>
                <div className="mt-[7vh] grid grid-cols-3 gap-6 text-right"><div><p className="text-[9px] font-black text-white/30">DIRECTOR</p><p className="mt-2 truncate text-xs font-black">{name || userEmail || "THE PLAYER"}</p></div><div><p className="text-[9px] font-black text-white/30">SECOND DIRECTOR</p><p className="mt-2 truncate text-xs font-black">{overviewProject.secondDirector?.name || "NOT ASSIGNED"}</p></div><div><p className="text-[9px] font-black text-white/30">SCREENWRITER</p><p className="mt-2 truncate text-xs font-black">{overviewProject.screenwriter?.name || "NOT ASSIGNED"}</p></div></div>
                <button type="button" onClick={() => setFilmCrewOpen((current) => !current)} className="ml-auto mt-5 flex items-center justify-end gap-3 text-right text-[9px] font-black text-[#FFDF00]"><span>FULL FILM CREW</span><span>{filmCrewOpen ? "−" : "+"}</span></button>
                {filmCrewOpen && <div className="mt-3 grid grid-cols-2 gap-x-6 gap-y-3 bg-black/75 py-3 text-right">{[["CHARACTER SPECIALIST", overviewProject.characterCastingSpecialist?.name], ["COSTUME SPECIALIST", overviewProject.costumeDesign?.specialistName], ["LOCATION SPECIALIST", locationSpecialists.find((item) => item.id === overviewProject.locationDesign?.specialistId)?.name], ["CINEMATOGRAPHER", overviewProject.cinematography?.specialistName], ["SOUND", overviewProject.cinematography?.soundSpecialistName]].map(([role, member]) => <div key={role}><p className="text-[7px] text-white/30">{role}</p><p className="mt-1 text-[9px] font-black">{member || "TO BE SELECTED"}</p></div>)}</div>}
                <div className="mt-auto flex items-end justify-end gap-3"><button type="button" onClick={() => enterProjectFromOverview(overviewProject)} className="w-full max-w-[390px] bg-[#FFDF00] px-8 py-5 text-sm font-black text-black">PLAY</button><button type="button" title="Change image" onClick={() => projectPosterInputRef.current?.click()} className="pb-4 text-xl text-[#FFDF00]">✦</button>{overviewProject.coverPath && <button type="button" title="Delete poster" onClick={() => void removeProjectPoster()} className="pb-4 text-xl text-red-300">×</button>}</div>
              </div>
            </div>
            <header className="sticky top-0 z-50 flex justify-center gap-1.5 overflow-x-auto bg-[#080808] px-4 py-5 shadow-[0_12px_35px_rgba(0,0,0,.65)]">{(["about", "screenplay", "characters", "costumes", "locations", "frames", "video"] as ProjectOverviewTab[]).map((tab) => <button key={tab} type="button" onClick={() => setProjectOverviewTab(tab)} className={`shrink-0 bg-[#FFDF00] px-8 py-4 text-xs font-black uppercase tracking-[.08em] text-black transition ${projectOverviewTab === tab ? "opacity-100" : "opacity-45 hover:opacity-75"}`}>{tab === "about" ? "ABOUT FILM" : tab}</button>)}</header>
            <div className={`min-h-dvh ${projectOverviewTab === "about" ? "p-0" : "p-4 sm:p-7"}`}>
              {projectOverviewTab === "about" && <div className="relative min-h-full overflow-hidden bg-[#090909]">
                <div className="hidden">
                  {overviewPosterUrl ? <img src={overviewPosterUrl} alt="Project poster" className="h-full w-full object-contain object-left-top" /> : <div className="flex h-full items-center justify-center text-[9px] text-white/20">NO POSTER</div>}
                  <div className="absolute inset-0 hidden bg-gradient-to-r from-transparent via-black/45 to-[#090909] lg:block" />
                  <div className="absolute inset-0 bg-gradient-to-t from-[#090909] via-transparent to-black/15 lg:bg-gradient-to-t lg:from-[#090909]/60 lg:via-transparent" />
                </div>
                <div className="relative z-10 w-full px-6 pb-20 pt-12 sm:px-10 lg:px-[8vw] lg:pb-24 lg:pt-16">
                <div className="hidden">

                <section className="mt-14"><div className="flex items-end justify-between"><div><p className="text-[8px] font-black tracking-[.14em] text-white/30">CAST</p><h3 className="mt-2 text-2xl font-black">В РОЛЯХ</h3></div><p className="text-[8px] text-white/30">{overviewProject.characterCasting?.characters?.filter((actor) => actor.image).length ?? 0} ACTORS</p></div>
                  <div className="mt-6 flex gap-5 overflow-x-auto pb-3">{overviewProject.characterCasting?.characters?.filter((actor) => actor.image).map((actor) => <div key={actor.id || actor.actorName || actor.role} className="w-24 shrink-0 text-center"><div className="mx-auto h-20 w-20 overflow-hidden rounded-full border border-white/20 bg-[#222]"><img src={actor.image} alt={actor.actorName || actor.name || actor.role || "Actor"} className="h-full w-full object-cover object-top" /></div><p className="mt-2 truncate text-[9px] font-black">{actor.actorName || actor.name || "ACTOR"}</p><p className="mt-1 truncate text-[7px] text-white/35">{actor.role || "ROLE"}</p></div>)}</div>
                </section></div>

                <section className="hidden mt-12 border-y border-white/10 py-7"><div className="grid gap-7 sm:grid-cols-3"><div><p className="text-[8px] text-white/30">DIRECTOR</p><p className="mt-2 text-sm font-black">{name || userEmail || "THE PLAYER"}</p></div><div><p className="text-[8px] text-white/30">SECOND DIRECTOR</p><p className="mt-2 text-sm font-black">{overviewProject.secondDirector?.name || "NOT ASSIGNED"}</p></div><div><p className="text-[8px] text-white/30">SCREENWRITER</p><p className="mt-2 text-sm font-black">{overviewProject.screenwriter?.name || "NOT ASSIGNED"}</p></div></div>
                  <button type="button" onClick={() => setFilmCrewOpen((current) => !current)} className="mt-7 flex w-full items-center justify-between text-left text-[9px] font-black text-[#FFDF00]"><span>FULL FILM CREW</span><span>{filmCrewOpen ? "−" : "+"}</span></button>
                  {filmCrewOpen && <div className="mt-5 grid gap-x-10 gap-y-5 border-t border-white/10 pt-5 sm:grid-cols-2">{[
                    ["CHARACTER SPECIALIST", overviewProject.characterCastingSpecialist?.name],
                    ["COSTUME SPECIALIST", overviewProject.costumeDesign?.specialistName],
                    ["LOCATION SPECIALIST", locationSpecialists.find((item) => item.id === overviewProject.locationDesign?.specialistId)?.name],
                    ["CINEMATOGRAPHER", overviewProject.cinematography?.specialistName],
                    ["SOUND", overviewProject.cinematography?.soundSpecialistName],
                  ].map(([role, member]) => <div key={role}><p className="text-[7px] text-white/30">{role}</p><p className="mt-2 text-[10px] font-black">{member || "TO BE SELECTED"}</p></div>)}</div>}
                </section>

                <section><div className="flex items-center justify-between gap-4"><p className="text-sm font-black tracking-[.14em] text-white/30">FILM DETAILS</p>{filmPrivacyEditing ? <div className="flex gap-2"><button type="button" onClick={() => { setHiddenFilmDetailsDraft(overviewProject.filmDetails?.hiddenFields ?? []); setFilmPrivacyEditing(false); }} className="px-5 py-3 text-xs font-black text-white/45">CANCEL</button><button type="button" onClick={saveFilmDetailPrivacy} className="bg-[#FFDF00] px-6 py-3 text-xs font-black text-black">CONFIRM</button></div> : <button type="button" onClick={() => { setHiddenFilmDetailsDraft(overviewProject.filmDetails?.hiddenFields ?? []); setFilmPrivacyEditing(true); }} className="px-5 py-3 text-xs font-black text-white/45 hover:text-[#FFDF00]">HIDE VALUES</button>}</div>
                  {filmPrivacyEditing && <p className="mt-3 text-[9px] leading-5 text-white/35">Mark the values that viewers must not see. You will still see them as hidden.</p>}
                  <div className="mt-8 grid gap-x-[6vw] sm:grid-cols-2">{filmDetailItems.map(([key, label, value]) => {
                    const hidden = (filmPrivacyEditing ? hiddenFilmDetailsDraft : overviewProject.filmDetails?.hiddenFields ?? []).includes(key);
                    return <div key={key} className="relative flex min-h-28 items-center justify-between gap-4 py-5"><div><p className="text-sm text-white/30">{label}</p>{key === "watch" ? <button type="button" onClick={() => setWatchPlatformsOpen((current) => !current)} className="relative z-20 mt-3 text-left text-lg font-black text-white/90">{value} <span className="text-[#FFDF00]">▾</span></button> : <p className="mt-3 text-lg font-black">{value} {hidden && <span className="text-sm font-normal text-white/25">(HIDDEN)</span>}</p>}</div>{filmPrivacyEditing && <label className="flex cursor-pointer items-center gap-2 text-xs text-white/40"><span>HIDE</span><input type="checkbox" checked={hidden} onChange={(event) => setHiddenFilmDetailsDraft((current) => event.target.checked ? [...new Set([...current, key])] : current.filter((item) => item !== key))} className="accent-[#FFDF00]" /></label>}{key === "watch" && watchPlatformsOpen && <><button type="button" aria-label="Close platform menu" onClick={() => setWatchPlatformsOpen(false)} className="fixed inset-0 z-10 cursor-default" /><div className="absolute left-0 top-[82px] z-20 w-64 bg-[#171717] p-3 shadow-2xl">{[["Instagram", "◎"], ["TikTok", "♪"], ["YouTube", "▶"], ["Other", "+"]].map(([platform, icon]) => <label key={platform} className="flex cursor-pointer items-center gap-3 px-3 py-3 text-sm hover:bg-white/5"><span className="flex h-7 w-7 items-center justify-center rounded-md bg-white text-sm font-black text-black">{icon}</span><span className="flex-1 font-bold">{platform}</span><input type="checkbox" checked={overviewProject.filmDetails?.watchPlatforms?.includes(platform) ?? false} onChange={() => toggleWatchPlatform(platform)} className="accent-[#FFDF00]" /></label>)}</div></>}</div>;
                  })}</div>
                </section>
                <div className="mt-12 flex flex-wrap gap-x-14 gap-y-5 pt-8">
                  {[[overviewProject.characterCasting?.characters?.length ?? 0, "CHARACTERS"], [projectCostumes(overviewProject).length, "COSTUMES"], [projectLocationCount(overviewProject), "LOCATIONS"], [overviewProject.frames?.length ?? 0, "FRAMES"]].map(([count, label]) => <div key={label}><span className="text-3xl font-black text-[#FFDF00]">{count}</span><span className="ml-3 text-sm text-white/35">{label}</span></div>)}
                </div>
                </div>
              </div>}
              {projectOverviewTab === "screenplay" && (overviewProject.screenplay ? <div><p className="text-[9px] font-black text-[#FFDF00]">FINAL SCREENPLAY</p><pre className="mt-4 max-h-[58dvh] overflow-y-auto whitespace-pre-wrap border border-white/10 bg-black p-5 font-mono text-xs leading-6 text-white/70">{overviewProject.screenplay}</pre></div> : <div className="flex min-h-64 items-center justify-center border border-dashed border-white/10 text-[10px] text-white/30">THE SCREENPLAY WILL APPEAR HERE WHEN IT IS READY.</div>)}
              {projectOverviewTab === "characters" && renderProjectAssets(projectCharacters(overviewProject), "CASTING CHARACTERS WILL BE STORED HERE.")}
              {projectOverviewTab === "costumes" && renderProjectAssets(projectCostumes(overviewProject), "APPROVED AND GENERATED COSTUMES WILL BE STORED HERE.", true)}
              {projectOverviewTab === "locations" && renderLocationAssets(projectLocations(overviewProject))}
              {projectOverviewTab === "frames" && renderProjectAssets(overviewProject.frames ?? [], "GENERATED FRAMES WILL BE STORED HERE.")}
              {projectOverviewTab === "video" && renderProjectAssets(overviewProject.videos ?? [], "GENERATED VIDEO CLIPS WILL BE STORED HERE.")}
            </div>
          </div>
        </section>
      </div>}
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
      <form onSubmit={authenticate} autoComplete={mode === "sign-up" ? "off" : "on"} className="mt-5 space-y-3">
        {mode === "sign-up" && <input type="text" required value={name} onChange={(event) => setName(event.target.value)} placeholder="YOUR NAME" autoComplete="name" className="h-14 w-full rounded-[14px] border border-white/10 bg-black/30 px-4 text-sm outline-none focus:border-[#FFDF00]/50" />}
        <input type="email" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="EMAIL" autoComplete="email" className="h-14 w-full rounded-[14px] border border-white/10 bg-black/30 px-4 text-sm outline-none focus:border-[#FFDF00]/50" />
        <input type="password" name={mode === "sign-up" ? "carabasai-registration-password" : "password"} required minLength={8} value={password} onChange={(event) => setPassword(event.target.value)} placeholder="PASSWORD" autoComplete={mode === "sign-up" ? "off" : "current-password"} data-1p-ignore={mode === "sign-up" ? "true" : undefined} data-lpignore={mode === "sign-up" ? "true" : undefined} autoCapitalize="none" spellCheck={false} className="h-14 w-full rounded-[14px] border border-white/10 bg-black/30 px-4 text-sm outline-none focus:border-[#FFDF00]/50" />
        {mode === "sign-up" && <input type="password" name="carabasai-registration-password-confirmation" required minLength={8} value={passwordConfirmation} onChange={(event) => setPasswordConfirmation(event.target.value)} placeholder="REPEAT PASSWORD" autoComplete="off" data-1p-ignore="true" data-lpignore="true" autoCapitalize="none" spellCheck={false} className="h-14 w-full rounded-[14px] border border-white/10 bg-black/30 px-4 text-sm outline-none focus:border-[#FFDF00]/50" />}
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
