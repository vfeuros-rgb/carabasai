"use client";

import { createClient } from "./supabase/client";
import { normalizeAutomaticProjectTitle } from "./project-title";

export type StoredProject = {
  id?: string;
  title?: string;
  notes?: string;
  startedAt?: number;
  favorite?: boolean;
  secondDirector?: unknown;
  screenwriter?: unknown;
  messages?: unknown[];
  notebook?: unknown[];
  projectDocument?: unknown;
  references?: unknown[];
  stage?: "crew" | "dialogue" | "summary" | "casting";
  libraryArchive?: boolean;
  [key: string]: unknown;
};

type ProjectMediaNode = Record<string, unknown>;

const STORAGE_KEY = "carabasaiSessionHistory";
export const ACTIVE_PROJECT_KEY = "carabasaiActiveProjectId";
const CHANGE_EVENT = "carabasai-projects-change";
const PENDING_SYNC_KEY = "carabasaiPendingProjectSync";

function isUuid(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function projectId(project: StoredProject) {
  if (isUuid(project.id)) return project.id;
  const next = crypto.randomUUID();
  project.id = next;
  return next;
}

function stageOf(project: StoredProject) {
  if (project.stage === "casting" || project.characterCasting) return "casting";
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
  return readLocal().filter((project) => !project.libraryArchive) as T[];
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
  const rows = projects.map((project) => ({
    id: projectId(project),
    user_id: userData.user.id,
    title: String(project.title || project.notes || "Untitled project").slice(0, 240),
    brief: String(project.notes || ""),
    second_director: project.secondDirector ?? null,
    screenwriter: project.screenwriter ?? null,
    ai_provider: localStorage.getItem("carabasaiAIProvider") === "openai" ? "openai" : "anthropic",
    stage: stageOf(project),
    project_document: { carabasai_session: project },
    favorite: Boolean(project.favorite),
    created_at: project.startedAt ? new Date(project.startedAt).toISOString() : new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }));
  const { error } = await supabase.from("projects").upsert(rows, { onConflict: "id" });
  if (error) throw error;
}

export function saveProjects(projects: StoredProject[]) {
  const preservedArchives = readLocal().filter(
    (project) => project.libraryArchive && !projects.some((item) => item.id === project.id),
  );
  const projectsWithArchives = [...projects, ...preservedArchives];
  const previous = new Map(readLocal().map((project) => [project.id, JSON.stringify(project)]));
  const changed = projectsWithArchives.filter((project) => {
    const id = projectId(project);
    return previous.get(id) !== JSON.stringify(project);
  });
  const pending = readPendingIds();
  changed.forEach((project) => pending.add(projectId(project)));
  writePendingIds(pending);
  cacheProjects(projectsWithArchives);
  void upsertRemote(changed)
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
  const next = [project, ...readLocal().filter((item) => item.id !== id)].slice(0, 100);
  saveProjects(next);
  return project;
}

export async function deleteProject(id: string) {
  const allProjects = readLocal();
  const deletedProject = allProjects.find((project) => project.id === id);
  const casting = deletedProject?.characterCasting as {
    myCast?: Array<Record<string, unknown>>;
    generationMessages?: Array<Record<string, unknown>>;
  } | undefined;
  const archivedCast = casting?.myCast ?? [];
  const archivedGenerations = (casting?.generationMessages ?? []).map((message) => ({
    ...message,
    projectTitle: message.projectTitle ?? deletedProject?.title ?? deletedProject?.notes ?? "DELETED PROJECT",
  }));
  let archive = allProjects.find((project) => project.libraryArchive);
  if (archivedCast.length || archivedGenerations.length) {
    const archiveCasting = (archive?.characterCasting ?? {}) as {
      myCast?: Array<Record<string, unknown>>;
      generationMessages?: Array<Record<string, unknown>>;
    };
    const unique = (items: Array<Record<string, unknown>>) => {
      const seen = new Set<string>();
      return items.filter((item) => {
        const candidate = item.candidate as Record<string, unknown> | undefined;
        const key = String(item.storagePath ?? candidate?.storagePath ?? item.image ?? candidate?.image ?? item.id ?? JSON.stringify(item));
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    };
    archive = {
      ...(archive ?? {}),
      id: archive?.id && isUuid(archive.id) ? archive.id : crypto.randomUUID(),
      title: "CARABASAI ACCOUNT CAST LIBRARY",
      notes: "",
      startedAt: archive?.startedAt ?? Date.now(),
      stage: "casting",
      libraryArchive: true,
      characterCasting: {
        ...archiveCasting,
        myCast: unique([...(archiveCasting.myCast ?? []), ...archivedCast]),
        generationMessages: unique([...(archiveCasting.generationMessages ?? []), ...archivedGenerations]),
      },
    };
  }
  const nextLocal = allProjects.filter((project) => project.id !== id && !project.libraryArchive);
  if (archive) nextLocal.push(archive);
  cacheProjects(nextLocal);
  const pending = readPendingIds();
  pending.delete(id);
  writePendingIds(pending);
  if (archive) await upsertRemote([archive]);
  if (!isUuid(id)) return;
  const supabase = createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return;
  const { error } = await supabase
    .from("projects")
    .delete()
    .eq("id", id)
    .eq("user_id", userData.user.id);
  if (error) throw error;
}

export async function syncProjects<T extends StoredProject = StoredProject>(options?: { includeLibrary?: boolean }): Promise<T[]> {
  const local = readLocal();
  const localResult = () => (options?.includeLibrary ? local : local.filter((project) => !project.libraryArchive)) as T[];
  let supabase;
  try { supabase = createClient(); } catch { return localResult(); }
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return localResult();

  const { data, error } = await supabase.from("projects").select("*").order("updated_at", { ascending: false });
  if (error) throw error;
  const remote: StoredProject[] = (data ?? []).map((row) => {
    const snapshot = row.project_document?.carabasai_session as StoredProject | undefined;
    return snapshot ? { ...snapshot, id: row.id, favorite: row.favorite, stage: row.stage, title: normalizeAutomaticProjectTitle(snapshot.title, snapshot.notes) } : {
      id: row.id,
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
  const localPending = local.filter((project) => project.id && pending.has(project.id));
  if (localPending.length) {
    await upsertRemote(localPending);
    const remaining = readPendingIds();
    localPending.forEach((project) => project.id && remaining.delete(project.id));
    writePendingIds(remaining);
  }
  const remoteIds = new Set(remote.map((project) => project.id));
  const pendingNotYetRemote = localPending.filter((project) => !remoteIds.has(project.id));
  const merged = [...remote, ...pendingNotYetRemote].sort((a, b) => {
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
      if (remoteActive && active.id && !pending.has(active.id)) {
        sessionStorage.setItem("carabasaiCreativeSession", JSON.stringify(remoteActive));
        window.dispatchEvent(new Event("carabasai-active-project-change"));
      }
    }
  } catch {
    // A malformed tab-only session must not block account cloud sync.
  }
  return (options?.includeLibrary ? merged : merged.filter((project) => !project.libraryArchive)) as T[];
}

export const projectChangeEvent = CHANGE_EVENT;
