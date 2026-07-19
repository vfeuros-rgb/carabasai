import { NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { AiAccessError, authenticateAiRequest } from "../../../lib/ai-access";

type CastingMessage = { role: "user" | "assistant"; content: string };
type CastCharacter = { name: string; role: string; description: string; is_visual: boolean; visual_reason: string };
type VisualAttachment = { image: string; label?: string };

async function imageAsDataUrl(item: VisualAttachment, request: Request) {
  const src = item.image;
  let bytes: Buffer;
  let mime = "image/jpeg";
  if (src.startsWith("/")) {
    const safe = path.normalize(src).replace(/^(\.\.(\/|\\|$))+/, "");
    bytes = await readFile(path.join(process.cwd(), "public", safe));
    if (src.endsWith(".png")) mime = "image/png";
    else if (src.endsWith(".webp")) mime = "image/webp";
  } else {
    const response = await fetch(new URL(src, request.url), { signal: AbortSignal.timeout(12000) });
    if (!response.ok) throw new Error("attachment fetch failed");
    mime = response.headers.get("content-type")?.split(";")[0] || mime;
    bytes = Buffer.from(await response.arrayBuffer());
  }
  if (bytes.byteLength > 8_000_000) throw new Error("attachment too large");
  return { dataUrl: `data:${mime};base64,${bytes.toString("base64")}`, mime, base64: bytes.toString("base64") };
}

const schema = {
  type: "object",
  properties: {
    reply: { type: "string" },
    characters: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" }, role: { type: "string" }, description: { type: "string" }, is_visual: { type: "boolean" }, visual_reason: { type: "string" },
        },
        required: ["name", "role", "description", "is_visual", "visual_reason"], additionalProperties: false,
      },
    },
  },
  required: ["reply", "characters"], additionalProperties: false,
} as const;

export async function POST(request: Request) {
  try { await authenticateAiRequest(request); }
  catch (error) {
    const e = error instanceof AiAccessError ? error : new AiAccessError("AUTHENTICATION FAILED.", 401);
    return NextResponse.json({ error: e.message }, { status: e.status });
  }
  const body = await request.json() as {
    provider?: "anthropic" | "openai";
    castingBrief?: unknown;
    specialist?: { name?: string; biography?: string; visualPromptTemplate?: string };
    messages?: CastingMessage[];
    cast?: CastCharacter[];
    attachments?: VisualAttachment[];
    initial?: boolean;
    screenplay?: string;
  };
  const provider = body.provider === "openai" ? "openai" : "anthropic";
  const apiKey = provider === "openai" ? process.env.OPENAI_API_KEY : process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return NextResponse.json({ error: `${provider.toUpperCase()} IS NOT CONFIGURED.` }, { status: 503 });

  const instructions = `You are ${body.specialist?.name ?? "ELIAS MARROW"}, a Character Casting Lead and a distinct person, never a generic assistant.
LANGUAGE (HIGHEST PRIORITY): Infer the project language from CASTING BRIEF and SCREENPLAY. Reply in that same language throughout the project. If they are empty or genuinely ambiguous, use English. Never default to Russian. Character names, role labels, descriptions and visual reasons must use the project language too.
VOICE RULES: Use one or two short sentences per reply, never a long paragraph. Weigh each phrase and allow meaning to pause between lines. Never apologize, fuss, flatter loudly or use bureaucratic language. Use actor-language: face, bone, flesh, actor, actress, casting, audition, set and role. Never say prompt, option, generate or generation. Respect imperfect faces as discoveries. Use a theatrical metaphor only at a key moment. Address the human as the Director and behave as an equal partner who sees faces better. Never retell information the Director already knows. End a significant action with a short final verdict in the project language, equivalent to: "Accepted. The role is theirs." Calibration meaning: "I studied the screenplay. Here is who I see in it." "Good. Give me the face, and I will invite them to our casting."
Your scope is casting only: story roles, faces, bodies, ages, physical presence and selecting actors before costume. Never discuss directing, screenplay development, cinematography, production, editing, sound, or unrelated subjects. If asked about something outside casting, redirect briefly to casting.
Read the supplied screenplay once for casting only. Extract every human role, including off-screen voices, but do not retell the story. Locations, themes, acts and abstract presences are not characters. Mark is_visual=false only when the role never appears physically on screen and needs voice, breath, shadow or an unseen presence only. Explain that decision in visual_reason using no more than eight words. Never mention the names of the director, screenwriter, agents, crew members, authors, or the team.
On the first turn, say only that you studied the screenplay and the roles are ready in the Character Notebook. Do not list or explain the roles in chat. Maximum two short sentences.
After the first turn, keep every reply to one or two short sentences. Discuss one casting decision at a time and ask at most one concrete question. Avoid em dashes.
Never use the words generate, generated, generation, сгенерировать, сгенерирован or генерация in your speech. Image creation is a permanent application control, not your action. When a new face is needed, tell the user briefly to describe the appearance in the main field and use the button there. Never claim that you created or placed a candidate.
Never rush, apologize, use bureaucratic language or write long paragraphs.
Keep characters as a clean casting notebook. Each description must contain only casting facts: approximate age, physical presence, distinctive face/body direction and genre-relevant contrast. Maximum 18 words. If a person has no name, use a clear role label. Do not invent extra roles unless the user adds one or it is strictly necessary. When the user supplies a casting decision, update the relevant role without deleting other roles unless explicitly asked.
CASTING BRIEF: ${JSON.stringify(body.castingBrief ?? {})}
SCREENPLAY FOR ONE-TIME CASTING READ: ${(body.screenplay ?? "").slice(0, 40000)}
CURRENT CAST NOTEBOOK: ${JSON.stringify(body.cast ?? [])}`;
  const history = (body.messages ?? []).slice(-8);
  const input = body.initial && history.length === 0
    ? [{ role: "user" as const, content: "Read the screenplay for casting. Put the roles in the notebook, classify visual and non-visual roles, then answer in character with no role list." }]
    : history;
  try {
    const visuals = await Promise.all((body.attachments ?? []).slice(0, 4).map((item) => imageAsDataUrl(item, request).then((image) => ({ ...item, ...image }))));
    const anthropicInput = input.map((message, index) => index === input.length - 1 && visuals.length > 0 && message.role === "user" ? {
      role: message.role,
      content: [
        { type: "text", text: message.content },
        ...visuals.flatMap((item) => [
          { type: "text", text: `Visual casting reference: ${item.label ?? "candidate"}` },
          { type: "image", source: { type: "base64", media_type: item.mime, data: item.base64 } },
        ]),
      ],
    } : message);
    const openAiInput = input.map((message, index) => index === input.length - 1 && visuals.length > 0 && message.role === "user" ? {
      role: message.role,
      content: [
        { type: "input_text", text: message.content },
        ...visuals.flatMap((item) => [
          { type: "input_text", text: `Visual casting reference: ${item.label ?? "candidate"}` },
          { type: "input_image", image_url: item.dataUrl },
        ]),
      ],
    } : message);
    const response = await fetch(provider === "openai" ? "https://api.openai.com/v1/responses" : "https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: provider === "openai"
        ? { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" }
        : { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
      body: JSON.stringify(provider === "openai" ? {
        model: process.env.OPENAI_MODEL ?? "gpt-5.6-terra", instructions, input: openAiInput,
        reasoning: { effort: "low" }, max_output_tokens: 550,
        text: { format: { type: "json_schema", name: "casting_room", strict: true, schema } },
      } : {
        model: process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-6", system: instructions,
        messages: anthropicInput, max_tokens: 550,
        output_config: { format: { type: "json_schema", schema } },
      }),
      signal: AbortSignal.timeout(45000),
    });
    const data = await response.json() as { error?: { message?: string }; content?: Array<{ type?: string; text?: string }>; output?: Array<{ content?: Array<{ type?: string; text?: string }> }> };
    if (!response.ok) return NextResponse.json({ error: data.error?.message ?? "CASTING AGENT COULD NOT RESPOND." }, { status: response.status });
    const text = provider === "openai"
      ? data.output?.flatMap((item) => item.content ?? []).find((item) => item.type === "output_text")?.text
      : data.content?.find((item) => item.type === "text")?.text;
    if (!text) throw new Error("empty");
    const parsed = JSON.parse(text) as { reply: string; characters: CastCharacter[] };
    return NextResponse.json({ reply: parsed.reply.replaceAll("—", ","), characters: parsed.characters });
  } catch (error) {
    console.error("Casting room failed", error);
    return NextResponse.json({ error: "COULD NOT CONNECT TO THE CASTING AGENT." }, { status: 502 });
  }
}
