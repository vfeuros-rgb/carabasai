import { NextResponse } from "next/server";
import { AiAccessError, authenticateAiRequest } from "../../../lib/ai-access";

export const runtime = "nodejs";
export const maxDuration = 120;

type BriefInput = { id: string; label: string; scriptText: string };

export async function POST(request: Request) {
  try { await authenticateAiRequest(request); }
  catch (error) {
    const accessError = error instanceof AiAccessError ? error : new AiAccessError("AUTHENTICATION FAILED.", 401);
    return NextResponse.json({ error: accessError.message }, { status: accessError.status });
  }

  if (!process.env.ANTHROPIC_API_KEY) return NextResponse.json({ error: "ANTHROPIC_API_KEY IS NOT CONFIGURED." }, { status: 503 });
  const body = await request.json() as { specialist?: string; units?: BriefInput[] };
  const units = (body.units ?? []).slice(0, 10).map((unit) => ({
    id: unit.id.slice(0, 100),
    label: unit.label.slice(0, 200),
    scriptText: unit.scriptText.slice(0, 5000),
  })).filter((unit) => unit.id && unit.scriptText);
  if (!units.length) return NextResponse.json({ error: "SCREENPLAY FRAGMENTS ARE REQUIRED." }, { status: 400 });

  const system = `You are ${body.specialist ?? "the location production designer"}. Read screenplay fragments and write IMAGE-GENERATION BRIEFS FOR THE EMPTY PHYSICAL LOCATIONS ONLY.

For every fragment:
- Identify the actual place, time of day, architecture, terrain, permanent objects, materials, spatial landmarks, weather and practical lighting that must exist before actors arrive.
- Remove ALL characters, people, bodies, costumes, dialogue, performance, actions, camera coverage, shot sizes, editing and story events.
- Never describe a person or imply that a person is visible. The generated image must be a clean location plate with zero people.
- Keep only details supported by the screenplay. Do not invent decorative story events.
- Preserve recurring location continuity across fragments. If two fragments use the same place, describe the same geography and permanent objects.
- Write in the predominant language of the screenplay fragment.
- Be concise: location name/time heading plus 1-3 precise sentences. Maximum 500 characters.

Example input includes characters and dialogue. Correct output:
"ЛОЖБИНА. ЛЕСНАЯ ТРОПА У ЛОЖБИНЫ — ВЕЧЕР. Узкая тропа между соснами. Слева большая серая глыба. Справа ложбина, затянутая папоротником. Влажная земля, корни и редкий холодный вечерний свет. Пустая локация, без людей."

Return strict JSON only: {"briefs":[{"id":"...","prompt":"..."}]}.`;

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
      body: JSON.stringify({
        model: process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-6",
        max_tokens: 2500,
        system,
        messages: [{ role: "user", content: JSON.stringify({ units }) }],
        output_config: { format: { type: "json_schema", schema: { type: "object", additionalProperties: false, required: ["briefs"], properties: { briefs: { type: "array", items: { type: "object", additionalProperties: false, required: ["id", "prompt"], properties: { id: { type: "string" }, prompt: { type: "string" } } } } } } } },
      }),
      signal: AbortSignal.timeout(110_000), cache: "no-store",
    });
    const data = await response.json() as { content?: Array<{ type?: string; text?: string }>; error?: { message?: string } };
    if (!response.ok) return NextResponse.json({ error: data.error?.message ?? "LOCATION BRIEFS COULD NOT BE PREPARED." }, { status: 502 });
    const text = data.content?.find((part) => part.type === "text")?.text ?? "";
    const parsed = JSON.parse(text) as { briefs?: Array<{ id?: string; prompt?: string }> };
    const allowed = new Set(units.map((unit) => unit.id));
    const briefs = (parsed.briefs ?? []).filter((item) => item.id && allowed.has(item.id) && item.prompt?.trim()).map((item) => ({ id: item.id!, prompt: item.prompt!.trim().slice(0, 800) }));
    return NextResponse.json({ briefs });
  } catch (error) {
    console.error("Location brief preparation failed", error);
    return NextResponse.json({ error: "LOCATION BRIEFS COULD NOT BE PREPARED." }, { status: 502 });
  }
}
