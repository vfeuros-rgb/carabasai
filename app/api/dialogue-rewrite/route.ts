import { NextResponse } from "next/server";
import { AiAccessError, authenticateAiRequest, consumeAiQuota } from "../../../lib/ai-access";

export const maxDuration = 120;

type Fragment = { id?: string; text?: string; category?: string; context?: string };

export async function POST(request: Request) {
  let access;
  try {
    access = await authenticateAiRequest(request);
    await consumeAiQuota(access.supabase, "screenplay-generation", access.user);
  } catch (error) {
    const accessError = error instanceof AiAccessError ? error : new AiAccessError("DIALOGUE REWRITE ACCESS FAILED.", 401);
    return NextResponse.json({ error: accessError.message, ...accessError.details }, { status: accessError.status });
  }

  const body = await request.json() as { provider?: "anthropic" | "openai"; screenwriter?: string; fragments?: Fragment[] };
  const fragments = (body.fragments ?? []).filter((item) => item.id && item.text?.trim()).slice(0, 30);
  if (!fragments.length) return NextResponse.json({ error: "NO BAD DIALOGUE FRAGMENTS WERE SUPPLIED." }, { status: 400 });

  const provider = body.provider === "openai" ? "openai" : "anthropic";
  const apiKey = provider === "openai" ? process.env.OPENAI_API_KEY : process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return NextResponse.json({ error: `${provider === "openai" ? "OPENAI_API_KEY" : "ANTHROPIC_API_KEY"} IS NOT CONFIGURED.` }, { status: 503 });

  const schema = {
    type: "object",
    properties: {
      rewrites: {
        type: "array",
        items: {
          type: "object",
          properties: { id: { type: "string" }, replacement: { type: "string" } },
          required: ["id", "replacement"],
          additionalProperties: false,
        },
      },
    },
    required: ["rewrites"],
    additionalProperties: false,
  };
  const system = `You are ${body.screenwriter ?? "the selected screenwriter"} acting only as a precise dialogue editor. Rewrite ONLY each supplied BAD fragment. Never rewrite its context, the scene, or the screenplay. Preserve language, screenplay formatting, speaker identity, factual meaning, character knowledge, continuity and dramatic intent. Fix the named defect with natural, playable speech or action. Return one replacement for every supplied id and no commentary.`;
  const input = fragments.map((item, index) => `FRAGMENT ${index + 1}\nID: ${item.id}\nDEFECT: ${item.category}\nEXACT TEXT TO REPLACE:\n${item.text}\n\nREAD-ONLY CONTEXT:\n${item.context ?? ""}`).join("\n\n---\n\n");

  try {
    const response = await fetch(provider === "openai" ? "https://api.openai.com/v1/responses" : "https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { ...(provider === "openai" ? { Authorization: `Bearer ${apiKey}` } : { "x-api-key": apiKey, "anthropic-version": "2023-06-01" }), "Content-Type": "application/json" },
      body: JSON.stringify(provider === "openai"
        ? { model: process.env.OPENAI_MODEL ?? "gpt-4.1-mini", instructions: system, input, reasoning: { effort: "low" }, max_output_tokens: 4000, text: { format: { type: "json_schema", name: "dialogue_rewrites", strict: true, schema } } }
        : { model: process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-6", max_tokens: 4000, system, messages: [{ role: "user", content: input }], output_config: { format: { type: "json_schema", schema } } }),
      signal: AbortSignal.timeout(100_000),
    });
    const data = await response.json();
    if (!response.ok) return NextResponse.json({ error: data?.error?.message ?? "DIALOGUE REWRITE FAILED." }, { status: response.status });
    const text = provider === "openai"
      ? data.output?.flatMap((item: { content?: Array<{ type?: string; text?: string }> }) => item.content ?? []).find((item: { type?: string }) => item.type === "output_text")?.text
      : data.content?.find((item: { type?: string }) => item.type === "text")?.text;
    if (!text) throw new Error("EMPTY DIALOGUE REWRITE");
    const parsed = JSON.parse(text) as { rewrites?: Array<{ id: string; replacement: string }> };
    const allowedIds = new Set(fragments.map((item) => item.id));
    const rewrites = (parsed.rewrites ?? []).filter((item) => allowedIds.has(item.id) && item.replacement?.trim());
    if (!rewrites.length) throw new Error("NO VALID REPLACEMENTS RETURNED");
    return NextResponse.json({ rewrites });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? `DIALOGUE REWRITE FAILED: ${error.message}` : "DIALOGUE REWRITE FAILED." }, { status: 502 });
  }
}
