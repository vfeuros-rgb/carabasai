import { NextResponse } from "next/server";
import { AiAccessError, authenticateAiRequest, consumeAiQuota } from "../../../lib/ai-access";

const DIRECTOR_PROFILES: Record<string, string> = {
  "GRISHA PRAVDIN": "grisha_pravdin",
  "MARCO ABSURDO": "marco_absurdo",
  "AMBROSE PEAK": "ambrose_peak",
  "DANTE NOIR": "dante_noir",
  "ZUZU TOON": "zuzu_toon",
};

const SCREENWRITER_PROFILES: Record<string, string> = {
  "STUDIO SCREENWRITER": "default_screenwriter",
  "VERA SUVOROVA": "vera_suvorova",
  "CLARA WAKE": "clara_wake",
  "LEO CUT": "leo_cut",
  "IRIS VOID": "iris_void",
};

type Payload = {
  brief?: string;
  genre?: string;
  conversation?: Array<{ role?: string; speaker?: string; content?: string }>;
  notes?: Array<{ title?: string; detail?: string; accepted?: boolean }>;
  team?: { secondDirector?: string; screenwriter?: string };
};

export async function POST(request: Request) {
  let access;
  try {
    access = await authenticateAiRequest(request);
    await consumeAiQuota(access.supabase, "screenplay-generation", access.user);
  } catch (error) {
    const accessError = error instanceof AiAccessError
      ? error
      : new AiAccessError("SCREENPLAY ACCESS FAILED.", 401);
    return NextResponse.json(
      { error: accessError.message, ...accessError.details },
      { status: accessError.status },
    );
  }

  const serviceUrl = (
    process.env.SCREENPLAY_AGENTS_API_URL
    ?? (process.env.NODE_ENV === "development" ? "http://127.0.0.1:8091" : "")
  ).replace(/\/$/, "");
  if (!serviceUrl) {
    return NextResponse.json(
      { error: "SCREENPLAY_AGENTS_API_URL IS NOT CONFIGURED." },
      { status: 503 },
    );
  }

  const body = (await request.json()) as Payload;
  if (!body.brief?.trim() || !body.team?.secondDirector || !body.team.screenwriter) {
    return NextResponse.json({ error: "INVALID SCREENPLAY SESSION." }, { status: 400 });
  }

  const directorName = body.team.secondDirector.toUpperCase();
  const writerName = body.team.screenwriter.toUpperCase();
  const conversation = (body.conversation ?? [])
    .slice(-60)
    .map((message) => `${message.speaker ?? message.role ?? "user"}: ${message.content ?? ""}`)
    .join("\n\n");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 240_000);
  try {
    const response = await fetch(`${serviceUrl}/generate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(process.env.SCREENPLAY_SERVICE_TOKEN
          ? { Authorization: `Bearer ${process.env.SCREENPLAY_SERVICE_TOKEN}` }
          : {}),
      },
      body: JSON.stringify({
        concept: body.brief,
        conversation,
        genre: body.genre || "drama",
        director_profile: DIRECTOR_PROFILES[directorName] ?? "default_director",
        screenwriter_profile: SCREENWRITER_PROFILES[writerName] ?? "default_screenwriter",
        accepted_notes: (body.notes ?? [])
          .filter((note) => note.accepted)
          .map((note) => `${note.title ?? "Decision"}: ${note.detail ?? ""}`),
      }),
      signal: controller.signal,
    });
    const data = await response.json();
    if (!response.ok) {
      return NextResponse.json(
        { error: data.detail ?? data.error ?? "SCREENPLAY SERVICE FAILED." },
        { status: response.status },
      );
    }
    return NextResponse.json(data);
  } catch (error) {
    const message = error instanceof Error && error.name === "AbortError"
      ? "SCREENPLAY GENERATION TIMED OUT."
      : "SCREENPLAY SERVICE IS UNAVAILABLE.";
    return NextResponse.json({ error: message }, { status: 503 });
  } finally {
    clearTimeout(timer);
  }
}
