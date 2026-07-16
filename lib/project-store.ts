"use client";

import { createClient } from "./supabase/client";

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
  stage?: "crew" | "dialogue" | "summary";
  [key: string]: unknown;
};

const STORAGE_KEY = "carabasaiSessionHistory";
export const ACTIVE_PROJECT_KEY = "carabasaiActiveProjectId";
const CHANGE_EVENT = "carabasai-projects-change";

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
  if (project.projectDocument) return "summary";
  if (project.messages?.length) return "dialogue";
  return "crew";
}

function readLocal(): StoredProject[] {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]") as StoredProject[];
  } catch {
    return [];
  }
}

export function getCachedProjects<T extends StoredProject = StoredProject>() {
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
  cacheProjects(projects);
  void upsertRemote(projects).catch((error) => console.error("Project cloud sync failed", error));
}

export function saveProject(project: StoredProject) {
  const id = projectId(project);
  const next = [project, ...readLocal().filter((item) => item.id !== id)].slice(0, 100);
  saveProjects(next);
  return project;
}

export async function deleteProject(id: string) {
  cacheProjects(readLocal().filter((project) => project.id !== id));
  if (!isUuid(id)) return;
  const supabase = createClient();
  await supabase.from("projects").delete().eq("id", id);
}

export async function syncProjects<T extends StoredProject = StoredProject>(): Promise<T[]> {
  const local = readLocal();
  let supabase;
  try { supabase = createClient(); } catch { return local as T[]; }
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return local as T[];

  if (local.length) await upsertRemote(local);
  const { data, error } = await supabase.from("projects").select("*").order("updated_at", { ascending: false });
  if (error) throw error;
  const remote = (data ?? []).map((row) => {
    const snapshot = row.project_document?.carabasai_session as StoredProject | undefined;
    return snapshot ? { ...snapshot, id: row.id, favorite: row.favorite, stage: row.stage } : {
      id: row.id,
      title: row.title,
      notes: row.brief,
      startedAt: new Date(row.created_at).getTime(),
      favorite: row.favorite,
      secondDirector: row.second_director,
      screenwriter: row.screenwriter,
      stage: row.stage,
      projectDocument: row.stage === "summary" ? row.project_document : undefined,
    };
  });
  cacheProjects(remote);
  return remote as T[];
}

export const projectChangeEvent = CHANGE_EVENT;
