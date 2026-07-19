import { NextResponse } from "next/server";
import { AiAccessError, authenticateAiRequest, consumeAiQuota } from "../../../lib/ai-access";
import { retrieveDialogueReferences, retrieveSceneReferences, vectorizeIsConfigured } from "../../../lib/screenplay-vectorize";

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
  existingScreenplay?: string;
  dialogueFeedback?: Array<{ text?: string; sentiment?: "good" | "bad"; category?: string }>;
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

const BUILT_IN_PROFILES: Record<string, AgentProfile> = {
  grisha_pravdin: { id: "grisha_pravdin", display_name: "Grisha Pravdin", role: "director", provider: "anthropic", model: process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-6", system_context: "Direct through lived-in realism, material truth, natural light, consequential blocking and restrained sound. Reject decorative glamour and psychological explanation when concrete behaviour can carry the scene. End on a physical consequence, never a spoken moral.", retrieval: { function_tags: ["exposition", "inciting_incident", "turning_point", "climax", "resolution"], max_reference_chars: 14000 } },
  ambrose_peak: { id: "ambrose_peak", display_name: "Ambrose Peak", role: "director", provider: "anthropic", model: process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-6", system_context: "Direct psychological horror through buried family truth, folkloric material realism, controlled frames that fracture under pressure, silence and low-frequency tension. Supernatural events must physicalize denial rather than decorate it." },
  vera_suvorova: { id: "vera_suvorova", display_name: "Vera Suvorova", role: "screenwriter", provider: "openai", model: process.env.OPENAI_MODEL ?? "gpt-5.6-terra", system_context: "Write human-scale observational drama in contemporary everyday speech. Use domestic detail as moral evidence, preserve character contradiction, ground abstractions in work, housing, age and routine, and finish with observable consequence rather than explanation.", retrieval: { function_tags: ["exposition", "inciting_incident", "turning_point", "climax", "resolution"], max_reference_chars: 14000 } },
  clara_wake: { id: "clara_wake", display_name: "Clara Wake", role: "screenwriter", provider: "openai", model: process.env.OPENAI_MODEL ?? "gpt-5.6-terra", system_context: "Write ensemble stories around family wounds, social horror, institutional disbelief and power. Map who has power and who sees the truth first. Dialogue must be playable, causal and distinct; twists reveal that the system was visible from the start.", retrieval: { function_tags: ["exposition", "inciting_incident", "turning_point", "climax", "resolution"], max_reference_chars: 15000 } },
};

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
    let director: AgentProfile;
    let writer: AgentProfile;
    if (serviceUrl) {
      const [directorResponse, writerResponse] = await Promise.all([
        fetch(`${serviceUrl}/profiles/${directorId}`, { headers: serviceHeaders(), signal: controller.signal }),
        fetch(`${serviceUrl}/profiles/${writerId}`, { headers: serviceHeaders(), signal: controller.signal }),
      ]);
      if (!directorResponse.ok || !writerResponse.ok) throw new Error("SPECIALIST PROFILE COULD NOT BE LOADED.");
      director = await directorResponse.json() as AgentProfile;
      writer = await writerResponse.json() as AgentProfile;
    } else {
      director = BUILT_IN_PROFILES[directorId];
      writer = BUILT_IN_PROFILES[writerId];
    }

    const approvedNotes = (body.notes ?? [])
      .filter((note) => note.accepted)
      .map((note) => `${note.title ?? "Decision"}: ${note.detail ?? ""}`)
      .join("\n");
    const brief = `DIRECTOR'S BRIEF:\n${body.brief}\n\nCREATIVE ROOM CONVERSATION:\n${conversation}\n\nAPPROVED DECISIONS:\n${approvedNotes || "None separately approved."}`;
    const dialogueFeedback = (body.dialogueFeedback ?? []).map((item, index) =>
      `${index + 1}. ${item.sentiment?.toUpperCase()} / ${item.category}: ${item.text}`
    ).join("\n");
    const tags = writer.retrieval?.function_tags ?? ["inciting_incident", "turning_point", "climax"];
    const selectedGenre = (body.genre || "drama").toLowerCase();
    const referenceGroupsPromise = serviceUrl
      ? Promise.all(tags.map(async (functionTag) => {
        const response = await fetch(`${serviceUrl}/retrieve`, {
          method: "POST",
          headers: serviceHeaders(),
          body: JSON.stringify({ query: brief, genre: selectedGenre, function_tag: functionTag, limit: 2 }),
          signal: controller.signal,
        });
        if (!response.ok) throw new Error("SCREENPLAY REFERENCE INDEX IS UNAVAILABLE.");
        return response.json() as Promise<Array<{ text: string; metadata: Record<string, unknown> }>>;
      }))
      : vectorizeIsConfigured()
        ? Promise.all(tags.map((functionTag) => retrieveSceneReferences(brief, selectedGenre, functionTag, 2, controller.signal)))
        : Promise.resolve([]);
    const dialogueReferencesPromise = serviceUrl
      ? (async () => {
        const response = await fetch(`${serviceUrl}/retrieve-dialogues`, {
          method: "POST",
          headers: serviceHeaders(),
          body: JSON.stringify({ query: brief, genre: selectedGenre, limit: 6 }),
          signal: controller.signal,
        });
        if (!response.ok) throw new Error("DIALOGUE REFERENCE INDEX IS UNAVAILABLE.");
        return response.json() as Promise<Array<{ text: string; metadata: Record<string, unknown> }>>;
      })()
      : vectorizeIsConfigured()
        ? retrieveDialogueReferences(brief, selectedGenre, 6, controller.signal)
        : Promise.resolve([]);
    const voiceBiblePromise = complete(writer, `Create a compact VOICE BIBLE for every speaking character implied by this project. For each character define: objective, hidden intention, vocabulary, sentence length, evasion strategy, pressure behaviour, forbidden words and one speech habit. Make voices clearly distinguishable and playable by actors. Do not write screenplay scenes yet.\n\n${brief}`, controller.signal);
    const dialoguePlanPromise = complete(writer, `Do not write dialogue or screenplay prose. Build a DIALOGUE LOGIC PLAN for every expected scene. Reject any scene whose physical or causal logic is unsupported. For each scene provide: interaction type, why the characters are physically present, why they cannot simply leave, objective and hidden intention of each speaker, knowledge ledger showing what each person knows and how they learned it, secrets, physical activity, power at start and end, concrete scene result, and a turn-by-turn simulation containing only speaker + action verb + intended effect. Every planned line must have a playable action verb such as test, evade, force, conceal, accuse or reassure. Mark continuity risks explicitly.\n\n${brief}`, controller.signal);
    const [referenceGroups, dialogueReferences, voiceBible, dialoguePlan] = await Promise.all([
      referenceGroupsPromise, dialogueReferencesPromise, voiceBiblePromise, dialoguePlanPromise,
    ]);
    const maxReferenceChars = writer.retrieval?.max_reference_chars ?? 14000;
    const references = referenceGroups.flat().map((scene, index) =>
      `REFERENCE ${index + 1}: ${scene.metadata.source_file}, scene ${scene.metadata.scene_number}, ${scene.metadata.function_tag}\n${scene.text}`
    ).join("\n\n---\n\n").slice(0, maxReferenceChars);
    const dialogueExamples = dialogueReferences.map((scene, index) =>
      `DIALOGUE EXAMPLE ${index + 1}: ${scene.metadata.source_file}, ${scene.metadata.interaction_type}, ${scene.metadata.speakers}\n${scene.text}`
    ).join("\n\n---\n\n").slice(0, 12000);

    const draftTask = body.existingScreenplay
      ? `Rewrite the existing screenplay using the user's structured dialogue feedback. Preserve positively rated passages unless story logic requires a small adjustment. Correct negatively rated patterns throughout the entire script, not only in the quoted fragments.\n\nEXISTING SCREENPLAY:\n${body.existingScreenplay}\n\nUSER DIALOGUE FEEDBACK:\n${dialogueFeedback || "No structured feedback supplied."}`
      : "Create the complete first draft.";
    const draft = await complete(writer, `${draftTask} Learn structural principles from references but never copy their wording, characters, dialogue or unique situations. Follow the approved logic plan. Every line of dialogue must perform its assigned action, answer or evade the previous beat, and change information, power, risk or relationship. Prefer playable action and subtext over stated emotion. If the logic plan marks a scene unsupported, repair its premise before writing it.\n\n${STRUCTURE}\n\n${brief}\n\nVOICE BIBLE:\n${voiceBible}\n\nDIALOGUE LOGIC PLAN + KNOWLEDGE LEDGER:\n${dialoguePlan}\n\nSCENE REFERENCES:\n${references}\n\nDIALOGUE REFERENCES — study function and rhythm only, never copy wording:\n${dialogueExamples}`, controller.signal);
    const screenplay = await complete(writer, `Produce the final shooting-ready screenplay from the draft. Perform the dialogue and production checks silently inside this single pass; do not output notes, scores, audits or commentary. Enforce the voice bible and knowledge ledger. Remove stated emotion, repeated shared information, interchangeable voices, non-sequiturs, literary AI phrasing and dialogue without an immediate intention. Replace dialogue with action or silence whenever stronger. Respect this director's production method: ${director.system_context}. Keep locations, blocking, sound, performance and editorial pace filmable. No character may know information they have not acquired. Read every exchange as a chain of reactions. Output only the screenplay.\n\n${STRUCTURE}\n\n${brief}\n\nVOICE BIBLE:\n${voiceBible}\n\nDIALOGUE LOGIC PLAN + KNOWLEDGE LEDGER:\n${dialoguePlan}\n\nDRAFT:\n${draft}`, controller.signal);
    return NextResponse.json({ screenplay, dialogue_plan: dialoguePlan, voice_bible: voiceBible, reference_count: referenceGroups.flat().length, dialogue_reference_count: dialogueReferences.length, screenwriter_profile: writer.id, director_profile: director.id });
  } catch (error) {
    const message = error instanceof Error && error.name === "AbortError"
      ? "SCREENPLAY GENERATION TIMED OUT."
      : error instanceof Error ? error.message : "SCREENPLAY SERVICE IS UNAVAILABLE.";
    return NextResponse.json({ error: message }, { status: 503 });
  } finally {
    clearTimeout(timer);
  }
}
