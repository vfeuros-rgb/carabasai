import { NextResponse } from "next/server";
import { AiAccessError, authenticateAiRequest, consumeAiQuota } from "../../../lib/ai-access";

type NotebookNote = {
  author: "secondDirector" | "screenwriter";
  title: string;
  detail: string;
  accepted: boolean;
};

export async function POST(request: Request) {
  let access;
  try {
    access = await authenticateAiRequest(request);
  } catch (error) {
    const accessError = error instanceof AiAccessError ? error : new AiAccessError("AUTHENTICATION FAILED.", 401);
    return NextResponse.json(
      { error: accessError.message, ...accessError.details },
      { status: accessError.status, headers: accessError.details?.retryAfter ? { "Retry-After": String(accessError.details.retryAfter) } : undefined }
    );
  }
  const body = await request.json() as {
    provider?: "anthropic" | "openai";
    brief?: string;
    messages?: Array<{ role: string; content: string; speaker?: string }>;
    notes?: NotebookNote[];
    team?: { secondDirector?: string; screenwriter?: string };
    existingDocument?: unknown;
    teamDecisionQuestion?: string;
    skipDiscussion?: boolean;
  };
  const provider = body.provider === "openai" ? "openai" : "anthropic";
  const apiKey = provider === "openai" ? process.env.OPENAI_API_KEY : process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return NextResponse.json({ error: `${provider === "openai" ? "OPENAI_API_KEY" : "ANTHROPIC_API_KEY"} IS NOT CONFIGURED.` }, { status: 503 });

  const acceptedNotes = (body.notes ?? []).filter((note) => note.accepted);
  if (!body.brief || (acceptedNotes.length === 0 && !body.skipDiscussion)) {
    return NextResponse.json({ error: "SELECT AT LEAST ONE NOTE BEFORE CONTINUING." }, { status: 400 });
  }

  try {
    await consumeAiQuota(access.supabase, "project-document");
  } catch (error) {
    const accessError = error instanceof AiAccessError ? error : new AiAccessError("USAGE LIMIT CHECK FAILED.", 503);
    return NextResponse.json(
      { error: accessError.message, ...accessError.details },
      { status: accessError.status, headers: accessError.details?.retryAfter ? { "Retry-After": String(accessError.details.retryAfter) } : undefined }
    );
  }

  const input = `PROJECT BRIEF:\n${body.brief}\n\nAPPROVED NOTES:\n${acceptedNotes.map((note) => `- ${note.title}: ${note.detail}`).join("\n")}\n\nCREATIVE TEAM:\nSecond Director: ${body.team?.secondDirector ?? "Unknown"}\nScreenwriter: ${body.team?.screenwriter ?? "Unknown"}\n\nEXISTING DOCUMENT (preserve and revise, never restart):\n${body.existingDocument ? JSON.stringify(body.existingDocument) : "NONE, CREATE THE FIRST VERSION"}\n\nQUESTION THE TEAM MUST DECIDE NOW:\n${body.teamDecisionQuestion ?? "NONE"}\n\nRECENT CONVERSATION:\n${(body.messages ?? []).slice(-30).map((message) => `${message.speaker ?? message.role}: ${message.content}`).join("\n")}`;

  try {
    const system = `Create or incrementally revise a rigorous working project document in Russian from approved notes. IMPORTANT: Carabasai is always an AI film production studio. Unless explicitly stated otherwise, production uses generative AI, not a physical crew. Feasibility means character and location consistency, reference control, shot generation, motion, lip sync, voice, music, sound, edit, aspect ratio, duration, promptability and manageable generation complexity. The human Director has final authority.

PRESERVATION AND SYNTHESIS: If an existing document is supplied, preserve everything still valid and apply only additions, corrections and resolved decisions. Never restart it. Newer decisions replace contradictory older ones. The system, not the agents, combines two independent filters into one brief: story structure and dialogue from the Screenwriter; visual language, composition, light, tempo, camera, edit and sound from the Second Director. Do not average away contrast between their methods. Make that contrast legible and usable.

FORMAT CHECKLIST LIBRARY. Infer type and duration first, then require every relevant item:
- MINI-FILM / SHORT 1–3 min: protagonist and concrete want; obstacle; location and time; turning point; ending or deliberate open point.
- ADVERTISEMENT WITH PRODUCT: product's ordinary role in the hero's life; target emotion; human carrier; one message or CTA; delivery format such as scene, gag or slogan-led concept.
- TRAILER FOR A FICTIONAL FILM: genre and vibe without full plot; 2–3 signature fragments; one hook line; music and edit-tempo logic.
- BUSINESS ANIMATION: simple product or brand metaphor; audience; one clear message; tonal rule.
- REELS / SOCIAL SHORT: hook in first 2–3 seconds; one simple story or comic move; clear payoff; exact duration and tempo, normally 30–60 sec.
- SERIES / EPISODE: long-term protagonist arc; episode conflict and season connection; cliffhanger; supporting-character functions.
- UNKNOWN FORMAT: determine audience and viewing context; story versus demonstration; one retained emotion; unit and timing of payoff; brand/product/duration constraint.
Do not present this as a questionnaire. Missing answers become openQuestions, asked organically 1–2 at a time in chat.

QUALITY: A short AI film still needs a clear protagonist, want, obstacle, stakes, change or payoff, beginning, escalation, ending, tone, visual rule, location logic, sound approach, audience and AI feasibility. Clearly identify every material unanswered question. Any point saying "нужно решить", "нужно выбрать", "не определено" or listing alternatives without selection is unresolved and must appear in openQuestions.

TEAM DECISIONS: Do not invent agreement unless asked. For one decision request, make one specific choice through the selected team's methods, add it to the relevant section beginning exactly "Решение команды:", update ratings and remove the question. For RESOLVE ALL, resolve every listed question separately and return an empty openQuestions array.

OUTPUT: Create only useful sections, including REQUIREMENTS when criteria are needed. Use 3–8 uppercase English tabs. Each section needs a one-sentence summary, 2–8 short actionable points and strict separate 1–5 ratings. Missing motivation, conflict, ending or format logic normally scores 1–2; 3 is workable but incomplete; 4 is strong; 5 is rare and production-ready. The reason names the biggest weakness. Ensure the document contains a SCREENWRITER layer (arc, twist, dialogue, scene mechanics) and a DIRECTOR layer (AI-ready light, composition, camera, tempo, edit, sound). Avoid em dashes.`;
    const schema = {
              type: "object",
              properties: {
                title: { type: "string" }, logline: { type: "string" },
                sections: { type: "array", minItems: 1, items: { type: "object", properties: { id: { type: "string" }, title: { type: "string" }, summary: { type: "string" }, points: { type: "array", minItems: 1, items: { type: "string" } }, ratings: { type: "object", properties: { secondDirector: { type: "integer" }, screenwriter: { type: "integer" }, reason: { type: "string" } }, required: ["secondDirector", "screenwriter", "reason"], additionalProperties: false } }, required: ["id", "title", "summary", "points", "ratings"], additionalProperties: false } },
                openQuestions: { type: "array", items: { type: "object", properties: { id: { type: "string" }, label: { type: "string" }, question: { type: "string" } }, required: ["id", "label", "question"], additionalProperties: false } },
              }, required: ["title", "logline", "sections", "openQuestions"], additionalProperties: false,
            };
    const anthropicRequest = {
        model: process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-6", max_tokens: 5000, system, messages: [{ role: "user", content: input }], output_config: { format: { type: "json_schema", schema } },
      };
    const response = await fetch(provider === "openai" ? "https://api.openai.com/v1/responses" : "https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { ...(provider === "openai" ? { Authorization: `Bearer ${apiKey}` } : { "x-api-key": apiKey, "anthropic-version": "2023-06-01" }), "Content-Type": "application/json" },
      body: JSON.stringify(provider === "openai" ? { model: process.env.OPENAI_MODEL ?? "gpt-5.6-terra", instructions: system, input, reasoning: { effort: "low" }, max_output_tokens: 5000, text: { format: { type: "json_schema", name: "project_document", strict: true, schema } } } : anthropicRequest),
      signal: AbortSignal.timeout(90000),
    });
    const data = await response.json();
    if (!response.ok) return NextResponse.json({ error: data?.error?.message ?? "COULD NOT BUILD PROJECT DOCUMENT." }, { status: response.status });
    const text = provider === "openai" ? data.output?.flatMap((item: { content?: Array<{ type?: string; text?: string }> }) => item.content ?? []).find((item: { type?: string }) => item.type === "output_text")?.text : data.content?.find((item: { type?: string }) => item.type === "text")?.text;
    if (!text) throw new Error("EMPTY_DOCUMENT");
    return NextResponse.json(JSON.parse(text));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? `COULD NOT BUILD PROJECT DOCUMENT: ${error.message}` : "COULD NOT BUILD PROJECT DOCUMENT." },
      { status: 502 }
    );
  }
}
