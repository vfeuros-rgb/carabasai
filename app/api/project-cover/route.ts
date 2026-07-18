import { NextResponse } from "next/server";
import { AiAccessError, authenticateAiRequest } from "../../../lib/ai-access";
import { deriveProjectTitle } from "../../../lib/project-title";

export const runtime = "nodejs";
const COVER_MODEL = "flux-2-dev-16x9-v3";

async function createProjectTitle(accountId: string, apiToken: string, brief: string) {
  try {
    const response = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/@cf/meta/llama-3.1-8b-instruct`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messages: [
            {
              role: "system",
              content: "Create a strong, concise working title for a film or video project. Reply with the title only, in the same language as the brief. Use 2 to 5 words. No quotation marks, punctuation, explanations, labels or line breaks.",
            },
            { role: "user", content: brief },
          ],
          max_tokens: 32,
          temperature: 0.55,
        }),
      },
    );
    if (!response.ok) return "";
    const payload = await response.json() as { result?: { response?: string } };
    return String(payload.result?.response ?? "")
      .replace(/["“”«»]/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 80);
  } catch {
    return "";
  }
}

export async function POST(request: Request) {
  let access;
  try {
    access = await authenticateAiRequest(request);
  } catch (error) {
    const accessError = error instanceof AiAccessError ? error : new AiAccessError("AUTHENTICATION FAILED.", 401);
    return NextResponse.json({ error: accessError.message }, { status: accessError.status });
  }

  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const apiToken = process.env.CLOUDFLARE_API_TOKEN;
  if (!accountId || !apiToken) {
    return NextResponse.json({ error: "PROJECT COVER GENERATOR IS NOT CONFIGURED." }, { status: 503 });
  }

  const body = await request.json() as { projectId?: string; brief?: string; director?: string; screenwriter?: string };
  const projectId = body.projectId?.trim();
  const brief = body.brief?.trim().slice(0, 1200);
  if (!projectId || !/^[0-9a-f-]{36}$/i.test(projectId)) {
    return NextResponse.json({ error: "VALID PROJECT ID IS REQUIRED." }, { status: 400 });
  }
  if (!brief) return NextResponse.json({ error: "PROJECT BRIEF IS REQUIRED." }, { status: 400 });

  const prompt = [
    "Create a cinematic key art image for a film project in an exact 16:9 widescreen composition.",
    `The image must clearly and literally depict this exact project concept: ${brief}.`,
    "Identify the central character, action, location and genre directly from that concept. Do not replace them with a generic movie studio, camera equipment, abstract scenery or an unrelated portrait.",
    "Show one decisive story moment with a clear focal subject and visual storytelling that makes the premise immediately recognizable.",
    "Professional film still, specific production design, controlled dramatic lighting, coherent anatomy, believable environment.",
    "The image must contain absolutely no text of any kind. No letters, words, numbers, titles, subtitles, captions, signs, labels, logos, brands, watermarks, credits, UI elements or typographic symbols anywhere in the image.",
    "If the scene naturally contains a sign, screen, package, document or poster, keep its surface blank and without readable marks.",
    "Single cinematic frame only, no poster layout, no title treatment, no borders and no collage.",
  ].filter(Boolean).join(" ");

  const form = new FormData();
  form.append("prompt", prompt);
  form.append("steps", "20");
  form.append("width", "1024");
  form.append("height", "576");

  const cloudflareResponse = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/@cf/black-forest-labs/flux-2-dev`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiToken}`,
      },
      body: form,
    }
  );

  if (!cloudflareResponse.ok) {
    console.error("Cloudflare cover generation failed", cloudflareResponse.status, await cloudflareResponse.text());
    return NextResponse.json({ error: "PROJECT COVER COULD NOT BE GENERATED." }, { status: 502 });
  }

  const payload = await cloudflareResponse.json() as { result?: { image?: string }; success?: boolean };
  const image = payload.result?.image;
  if (!image) return NextResponse.json({ error: "PROJECT COVER WAS EMPTY." }, { status: 502 });

  const coverPath = `${access.user.id}/${projectId}/project-covers/cover.jpg`;
  const { error: uploadError } = await access.supabase.storage
    .from("carabasai-media")
    .upload(coverPath, Buffer.from(image, "base64"), {
      contentType: "image/jpeg",
      cacheControl: "86400",
      upsert: true,
    });
  if (uploadError) {
    console.error("Project cover upload failed", uploadError.message);
    return NextResponse.json({ error: "PROJECT COVER COULD NOT BE SAVED." }, { status: 502 });
  }

  const generatedTitle = (await createProjectTitle(accountId, apiToken, brief)) || deriveProjectTitle(brief);
  const { data: projectRow } = await access.supabase
    .from("projects")
    .select("project_document")
    .eq("id", projectId)
    .eq("user_id", access.user.id)
    .maybeSingle();
  const currentDocument = (projectRow?.project_document ?? {}) as Record<string, unknown>;
  const currentSession = (currentDocument.carabasai_session ?? {}) as Record<string, unknown>;
  if (projectRow) {
    const { error: projectUpdateError } = await access.supabase
      .from("projects")
      .update({
        project_document: {
          ...currentDocument,
          carabasai_session: {
            ...currentSession,
            ...(generatedTitle ? { title: generatedTitle } : {}),
            coverPath,
            coverModel: COVER_MODEL,
          },
        },
        ...(generatedTitle ? { title: generatedTitle } : {}),
        updated_at: new Date().toISOString(),
      })
      .eq("id", projectId)
      .eq("user_id", access.user.id);
    if (projectUpdateError) console.error("Project cover metadata update failed", projectUpdateError.message);
  }

  return NextResponse.json({ coverPath, coverModel: COVER_MODEL, title: generatedTitle || undefined });
}
