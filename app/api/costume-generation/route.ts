import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import sharp from "sharp";
import { AiAccessError, authenticateAiRequest } from "../../../lib/ai-access";
import { generateWithOpenAiImage } from "../../../lib/openai-image-generation";

export const runtime = "nodejs";
export const maxDuration = 180;

type GeminiImageResponse = {
  candidates?: Array<{ content?: { parts?: Array<{ inlineData?: { data?: string; mimeType?: string }; inline_data?: { data?: string; mime_type?: string } }> } }>;
  error?: { message?: string };
};

function detectImageType(image: Buffer) {
  if (image.length >= 3 && image[0] === 0xff && image[1] === 0xd8 && image[2] === 0xff) return { contentType: "image/jpeg", extension: "jpg" };
  if (image.length >= 8 && image.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { contentType: "image/png", extension: "png" };
  return { contentType: "image/webp", extension: "webp" };
}

async function loadCharacterReference(
  access: Awaited<ReturnType<typeof authenticateAiRequest>>,
  projectId: string,
  storagePath?: string,
  imagePath?: string,
) {
  const allowedPrefix = `${access.user.id}/${projectId}/`;
  if (storagePath && storagePath.startsWith(allowedPrefix) && !storagePath.includes("..")) {
    const { data, error } = await access.supabase.storage.from("carabasai-media").download(storagePath);
    if (error || !data) throw new Error("CHARACTER_REFERENCE_UNAVAILABLE");
    const buffer = Buffer.from(await data.arrayBuffer());
    return { data: buffer.toString("base64"), mimeType: detectImageType(buffer).contentType };
  }
  if (imagePath?.startsWith("/crew/") && !imagePath.includes("..")) {
    const buffer = await readFile(path.join(process.cwd(), "public", imagePath.replace(/^\//, "")));
    return { data: buffer.toString("base64"), mimeType: detectImageType(buffer).contentType };
  }
  throw new Error("CHARACTER_REFERENCE_UNAVAILABLE");
}

export async function POST(request: Request) {
  let access;
  try {
    access = await authenticateAiRequest(request);
  } catch (error) {
    const accessError = error instanceof AiAccessError ? error : new AiAccessError("AUTHENTICATION FAILED.", 401);
    return NextResponse.json({ error: accessError.message }, { status: accessError.status });
  }

  const body = await request.json() as {
    projectId?: string;
    characterId?: string;
    characterName?: string;
    costumeBrief?: string;
    storagePath?: string;
    characterImage?: string;
    imageModel?: string;
    imageProvider?: "banana" | "openai";
  };
  const projectId = body.projectId?.trim() ?? "";
  const characterId = body.characterId?.trim() ?? "";
  const costumeBrief = body.costumeBrief?.trim().slice(0, 1800) ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(projectId) || !characterId || !costumeBrief) {
    return NextResponse.json({ error: "CHARACTER AND COSTUME DESCRIPTION ARE REQUIRED." }, { status: 400 });
  }

  const imageProvider = body.imageProvider === "openai" ? "openai" : "banana";

  try {
    const reference = await loadCharacterReference(access, projectId, body.storagePath, body.characterImage);
    const layoutBuffer = await readFile(path.join(process.cwd(), "public/references/costume-mannequin-template.png"));
    const layoutReference = { data: layoutBuffer.toString("base64"), mimeType: "image/png" };
    const allowedModels = new Set(["gemini-3.1-flash-image", "gemini-3-pro-image", "gemini-2.5-flash-image"]);
    const model = body.imageModel && allowedModels.has(body.imageModel) ? body.imageModel : "gemini-3.1-flash-image";
    const prompt = `COSTUME DESIGN SHEET. LANDSCAPE 16:9.

REFERENCE 1 is the mandatory identity and body reference for ${body.characterName ?? "the character"}. Preserve the exact same fictional person: face, hair, apparent age, skin, body proportions, height impression, hands, anatomy and visual rendering style. Do not beautify, redesign, recast or replace the person.

REFERENCE 2 is a STRICT COMPOSITION TEMPLATE. Reproduce its landscape contact-sheet structure exactly, but replace the mannequin with the character from REFERENCE 1 wearing the requested costume. The large full-body front view occupies the entire left half. The right half contains four clean panels: left profile, right profile, full-body rear view and upper-body detail. Keep every view consistent in identity, anatomy and clothing.

MANDATORY SAFE FRAMING — NEVER CROP THE CHARACTER'S HEAD OR FACE. In every full-body and profile panel, the complete head, hair, chin, hands and both feet must remain inside that panel with visible neutral background around them. In the upper-body detail panel, show the complete head from the top of the hair to below the shoulders: forehead, eyes, nose, mouth, chin, neck and both shoulders must all be fully visible. Leave clear breathing room above the head and on both sides of the face. No facial feature may touch or cross a panel edge. Do not use an extreme close-up, partial face, cut-off forehead, cut-off hair, cut-off chin or cropped shoulder. If the requested clothing needs more room, zoom out rather than crop any part of the head or face. This safe framing rule has priority over aesthetic composition and over the costume brief.

Change ONLY the clothing according to this costume brief:
${costumeBrief}

Use the same neutral medium-grey seamless studio cyclorama in every panel: wall and floor are one continuous grey surface. Soft neutral fitting-room light, accurate fabric texture and construction, no dramatic colored light, no scenery, no furniture, no text, no logo, no watermark, no extra person, no handheld prop unless explicitly required by the costume brief.`;
    let image: Buffer;
    let usedModel = model;
    if (imageProvider === "openai") {
      const generated = await generateWithOpenAiImage({
        prompt,
        aspectRatio: "16:9",
        references: [
          { data: Buffer.from(reference.data, "base64"), mimeType: reference.mimeType, name: "character-reference.png" },
          { data: layoutBuffer, mimeType: "image/png", name: "composition-template.png" },
        ],
      });
      image = generated.image;
      usedModel = generated.model;
    } else {
      const apiKey = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_AI_API_KEY ?? process.env.GOOGLE_GENERATIVE_AI_API_KEY ?? process.env.GOOGLE_API_KEY ?? process.env.NANO_BANANA_API_KEY;
      if (!apiKey) return NextResponse.json({ error: "NANO BANANA IS NOT CONNECTED." }, { status: 503 });
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: "POST",
      headers: { "x-goog-api-key": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }, { inlineData: reference }, { inlineData: layoutReference }] }],
        generationConfig: { responseModalities: ["IMAGE"], imageConfig: { aspectRatio: "16:9", imageSize: "1K" } },
      }),
      signal: AbortSignal.timeout(150_000),
      cache: "no-store",
    });
      const data = await response.json() as GeminiImageResponse;
      if (!response.ok) {
        console.error("Costume generation failed", response.status, data.error);
        return NextResponse.json({ error: "COSTUME COULD NOT BE GENERATED." }, { status: 502 });
      }
      const part = data.candidates?.flatMap((candidate) => candidate.content?.parts ?? []).find((item) => item.inlineData?.data || item.inline_data?.data);
      const base64 = part?.inlineData?.data ?? part?.inline_data?.data;
      if (!base64) return NextResponse.json({ error: "COSTUME GENERATION RETURNED NO IMAGE." }, { status: 502 });
      image = Buffer.from(base64, "base64");
    }
    image = await sharp(image)
      .rotate()
      .resize(1600, 900, { fit: "contain", position: "centre", background: { r: 112, g: 112, b: 112, alpha: 1 } })
      .png({ compressionLevel: 9 })
      .toBuffer();
    const imageType = detectImageType(image);
    const generationId = crypto.randomUUID();
    const safeCharacterId = characterId.replace(/[^a-z0-9-]/gi, "-").slice(0, 80);
    const storagePath = `${access.user.id}/${projectId}/costumes/${safeCharacterId}/${generationId}.${imageType.extension}`;
    const { error: uploadError } = await access.supabase.storage.from("carabasai-media").upload(storagePath, image, { contentType: imageType.contentType, cacheControl: "86400", upsert: true });
    if (uploadError) return NextResponse.json({ error: "GENERATED COSTUME COULD NOT BE SAVED." }, { status: 502 });
    const { error: registryError } = await access.supabase.from("media_assets").upsert({
      project_id: projectId,
      user_id: access.user.id,
      path: storagePath,
      kind: "costume",
      original_name: `${generationId}.${imageType.extension}`,
      mime_type: imageType.contentType,
      size_bytes: image.length,
    }, { onConflict: "path" });
    if (registryError) console.error("Costume media registry update failed", registryError.message);
    const { data: signed } = await access.supabase.storage.from("carabasai-media").createSignedUrl(storagePath, 60 * 60 * 24 * 7);
    return NextResponse.json({ generationId, storagePath, imageUrl: signed?.signedUrl, model: usedModel, imageProvider, prompt: costumeBrief });
  } catch (error) {
    console.error("Costume generation error", error);
    return NextResponse.json({ error: error instanceof Error && error.message === "CHARACTER_REFERENCE_UNAVAILABLE" ? "THE CHARACTER REFERENCE COULD NOT BE LOADED." : "COSTUME GENERATION FAILED." }, { status: 502 });
  }
}

export async function DELETE(request: Request) {
  let access;
  try {
    access = await authenticateAiRequest(request);
  } catch (error) {
    const accessError = error instanceof AiAccessError ? error : new AiAccessError("AUTHENTICATION FAILED.", 401);
    return NextResponse.json({ error: accessError.message }, { status: accessError.status });
  }
  const body = await request.json() as { projectId?: string; storagePath?: string };
  const projectId = body.projectId?.trim() ?? "";
  const storagePath = body.storagePath?.trim() ?? "";
  const allowedPrefix = `${access.user.id}/${projectId}/costumes/`;
  if (!/^[0-9a-f-]{36}$/i.test(projectId) || !storagePath.startsWith(allowedPrefix) || storagePath.includes("..")) {
    return NextResponse.json({ error: "INVALID COSTUME FILE." }, { status: 400 });
  }
  const { error } = await access.supabase.storage.from("carabasai-media").remove([storagePath]);
  if (error) return NextResponse.json({ error: "COSTUME COULD NOT BE DELETED." }, { status: 502 });
  const { error: registryError } = await access.supabase.from("media_assets").delete().eq("path", storagePath).eq("user_id", access.user.id);
  if (registryError) console.error("Costume media registry delete failed", registryError.message);
  return NextResponse.json({ deleted: true });
}
