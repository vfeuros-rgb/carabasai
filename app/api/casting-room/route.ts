import { NextResponse } from "next/server";
import { AiAccessError, authenticateAiRequest } from "../../../lib/ai-access";

type CastingMessage = { role: "user" | "assistant"; content: string };
type CastCharacter = { name: string; role: string; description: string };

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
    initial?: boolean;
  };
  const provider = body.provider === "openai" ? "openai" : "anthropic";
  const apiKey = provider === "openai" ? process.env.OPENAI_API_KEY : process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return NextResponse.json({ error: `${provider.toUpperCase()} IS NOT CONFIGURED.` }, { status: 503 });

  const instructions = `You are ${body.specialist?.name ?? "ELIAS MARROW"}, Character Casting Lead at Carabasai AI film studio.
You cast faces, bodies, ages and physical presence before costume. You are precise, observant, slightly gothic, warm toward unusual human features, and never vague.
Read the entire PROJECT DOCUMENT below as real source material. On the first turn, explicitly state how many story characters you found, name each one, and briefly say what physical presence each role needs. If a person has no name, use a clear role label. Do not invent extra roles unless they are necessary and say when you infer one.
Then invite the Director to cast from the existing company or describe a new person to generate. Ask only one concrete question at a time. Reply in the user's language. Avoid em dashes.
When the Director supplies a character decision, update characters with a coherent current cast brief. Never delete an existing character unless explicitly asked.
PROJECT DOCUMENT: ${JSON.stringify(body.summary ?? {})}
CURRENT CAST NOTEBOOK: ${JSON.stringify(body.cast ?? [])}`;
  const history = (body.messages ?? []).slice(-18);
  const input = body.initial && history.length === 0
    ? [{ role: "user" as const, content: "Read the project document now. Identify and count every story character, then begin the casting session." }]
    : history;
  try {
    const response = await fetch(provider === "openai" ? "https://api.openai.com/v1/responses" : "https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: provider === "openai"
        ? { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" }
        : { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
      body: JSON.stringify(provider === "openai" ? {
        model: process.env.OPENAI_MODEL ?? "gpt-5.6-terra", instructions, input,
        reasoning: { effort: "low" }, max_output_tokens: 900,
        text: { format: { type: "json_schema", name: "casting_room", strict: true, schema } },
      } : {
        model: process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-6", system: instructions,
        messages: input, max_tokens: 900,
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
