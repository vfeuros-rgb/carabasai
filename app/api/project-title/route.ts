import { NextResponse } from "next/server";
import { AiAccessError, authenticateAiRequest } from "../../../lib/ai-access";

export const runtime = "nodejs";

function cleanTitle(value: string) {
  return value
    .replace(/^[\s"“”«»']+|[\s"“”«»'.!?]+$/g, "")
    .replace(/\s+/g, " ")
    .split("\n", 1)[0]
    .trim()
    .slice(0, 80);
}

export async function POST(request: Request) {
  let access;
  try {
    access = await authenticateAiRequest(request);
  } catch (error) {
    const accessError = error instanceof AiAccessError ? error : new AiAccessError("AUTHENTICATION FAILED.", 401);
    return NextResponse.json({ error: accessError.message }, { status: accessError.status });
  }

  const body = await request.json() as { projectId?: string; brief?: string; currentTitle?: string };
  const projectId = body.projectId?.trim();
  const brief = body.brief?.trim().slice(0, 4000);
  if (!projectId || !brief) return NextResponse.json({ error: "PROJECT BRIEF IS REQUIRED." }, { status: 400 });
  if (!process.env.ANTHROPIC_API_KEY) return NextResponse.json({ error: "ANTHROPIC_API_KEY IS NOT CONFIGURED." }, { status: 503 });

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-6",
      max_tokens: 40,
      temperature: 0.55,
      system: "You name film projects. Return only one memorable working title in the same language as the brief. Use 2-5 words. Capture the central dramatic image or conflict. Never use a bare genre, format, character list, explanation, quotation marks, punctuation, label or line break.",
      messages: [{ role: "user", content: `PROJECT BRIEF:\n${brief}` }],
    }),
  });
  const payload = await response.json() as { content?: Array<{ type?: string; text?: string }>; error?: { message?: string } };
  if (!response.ok) return NextResponse.json({ error: payload.error?.message || "CLAUDE COULD NOT NAME THE PROJECT." }, { status: 502 });
  const title = cleanTitle(payload.content?.find((item) => item.type === "text")?.text ?? "");
  if (!title) return NextResponse.json({ error: "CLAUDE RETURNED AN EMPTY PROJECT TITLE." }, { status: 502 });

  const { data: row } = await access.supabase
    .from("projects")
    .select("project_document")
    .eq("id", projectId)
    .eq("user_id", access.user.id)
    .maybeSingle();
  if (row) {
    const document = (row.project_document ?? {}) as Record<string, unknown>;
    const storedSession = (document.carabasai_session ?? {}) as Record<string, unknown>;
    await access.supabase.from("projects").update({
      title,
      project_document: {
        ...document,
        carabasai_session: { ...storedSession, title, titleGeneratedByClaude: true },
      },
      updated_at: new Date().toISOString(),
    }).eq("id", projectId).eq("user_id", access.user.id);
  }
  return NextResponse.json({ title });
}
