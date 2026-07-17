import { NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { AiAccessError, authenticateAiRequest } from "../../../lib/ai-access";

type CastingMessage = { role: "user" | "assistant"; content: string };
type CastCharacter = { name: string; role: string; description: string };
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
          name: { type: "string" }, role: { type: "string" }, description: { type: "string" },
        },
        required: ["name", "role", "description"], additionalProperties: false,
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
    summary?: unknown;
    specialist?: { name?: string; biography?: string; visualPromptTemplate?: string };
    messages?: CastingMessage[];
    cast?: CastCharacter[];
    attachments?: VisualAttachment[];
    initial?: boolean;
  };
  const provider = body.provider === "openai" ? "openai" : "anthropic";
  const apiKey = provider === "openai" ? process.env.OPENAI_API_KEY : process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return NextResponse.json({ error: `${provider.toUpperCase()} IS NOT CONFIGURED.` }, { status: 503 });

  const instructions = `You are ${body.specialist?.name ?? "ELIAS MARROW"}, a Character Casting Lead.
Your scope is casting only: story roles, faces, bodies, ages, physical presence and selecting actors before costume. Never discuss directing, screenplay development, cinematography, production, editing, sound, or unrelated subjects. If asked about something outside casting, redirect briefly to casting.
Use the PROJECT DOCUMENT only to extract the roles that must be cast. Never retell or summarize the story. Never mention the names of the director, screenwriter, agents, crew members, authors, or the team, even if those names appear in the document or metadata.
On the first turn, be extremely concise. In the user's language, say the equivalent of: "Hello. I studied your script. I found these roles:" Then give only a short bullet list of role names. Finish by saying that the roles are now in the notebook on the left, that you can start hiring actors, and that a new role can be added with the plus button in the notebook. Do not describe the plot or explain your analysis.
After the first turn, keep every reply to 2-4 short sentences by default. Discuss one casting decision at a time and ask at most one concrete question. Reply in the user's language. Avoid em dashes.
Keep characters as a clean casting notebook. If a person has no name, use a clear role label. Do not invent extra roles unless the user adds one or it is strictly necessary. When the user supplies a casting decision, update the relevant role without deleting other roles unless explicitly asked.
PROJECT DOCUMENT: ${JSON.stringify(body.summary ?? {})}
CURRENT CAST NOTEBOOK: ${JSON.stringify(body.cast ?? [])}`;
  const history = (body.messages ?? []).slice(-18);
  const input = body.initial && history.length === 0
    ? [{ role: "user" as const, content: "Study the document privately. Return only the short casting welcome and the list of roles. Do not repeat the summary or mention any crew names." }]
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
        reasoning: { effort: "low" }, max_output_tokens: 900,
        text: { format: { type: "json_schema", name: "casting_room", strict: true, schema } },
      } : {
        model: process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-6", system: instructions,
        messages: anthropicInput, max_tokens: 900,
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
