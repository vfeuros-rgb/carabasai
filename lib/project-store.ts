"use client";

import { createClient } from "./supabase/client";
import { normalizeAutomaticProjectTitle } from "./project-title";

export type StoredProject = {
  id?: string;
  title?: string;
  notes?: string;
  startedAt?: number;
  updatedAt?: number;
  favorite?: boolean;
  secondDirector?: unknown;
  screenwriter?: unknown;
  messages?: unknown[];
  notebook?: unknown[];
  projectDocument?: unknown;
  references?: unknown[];
  stage?: "crew" | "dialogue" | "summary" | "casting" | "costume" | "locations" | "cinematography" | "storyboard";
  libraryArchive?: boolean;
  trashedAt?: number;
  [key: string]: unknown;
};

type ProjectMediaNode = Record<string, unknown>;

const STORAGE_KEY = "carabasaiSessionHistory";
export const ACTIVE_PROJECT_KEY = "carabasaiActiveProjectId";
const CHANGE_EVENT = "carabasai-projects-change";
const PENDING_SYNC_KEY = "carabasaiPendingProjectSync";
let remoteWriteQueue: Promise<void> = Promise.resolve();

// Signed URLs are delivery credentials, not project data. Keeping them inside
// project_document made every refresh look like a project edit and duplicated
// large data URLs in Postgres. Durable storagePath values are the only media
// references persisted to the project snapshot.
const TRANSIENT_MEDIA_KEYS = new Set(["signedUrl", "imageUrl", "downloadUrl", "previewUrl"]);

function prepareProjectForRemote(value: unknown, seen = new WeakSet<object>()): unknown {
  if (value == null || typeof value !== "object") return value;
  if (seen.has(value)) return undefined;
  seen.add(value);
  if (Array.isArray(value)) return value.map((item) => prepareProjectForRemote(item, seen));

  const source = value as Record<string, unknown>;
  const durableMedia = typeof source.storagePath === "string" && source.storagePath.length > 0;
  return Object.fromEntries(Object.entries(source).flatMap(([key, item]) => {
    if (TRANSIENT_MEDIA_KEYS.has(key)) return [];
    if (durableMedia && ["image", "url", "dataUrl"].includes(key) && typeof item === "string") return [];
    const prepared = prepareProjectForRemote(item, seen);
    return prepared === undefined ? [] : [[key, prepared]];
  }));
}

function countProjectContent(value: unknown, seen = new WeakSet<object>()): number {
  if (value == null) return 0;
  if (typeof value === "string") return value.length > 0 ? 1 : 0;
  if (typeof value !== "object") return 0;
  if (seen.has(value)) return 0;
  seen.add(value);
  if (Array.isArray(value)) return value.reduce((total, item) => total + 2 + countProjectContent(item, seen), 0);
  return Object.entries(value as Record<string, unknown>).reduce((total, [key, item]) => {
    if (["image", "signedUrl"].includes(key) && typeof item === "string") return total + 1;
    return total + countProjectContent(item, seen);
  }, 0);
}

function projectRichness(project: StoredProject) {
  return countProjectContent({
    messages: project.messages,
    notebook: project.notebook,
    projectDocument: project.projectDocument,
    characterCasting: project.characterCasting,
    generationMessages: project.generationMessages,
    costumeDepartment: project.costumeDepartment,
    locations: project.locations,
    cinematography: project.cinematography,
    storyboard: project.storyboard,
    references: project.references,
    coverPath: project.coverPath,
  });
}

function localProjectWins(local: StoredProject, cloud?: StoredProject, pending?: Set<string>) {
  if (!cloud) return Boolean(local.id && pending?.has(local.id));
  if (local.id && pending?.has(local.id)) return true;
  const localRevision = Number(local.updatedAt ?? 0);
  const cloudRevision = Number(cloud.updatedAt ?? 0);
  if (localRevision && localRevision > cloudRevision) return true;
  // Backward compatibility for projects created before revision timestamps:
  // a cloud snapshot must never erase cast, costumes or other generated assets.
  return projectRichness(local) > projectRichness(cloud);
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function projectId(project: StoredProject) {
  if (isUuid(project.id)) return project.id;
  const next = crypto.randomUUID();
  project.id = next;
  return next;
}

function stageOf(project: StoredProject): "crew" | "dialogue" | "summary" | "production" {
  // The database keeps a deliberately broad production stage for every step
  // after the screenplay. The precise step remains in the serialized session.
  if (["casting", "costume", "locations", "cinematography", "storyboard"].includes(project.stage ?? "") || project.characterCasting) return "production";
  if (project.projectDocument) return "summary";
  if (project.messages?.length) return "dialogue";
  return "crew";
}

function readLocal(): StoredProject[] {
  try {
    return (JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]") as StoredProject[]).map((project) => ({
      ...project,
      title: normalizeAutomaticProjectTitle(project.title, project.notes),
    }));
  } catch {
    return [];
  }
}

function collectStoragePaths(value: unknown, paths: Set<string>) {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((item) => collectStoragePaths(item, paths));
    return;
  }
  const node = value as ProjectMediaNode;
  if (typeof node.storagePath === "string" && node.storagePath) paths.add(node.storagePath);
  Object.values(node).forEach((item) => collectStoragePaths(item, paths));
}

function restoreMediaUrls(value: unknown, urls: Map<string, string>) {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((item) => restoreMediaUrls(item, urls));
    return;
  }
  const node = value as ProjectMediaNode;
  if (typeof node.storagePath === "string") {
    const url = urls.get(node.storagePath);
    if (url) node.image = url;
  }
  const candidate = node.candidate;
  if (candidate && typeof candidate === "object") {
    const candidatePath = (candidate as ProjectMediaNode).storagePath;
    if (typeof candidatePath === "string") {
      const url = urls.get(candidatePath);
      if (url) node.image = url;
    }
  }
  Object.values(node).forEach((item) => restoreMediaUrls(item, urls));
}

async function hydrateProjectMedia(projects: StoredProject[], supabase: ReturnType<typeof createClient>) {
  const paths = new Set<string>();
  projects.forEach((project) => collectStoragePaths(project, paths));
  if (!paths.size) return projects;
  const pathList = [...paths];
  const { data, error } = await supabase.storage.from("carabasai-media").createSignedUrls(pathList, 60 * 60 * 24 * 7);
  if (error) {
    console.error("Project media URL refresh failed", error);
    return projects;
  }
  const urls = new Map<string, string>();
  data?.forEach((item, index) => {
    if (item.signedUrl) urls.set(pathList[index], item.signedUrl);
  });
  projects.forEach((project) => restoreMediaUrls(project, urls));
  return projects;
}

function readPendingIds() {
  try {
    return new Set(JSON.parse(localStorage.getItem(PENDING_SYNC_KEY) ?? "[]") as string[]);
  } catch {
    return new Set<string>();
  }
}

function writePendingIds(ids: Set<string>) {
  localStorage.setItem(PENDING_SYNC_KEY, JSON.stringify([...ids]));
}

export function getCachedProjects<T extends StoredProject = StoredProject>() {
  return readLocal().filter((project) => !project.libraryArchive && !project.trashedAt) as T[];
}

export function getTrashedProjects<T extends StoredProject = StoredProject>() {
  return readLocal().filter((project) => !project.libraryArchive && Boolean(project.trashedAt)) as T[];
}

export function getCachedProjectsIncludingLibrary<T extends StoredProject = StoredProject>() {
  return readLocal() as T[];
}

export function cacheProjects(projects: StoredProject[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(projects.slice(0, 100)));
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

async function upsertRemote(projects: StoredProject[]) {
  const supabase = createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user || projects.length === 0) return;
  const rows = projects.map((project) => {
    const durableSnapshot = prepareProjectForRemote(project) as StoredProject;
    return ({
    id: projectId(project),
    user_id: userData.user.id,
    title: String(project.title || project.notes || "Untitled project").slice(0, 240),
    brief: String(project.notes || ""),
    second_director: project.secondDirector ?? null,
    screenwriter: project.screenwriter ?? null,
    ai_provider: localStorage.getItem("carabasaiAIProvider") === "openai" ? "openai" : "anthropic",
    stage: stageOf(project),
    project_document: { carabasai_session: durableSnapshot },
    favorite: Boolean(project.favorite),
    created_at: project.startedAt ? new Date(project.startedAt).toISOString() : new Date().toISOString(),
    updated_at: new Date(project.updatedAt ?? Date.now()).toISOString(),
    });
  });
  const { error } = await supabase.from("projects").upsert(rows, { onConflict: "id" });
  if (error) throw error;
}

export function saveProjects(projects: StoredProject[]) {
  const preservedHiddenProjects = readLocal().filter(
    (project) => (project.libraryArchive || project.trashedAt) && !projects.some((item) => item.id === project.id),
  );
  const projectsWithArchives = [...projects, ...preservedHiddenProjects];
  const previous = new Map(readLocal().map((project) => [project.id, JSON.stringify(project)]));
  const changed = projectsWithArchives.filter((project) => {
    const id = projectId(project);
    return previous.get(id) !== JSON.stringify(project);
  });
  const revision = Date.now();
  changed.forEach((project) => { project.updatedAt = Math.max(Number(project.updatedAt ?? 0), revision); });
  const pending = readPendingIds();
  changed.forEach((project) => pending.add(projectId(project)));
  writePendingIds(pending);
  cacheProjects(projectsWithArchives);
  remoteWriteQueue = remoteWriteQueue
    .catch(() => undefined)
    .then(() => upsertRemote(changed));
  void remoteWriteQueue
    .then(() => {
      const remaining = readPendingIds();
      changed.forEach((project) => remaining.delete(projectId(project)));
      writePendingIds(remaining);
    })
    .catch((error) => console.error("Project cloud sync failed", error));
}

export async function setProjectFavorite(id: string, favorite: boolean) {
  const next = readLocal()
    .map((project) => project.id === id ? { ...project, favorite } : project)
    .sort((a, b) => {
      const favoriteDifference = Number(Boolean(b.favorite)) - Number(Boolean(a.favorite));
      if (favoriteDifference) return favoriteDifference;
      return Number(b.startedAt ?? 0) - Number(a.startedAt ?? 0);
    });
  cacheProjects(next);

  if (!isUuid(id)) {
    const project = next.find((item) => item.id === id);
    if (project) await upsertRemote([project]);
    return;
  }

  const supabase = createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return;
  const { error } = await supabase
    .from("projects")
    .update({ favorite, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("user_id", userData.user.id);
  if (error) throw error;
}

export function saveProject(project: StoredProject) {
  const id = projectId(project);
  project.updatedAt = Date.now();
  const next = [project, ...readLocal().filter((item) => item.id !== id)].slice(0, 100);
  saveProjects(next);
  try {
    const activeRaw = sessionStorage.getItem("carabasaiCreativeSession");
    const active = activeRaw ? JSON.parse(activeRaw) as StoredProject : null;
    if (!active || active.id === id) {
      sessionStorage.setItem("carabasaiCreativeSession", JSON.stringify(project));
    }
  } catch {
    sessionStorage.setItem("carabasaiCreativeSession", JSON.stringify(project));
  }
  return project;
}

export async function saveProjectToServer(project: StoredProject) {
  saveProject(project);
  await remoteWriteQueue;
  return project;
}

export function renameProject(id: string, title: string) {
  const nextTitle = title.trim().slice(0, 240);
  if (!nextTitle) return null;
  const rename = (project: StoredProject): StoredProject => {
    if (project.id !== id) return project;
    const projectDocument = project.projectDocument && typeof project.projectDocument === "object"
      ? { ...(project.projectDocument as Record<string, unknown>), title: nextTitle }
      : project.projectDocument;
    return { ...project, title: nextTitle, projectDocument };
  };
  const projects = readLocal().map(rename);
  const renamed = projects.find((project) => project.id === id) ?? null;
  if (!renamed) return null;
  saveProjects(projects);
  try {
    const activeRaw = sessionStorage.getItem("carabasaiCreativeSession");
    if (activeRaw) {
      const active = JSON.parse(activeRaw) as StoredProject;
      if (active.id === id) {
        const renamedActive = rename(active);
        sessionStorage.setItem("carabasaiCreativeSession", JSON.stringify(renamedActive));
        window.dispatchEvent(new Event("carabasai-active-project-change"));
      }
    }
  } catch {
    // Project history remains the source of truth if tab state is malformed.
  }
  return renamed;
}

export async function deleteProject(id: string) {
  const project = readLocal().find((item) => item.id === id);
  if (!project) return;
  const trashed = { ...project, trashedAt: Date.now(), favorite: false };
  const next = readLocal().map((item) => item.id === id ? trashed : item);
  const pending = readPendingIds();
  pending.add(id);
  writePendingIds(pending);
  cacheProjects(next);
  await upsertRemote([trashed]);
  const remaining = readPendingIds();
  remaining.delete(id);
  writePendingIds(remaining);
}

export async function restoreProject(id: string) {
  const project = readLocal().find((item) => item.id === id);
  if (!project) return;
  const { trashedAt: _trashedAt, ...restored } = project;
  void _trashedAt;
  const next = readLocal().map((item) => item.id === id ? restored : item);
  const pending = readPendingIds();
  pending.add(id);
  writePendingIds(pending);
  cacheProjects(next);
  await upsertRemote([restored]);
  const remaining = readPendingIds();
  remaining.delete(id);
  writePendingIds(remaining);
}

export async function permanentlyDeleteProject(id: string) {
  const allProjects = readLocal();
  const deletedProject = allProjects.find((project) => project.id === id);
  if (!deletedProject) return;
  const nextLocal = allProjects.filter((project) => project.id !== id);
  if (!isUuid(id)) { cacheProjects(nextLocal); return; }
  const supabase = createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) throw new Error("SIGN IN TO DELETE THIS PROJECT FOREVER.");
  const storagePaths = new Set<string>();
  collectStoragePaths(deletedProject, storagePaths);
  if (typeof deletedProject.coverPath === "string" && deletedProject.coverPath) storagePaths.add(deletedProject.coverPath);
  if (storagePaths.size) {
    const { error: storageError } = await supabase.storage.from("carabasai-media").remove([...storagePaths]);
    if (storageError) throw storageError;
  }
  const { error } = await supabase
    .from("projects")
    .delete()
    .eq("id", id)
    .eq("user_id", userData.user.id);
  if (error) throw error;
  cacheProjects(nextLocal);
  const pending = readPendingIds();
  pending.delete(id);
  writePendingIds(pending);
}

export async function syncProjects<T extends StoredProject = StoredProject>(options?: { includeLibrary?: boolean }): Promise<T[]> {
  const local = readLocal();
  const localResult = () => (options?.includeLibrary ? local : local.filter((project) => !project.libraryArchive && !project.trashedAt)) as T[];
  let supabase;
  try { supabase = createClient(); } catch { return localResult(); }
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return localResult();

  const { data, error } = await supabase.from("projects").select("*").order("updated_at", { ascending: false });
  if (error) throw error;
  const remote: StoredProject[] = (data ?? []).map((row) => {
    const snapshot = row.project_document?.carabasai_session as StoredProject | undefined;
    const updatedAt = new Date(row.updated_at).getTime();
    return snapshot ? { ...snapshot, id: row.id, updatedAt, favorite: row.favorite, stage: snapshot.stage, title: normalizeAutomaticProjectTitle(snapshot.title, snapshot.notes) } : {
      id: row.id,
      updatedAt,
      title: normalizeAutomaticProjectTitle(row.title, row.brief),
      notes: row.brief,
      startedAt: new Date(row.created_at).getTime(),
      favorite: row.favorite,
      secondDirector: row.second_director,
      screenwriter: row.screenwriter,
      stage: row.stage,
      projectDocument: row.stage === "summary" ? row.project_document : undefined,
    };
  });
  await hydrateProjectMedia(remote, supabase);
  // The database is authoritative. Only projects explicitly changed on this
  // device may be uploaded; stale local copies must never resurrect deletions.
  const pending = readPendingIds();
  const remoteById = new Map(remote.map((project) => [project.id, project]));
  const locallyRicher = local.filter((project) => {
    if (!project.id) return false;
    const cloud = remoteById.get(project.id);
    if (!cloud) return pending.has(project.id);
    return localProjectWins(project, cloud, pending);
  });
  if (locallyRicher.length) {
    await upsertRemote(locallyRicher);
    const remaining = readPendingIds();
    locallyRicher.forEach((project) => project.id && remaining.delete(project.id));
    writePendingIds(remaining);
  }
  const richerById = new Map(locallyRicher.map((project) => [project.id, project]));
  const reconciledRemote = remote.map((project) => richerById.get(project.id) ?? project);
  const remoteIds = new Set(reconciledRemote.map((project) => project.id));
  const pendingNotYetRemote = locallyRicher.filter((project) => !remoteIds.has(project.id));
  const merged = [...reconciledRemote, ...pendingNotYetRemote].sort((a, b) => {
    const favoriteDifference = Number(Boolean(b.favorite)) - Number(Boolean(a.favorite));
    if (favoriteDifference) return favoriteDifference;
    return Number(b.startedAt ?? 0) - Number(a.startedAt ?? 0);
  });
  cacheProjects(merged);
  try {
    const activeRaw = sessionStorage.getItem("carabasaiCreativeSession");
    if (activeRaw) {
      const active = JSON.parse(activeRaw) as StoredProject;
      const remoteActive = merged.find((project) => project.id === active.id);
      if (remoteActive && active.id) {
        const preferredActive = localProjectWins(active, remoteActive, pending) ? active : remoteActive;
        if (preferredActive === active) {
          await upsertRemote([active]);
        }
        sessionStorage.setItem("carabasaiCreativeSession", JSON.stringify(preferredActive));
        window.dispatchEvent(new Event("carabasai-active-project-change"));
      }
    }
  } catch {
    // A malformed tab-only session must not block account cloud sync.
  }
  return (options?.includeLibrary ? merged : merged.filter((project) => !project.libraryArchive && !project.trashedAt)) as T[];
}

export const projectChangeEvent = CHANGE_EVENT;
