import { after, NextResponse } from "next/server";
import { AiAccessError, authenticateAiRequest } from "../../../lib/ai-access";

export const maxDuration = 300;

type ProjectSnapshot = Record<string, unknown> & {
  screenplay?: string;
  screenplayDirectorNotes?: string;
  dialogueAudit?: string;
  screenplayGeneration?: {
    status: "generating" | "complete" | "failed";
    startedAt?: number;
    completedAt?: number;
    failedAt?: number;
    error?: string;
  };
};

type JobPayload = Record<string, unknown> & { projectId?: string };

async function readProject(
  supabase: Awaited<ReturnType<typeof authenticateAiRequest>>["supabase"],
  userId: string,
  projectId: string,
) {
  const { data, error } = await supabase
    .from("projects")
    .select("project_document")
    .eq("id", projectId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error("PROJECT COULD NOT BE LOADED.");
  const envelope = (data?.project_document ?? {}) as Record<string, unknown>;
  return (envelope.carabasai_session ?? {}) as ProjectSnapshot;
}

async function writeProject(
  supabase: Awaited<ReturnType<typeof authenticateAiRequest>>["supabase"],
  userId: string,
  projectId: string,
  patch: Partial<ProjectSnapshot>,
) {
  const current = await readProject(supabase, userId, projectId);
  const next = { ...current, ...patch };
  const { error } = await supabase
    .from("projects")
    .update({ project_document: { carabasai_session: next }, updated_at: new Date().toISOString() })
    .eq("id", projectId)
    .eq("user_id", userId);
  if (error) throw new Error("PROJECT COULD NOT BE SAVED.");
  return next;
}

function publicStatus(snapshot: ProjectSnapshot) {
  return {
    status: snapshot.screenplay ? "complete" : snapshot.screenplayGeneration?.status ?? "idle",
    screenplay: snapshot.screenplay,
    director_notes: snapshot.screenplayDirectorNotes,
    dialogue_audit: snapshot.dialogueAudit,
    error: snapshot.screenplayGeneration?.error,
  };
}

export async function GET(request: Request) {
  try {
    const access = await authenticateAiRequest(request);
    const projectId = new URL(request.url).searchParams.get("projectId")?.trim();
    if (!projectId) return NextResponse.json({ error: "PROJECT ID IS REQUIRED." }, { status: 400 });
    return NextResponse.json(publicStatus(await readProject(access.supabase, access.user.id, projectId)));
  } catch (error) {
    const accessError = error instanceof AiAccessError ? error : null;
    return NextResponse.json(
      { error: accessError?.message ?? (error instanceof Error ? error.message : "PROJECT COULD NOT BE LOADED.") },
      { status: accessError?.status ?? 503 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const access = await authenticateAiRequest(request);
    const body = await request.json() as JobPayload;
    const projectId = body.projectId?.trim();
    if (!projectId) return NextResponse.json({ error: "PROJECT ID IS REQUIRED." }, { status: 400 });

    const snapshot = await readProject(access.supabase, access.user.id, projectId);
    if (snapshot.screenplay) return NextResponse.json(publicStatus(snapshot));

    const generation = snapshot.screenplayGeneration;
    const isFreshJob = generation?.status === "generating"
      && Date.now() - Number(generation.startedAt ?? 0) < 10 * 60_000;
    if (isFreshJob) return NextResponse.json(publicStatus(snapshot), { status: 202 });

    const startedAt = Date.now();
    await writeProject(access.supabase, access.user.id, projectId, {
      screenplayGeneration: { status: "generating", startedAt },
    });

    const authorization = request.headers.get("authorization");
    const cookie = request.headers.get("cookie");
    const endpoint = new URL("/api/screenplay-generation", request.url).toString();
    const generationBody = { ...body };
    delete generationBody.projectId;

    after(async () => {
      try {
        const response = await fetch(endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(authorization ? { Authorization: authorization } : {}),
            ...(cookie ? { Cookie: cookie } : {}),
          },
          body: JSON.stringify(generationBody),
        });
        const result = await response.json() as {
          screenplay?: string;
          director_notes?: string;
          dialogue_audit?: string;
          error?: string;
        };
        if (!response.ok || !result.screenplay) throw new Error(result.error || "SCREENPLAY COULD NOT BE GENERATED.");
        await writeProject(access.supabase, access.user.id, projectId, {
          screenplay: result.screenplay,
          screenplayDirectorNotes: result.director_notes,
          dialogueAudit: result.dialogue_audit,
          screenplayGeneration: { status: "complete", startedAt, completedAt: Date.now() },
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "SCREENPLAY COULD NOT BE GENERATED.";
        await writeProject(access.supabase, access.user.id, projectId, {
          screenplayGeneration: { status: "failed", startedAt, failedAt: Date.now(), error: message },
        }).catch(() => undefined);
      }
    });

    return NextResponse.json({ status: "generating" }, { status: 202 });
  } catch (error) {
    const accessError = error instanceof AiAccessError ? error : null;
    return NextResponse.json(
      { error: accessError?.message ?? (error instanceof Error ? error.message : "SCREENPLAY JOB COULD NOT BE STARTED.") },
      { status: accessError?.status ?? 503 },
    );
  }
}
