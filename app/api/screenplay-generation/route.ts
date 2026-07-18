import { NextResponse } from "next/server";
import { AiAccessError, authenticateAiRequest, consumeAiQuota } from "../../../lib/ai-access";

export const maxDuration = 300;

const DIRECTOR_PROFILES: Record<string, string> = {
  "GRISHA PRAVDIN": "grisha_pravdin",
  "AMBROSE PEAK": "ambrose_peak",
};

const SCREENWRITER_PROFILES: Record<string, string> = {
  "VERA SUVOROVA": "vera_suvorova",
  "CLARA WAKE": "clara_wake",
};

type Payload = {
  brief?: string;
  genre?: string;
  conversation?: Array<{ role?: string; speaker?: string; content?: string }>;
  notes?: Array<{ title?: string; detail?: string; accepted?: boolean }>;
  team?: { secondDirector?: string; screenwriter?: string };
};

type AgentProfile = {
  id: string;
  display_name: string;
  role: "director" | "screenwriter";
  provider: "openai" | "anthropic";
  model: string;
  system_context: string;
  retrieval?: { function_tags?: string[]; max_reference_chars?: number };
};

const STRUCTURE = `Write a 5-8 minute short film around one irreversible choice. Use a hook, disturbance, first decision, escalating obstacles, a loss of support, a climax choice and a brief visual consequence. Every scene must change goal, power, information, risk or relationship. Format with INT./EXT. sluglines, present-tense filmable action, uppercase character cues and dialogue without quotation marks.`;

function serviceHeaders() {
  return {
    "Content-Type": "application/json",
    ...(process.env.SCREENPLAY_SERVICE_TOKEN
      ? { Authorization: `Bearer ${process.env.SCREENPLAY_SERVICE_TOKEN}` }
      : {}),
  };
}

async function complete(profile: AgentProfile, prompt: string, signal: AbortSignal) {
  if (profile.provider === "openai") {
    if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY IS NOT CONFIGURED.");
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      body: JSON.stringify({ model: profile.model, instructions: profile.system_context, input: prompt }),
      signal,
    });
    const data = await response.json() as { output_text?: string; output?: Array<{ content?: Array<{ text?: string }> }>; error?: { message?: string } };
    if (!response.ok) throw new Error(data.error?.message || "OPENAI SCREENPLAY REQUEST FAILED.");
    return data.output_text
      ?? data.output?.flatMap((item) => item.content ?? []).map((item) => item.text ?? "").join("\n").trim()
      ?? "";
  }

  if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY IS NOT CONFIGURED.");
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: profile.model,
      max_tokens: 8000,
      system: profile.system_context,
      messages: [{ role: "user", content: prompt }],
    }),
    signal,
  });
  const data = await response.json() as { content?: Array<{ type?: string; text?: string }>; error?: { message?: string } };
  if (!response.ok) throw new Error(data.error?.message || "ANTHROPIC SCREENPLAY REQUEST FAILED.");
  return data.content?.filter((item) => item.type === "text").map((item) => item.text ?? "").join("\n").trim() ?? "";
}

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
    const directorId = DIRECTOR_PROFILES[directorName];
    const writerId = SCREENWRITER_PROFILES[writerName];
    if (!directorId || !writerId) {
      return NextResponse.json({ error: "SELECTED SPECIALIST IS NO LONGER AVAILABLE." }, { status: 400 });
    }
    const [directorResponse, writerResponse] = await Promise.all([
      fetch(`${serviceUrl}/profiles/${directorId}`, { headers: serviceHeaders(), signal: controller.signal }),
      fetch(`${serviceUrl}/profiles/${writerId}`, { headers: serviceHeaders(), signal: controller.signal }),
    ]);
    if (!directorResponse.ok || !writerResponse.ok) throw new Error("SPECIALIST PROFILE COULD NOT BE LOADED.");
    const director = await directorResponse.json() as AgentProfile;
    const writer = await writerResponse.json() as AgentProfile;

    const approvedNotes = (body.notes ?? [])
      .filter((note) => note.accepted)
      .map((note) => `${note.title ?? "Decision"}: ${note.detail ?? ""}`)
      .join("\n");
    const brief = `DIRECTOR'S BRIEF:\n${body.brief}\n\nCREATIVE ROOM CONVERSATION:\n${conversation}\n\nAPPROVED DECISIONS:\n${approvedNotes || "None separately approved."}`;
    const tags = writer.retrieval?.function_tags ?? ["inciting_incident", "turning_point", "climax"];
    const referenceResponsesPromise = Promise.all(tags.map((functionTag) => fetch(`${serviceUrl}/retrieve`, {
      method: "POST",
      headers: serviceHeaders(),
      body: JSON.stringify({ query: brief, genre: body.genre || "drama", function_tag: functionTag, limit: 2 }),
      signal: controller.signal,
    })));
    const dialogueResponsePromise = fetch(`${serviceUrl}/retrieve-dialogues`, {
      method: "POST",
      headers: serviceHeaders(),
      body: JSON.stringify({ query: brief, genre: body.genre || "drama", limit: 6 }),
      signal: controller.signal,
    });
    const voiceBiblePromise = complete(writer, `Create a compact VOICE BIBLE for every speaking character implied by this project. For each character define: objective, hidden intention, vocabulary, sentence length, evasion strategy, pressure behaviour, forbidden words and one speech habit. Make voices clearly distinguishable and playable by actors. Do not write screenplay scenes yet.\n\n${brief}`, controller.signal);
    const [referenceResponses, dialogueResponse, voiceBible] = await Promise.all([
      referenceResponsesPromise, dialogueResponsePromise, voiceBiblePromise,
    ]);
    if (referenceResponses.some((response) => !response.ok)) throw new Error("SCREENPLAY REFERENCE INDEX IS UNAVAILABLE.");
    if (!dialogueResponse.ok) throw new Error("DIALOGUE REFERENCE INDEX IS UNAVAILABLE.");
    const referenceGroups = await Promise.all(referenceResponses.map((response) => response.json() as Promise<Array<{ text: string; metadata: Record<string, unknown> }>>));
    const dialogueReferences = await dialogueResponse.json() as Array<{ text: string; metadata: Record<string, unknown> }>;
    const maxReferenceChars = writer.retrieval?.max_reference_chars ?? 14000;
    const references = referenceGroups.flat().map((scene, index) =>
      `REFERENCE ${index + 1}: ${scene.metadata.source_file}, scene ${scene.metadata.scene_number}, ${scene.metadata.function_tag}\n${scene.text}`
    ).join("\n\n---\n\n").slice(0, maxReferenceChars);
    const dialogueExamples = dialogueReferences.map((scene, index) =>
      `DIALOGUE EXAMPLE ${index + 1}: ${scene.metadata.source_file}, ${scene.metadata.interaction_type}, ${scene.metadata.speakers}\n${scene.text}`
    ).join("\n\n---\n\n").slice(0, 12000);

    const draft = await complete(writer, `Create the complete first draft. Learn structural principles from references but never copy their wording, characters, dialogue or unique situations. Every line of dialogue must pursue an objective, answer or evade the previous beat, and change information, power, risk or relationship. Prefer playable action and subtext over stated emotion.\n\n${STRUCTURE}\n\n${brief}\n\nVOICE BIBLE:\n${voiceBible}\n\nSCENE REFERENCES:\n${references}\n\nDIALOGUE REFERENCES — study function and rhythm only, never copy wording:\n${dialogueExamples}`, controller.signal);
    const [dialogueNotes, directorNotes] = await Promise.all([
      complete(writer, `Act only as a strict Dialogue Editor. Diagnose and rewrite weak dialogue without changing plot. Check line by line for: stated emotion, exposition both speakers know, interchangeable voices, non-sequiturs, literary AI phrasing, repeated information, missing reaction, absent subtext, unplayable sentence length and conversations with no power shift. Return concrete replacements and preserve silence when it is stronger.\n\nVOICE BIBLE:\n${voiceBible}\n\nDRAFT:\n${draft}`, controller.signal),
      complete(director, `Review this draft for production realism, locations, visual emphasis, blocking, sound, playable performance and editorial pace. Identify dialogue that should become action, silence or behaviour. Return prioritized actionable notes, not a full rewrite.\n\n${brief}\n\nDRAFT:\n${draft}`, controller.signal),
    ]);
    const screenplay = await complete(writer, `Produce the final shooting-ready screenplay. Apply useful director and dialogue-editor notes while protecting the brief. Enforce the voice bible. No character may explain a feeling that can be performed, repeat shared information, or speak without an immediate intention. Read every exchange as a chain of reactions. Output only the screenplay.\n\n${STRUCTURE}\n\n${brief}\n\nVOICE BIBLE:\n${voiceBible}\n\nDRAFT:\n${draft}\n\nDIALOGUE EDITOR NOTES:\n${dialogueNotes}\n\nDIRECTOR NOTES:\n${directorNotes}`, controller.signal);
    return NextResponse.json({ screenplay, director_notes: directorNotes, dialogue_notes: dialogueNotes, voice_bible: voiceBible, reference_count: referenceGroups.flat().length, dialogue_reference_count: dialogueReferences.length, screenwriter_profile: writer.id, director_profile: director.id });
  } catch (error) {
    const message = error instanceof Error && error.name === "AbortError"
      ? "SCREENPLAY GENERATION TIMED OUT."
      : error instanceof Error ? error.message : "SCREENPLAY SERVICE IS UNAVAILABLE.";
    return NextResponse.json({ error: message }, { status: 503 });
  } finally {
    clearTimeout(timer);
  }
}
