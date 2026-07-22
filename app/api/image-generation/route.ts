import { NextResponse } from "next/server";
import { AiAccessError, authenticateAiRequest } from "../../../lib/ai-access";
import { generateWithOpenAiImage } from "../../../lib/openai-image-generation";

export const runtime = "nodejs";
export const maxDuration = 300;

type GeminiImageResponse = {
  candidates?: Array<{ content?: { parts?: Array<{ inlineData?: { data?: string; mimeType?: string }; inline_data?: { data?: string; mime_type?: string } }> } }>;
  error?: { message?: string };
};

const bananaModels = new Set(["gemini-3.1-flash-image", "gemini-3-pro-image", "gemini-2.5-flash-image"]);
const ratios = new Set(["1:1", "16:9", "9:16", "4:3", "3:4"]);
type ReferencePayload = { dataUrl?: string; name?: string; type?: string };

function decodeReferences(references: ReferencePayload[] | undefined) {
  return (references ?? []).slice(0, 4).map((reference, index) => {
    const match = reference.dataUrl?.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,([\s\S]+)$/);
    if (!match) throw new Error("REFERENCE IMAGE IS INVALID.");
    const data = Buffer.from(match[2], "base64");
    if (data.length > 12 * 1024 * 1024) throw new Error("REFERENCE IMAGE IS TOO LARGE.");
    return { data, base64: match[2], mimeType: match[1], name: reference.name || `reference-${index + 1}` };
  });
}

export async function POST(request: Request) {
  let access;
  try {
    access = await authenticateAiRequest(request);
  } catch (error) {
    const accessError = error instanceof AiAccessError ? error : new AiAccessError("AUTHENTICATION FAILED.", 401);
    return NextResponse.json({ error: accessError.message }, { status: accessError.status });
  }

  const body = await request.json() as { prompt?: string; model?: string; aspectRatio?: string; quality?: string; count?: number; references?: ReferencePayload[] };
  const prompt = body.prompt?.trim().slice(0, 4000) ?? "";
  const model = body.model?.trim() ?? "gemini-3.1-flash-image";
  const aspectRatio = ratios.has(body.aspectRatio ?? "") ? body.aspectRatio! : "1:1";
  const count = Math.min(4, Math.max(1, Math.round(Number(body.count) || 1)));
  if (!prompt) return NextResponse.json({ error: "DESCRIBE THE IMAGE FIRST." }, { status: 400 });
  if (!bananaModels.has(model) && model !== "gpt-image-2") return NextResponse.json({ error: "IMAGE MODEL IS NOT SUPPORTED." }, { status: 400 });

  try {
    const references = decodeReferences(body.references);
    const generated: Array<{ image: Buffer; model: string; contentType: string; extension: string }> = [];
    for (let index = 0; index < count; index += 1) {
      if (model === "gpt-image-2") {
        const result = await generateWithOpenAiImage({ prompt, aspectRatio, model, quality: body.quality === "high" ? "high" : body.quality === "low" ? "low" : "medium", references });
        generated.push({ image: result.image, model: result.model, contentType: "image/png", extension: "png" });
        continue;
      }
      const apiKey = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_AI_API_KEY ?? process.env.GOOGLE_GENERATIVE_AI_API_KEY ?? process.env.GOOGLE_API_KEY ?? process.env.NANO_BANANA_API_KEY;
      if (!apiKey) return NextResponse.json({ error: "NANO BANANA IS NOT CONNECTED." }, { status: 503 });
      const imageSize = body.quality === "high" ? "4K" : body.quality === "low" ? "1K" : "2K";
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
        method: "POST",
        headers: { "x-goog-api-key": apiKey, "Content-Type": "application/json" },
        body: JSON.stringify({ contents: [{ role: "user", parts: [...references.map((reference) => ({ inlineData: { mimeType: reference.mimeType, data: reference.base64 } })), { text: prompt }] }], generationConfig: { responseModalities: ["IMAGE"], imageConfig: { aspectRatio, imageSize } } }),
        signal: AbortSignal.timeout(180_000),
        cache: "no-store",
      });
      const payload = await response.json() as GeminiImageResponse;
      if (!response.ok) throw new Error(payload.error?.message || "NANO BANANA COULD NOT GENERATE THE IMAGE.");
      const part = payload.candidates?.flatMap((candidate) => candidate.content?.parts ?? []).find((item) => item.inlineData?.data || item.inline_data?.data);
      const base64 = part?.inlineData?.data ?? part?.inline_data?.data;
      const mimeType = part?.inlineData?.mimeType ?? part?.inline_data?.mime_type ?? "image/png";
      if (!base64) throw new Error("IMAGE GENERATION RETURNED NO IMAGE.");
      generated.push({ image: Buffer.from(base64, "base64"), model, contentType: mimeType, extension: mimeType.includes("jpeg") ? "jpg" : mimeType.includes("webp") ? "webp" : "png" });
    }

    const results = [];
    for (const item of generated) {
      const id = crypto.randomUUID();
      const storagePath = `${access.user.id}/image-studio/${id}.${item.extension}`;
      const { error } = await access.supabase.storage.from("carabasai-media").upload(storagePath, item.image, { contentType: item.contentType, cacheControl: "31536000", upsert: false });
      if (error) throw error;
      const { data } = await access.supabase.storage.from("carabasai-media").createSignedUrl(storagePath, 60 * 60 * 24 * 7);
      results.push({ id, imageUrl: data?.signedUrl, storagePath, model: item.model });
    }
    return NextResponse.json({ images: results });
  } catch (error) {
    console.error("Standalone image generation failed", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "IMAGE GENERATION FAILED." }, { status: 502 });
  }
}
