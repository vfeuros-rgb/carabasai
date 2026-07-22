import { NextResponse } from "next/server";
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
  if (image.length >= 12 && image.subarray(0, 4).toString("ascii") === "RIFF" && image.subarray(8, 12).toString("ascii") === "WEBP") return { contentType: "image/webp", extension: "webp" };
  if (image.length >= 6 && ["GIF87a", "GIF89a"].includes(image.subarray(0, 6).toString("ascii"))) return { contentType: "image/gif", extension: "gif" };
  if (image.length >= 16 && image.subarray(4, 8).toString("ascii") === "ftyp" && ["avif", "avis"].includes(image.subarray(8, 12).toString("ascii"))) return { contentType: "image/avif", extension: "avif" };
  throw new Error("LOCATION FILE IS NOT A VALID IMAGE.");
}

async function loadAngleReference(access: Awaited<ReturnType<typeof authenticateAiRequest>>, projectId: string, storagePath?: string) {
  const prefix = `${access.user.id}/${projectId}/locations/`;
  if (!storagePath || !storagePath.startsWith(prefix) || storagePath.includes("..")) return null;
  const { data, error } = await access.supabase.storage.from("carabasai-media").download(storagePath);
  if (error || !data) throw new Error("LOCATION_REFERENCE_UNAVAILABLE");
  const buffer = Buffer.from(await data.arrayBuffer());
  return { data: buffer.toString("base64"), mimeType: detectImageType(buffer).contentType };
}

export async function GET(request: Request) {
  let access;
  try { access = await authenticateAiRequest(request); }
  catch (error) {
    const accessError = error instanceof AiAccessError ? error : new AiAccessError("AUTHENTICATION FAILED.", 401);
    return NextResponse.json({ error: accessError.message }, { status: accessError.status });
  }
  const url = new URL(request.url);
  const projectId = url.searchParams.get("projectId")?.trim() ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(projectId)) return NextResponse.json({ error: "INVALID PROJECT." }, { status: 400 });
  const requestedStoragePath = url.searchParams.get("storagePath")?.trim() ?? "";
  if (requestedStoragePath) {
    const prefix = `${access.user.id}/${projectId}/locations/`;
    if (!requestedStoragePath.startsWith(prefix) || requestedStoragePath.includes("..")) {
      return NextResponse.json({ error: "INVALID LOCATION FILE." }, { status: 400 });
    }
    const { data: storedFile, error: downloadError } = await access.supabase.storage
      .from("carabasai-media")
      .download(requestedStoragePath);
    if (downloadError || !storedFile) {
      return NextResponse.json({ error: "LOCATION FILE COULD NOT BE OPENED." }, { status: 404 });
    }
    try {
      detectImageType(Buffer.from(await storedFile.arrayBuffer()));
    } catch {
      return NextResponse.json({ error: "LOCATION IMAGE FILE IS DAMAGED." }, { status: 422 });
    }
    const { data: signed, error: signedError } = await access.supabase.storage
      .from("carabasai-media")
      .createSignedUrl(requestedStoragePath, 60 * 60 * 24 * 7);
    if (signedError || !signed?.signedUrl) {
      return NextResponse.json({ error: "LOCATION FILE COULD NOT BE OPENED." }, { status: 404 });
    }
    return NextResponse.json(
      { imageUrl: signed.signedUrl },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  }
  const staleBefore = new Date(Date.now() - 3 * 60 * 1000).toISOString();
  await access.supabase.from("generation_jobs")
    .update({ status: "failed", error: "IMAGE GENERATION TIMED OUT. TRY AGAIN.", updated_at: new Date().toISOString() })
    .eq("project_id", projectId).eq("user_id", access.user.id).eq("kind", "location_image")
    .in("status", ["queued", "running"]).lt("created_at", staleBefore);
  const { data, error } = await access.supabase.from("generation_jobs")
    .select("id,status,input,output,error,created_at,updated_at")
    .eq("project_id", projectId).eq("user_id", access.user.id).eq("kind", "location_image")
    .order("created_at", { ascending: false }).limit(100);
  if (error) return NextResponse.json({ error: "LOCATION JOBS COULD NOT BE RESTORED." }, { status: 502 });
  const jobs = (data ?? []).map((job) => {
    const output = (job.output ?? {}) as Record<string, unknown>;
    const stableOutput = { ...output };
    delete stableOutput.imageUrl;
    return { ...job, output: stableOutput };
  });
  return NextResponse.json({ jobs });
}

export async function POST(request: Request) {
  let access;
  try { access = await authenticateAiRequest(request); }
  catch (error) {
    const accessError = error instanceof AiAccessError ? error : new AiAccessError("AUTHENTICATION FAILED.", 401);
    return NextResponse.json({ error: accessError.message }, { status: accessError.status });
  }
  const body = await request.json() as { projectId?: string; unitId?: string; prompt?: string; aspectRatio?: string; specialist?: string; angleReferencePath?: string; cameraAngle?: string; imageProvider?: "banana" | "openai"; imageModel?: string };
  const projectId = body.projectId?.trim() ?? "";
  const unitId = body.unitId?.trim() ?? "";
  const brief = body.prompt?.trim().slice(0, 3000) ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(projectId) || !unitId || !brief) return NextResponse.json({ error: "LOCATION DESCRIPTION IS REQUIRED." }, { status: 400 });
  const imageProvider = body.imageProvider === "openai" ? "openai" : "banana";
  const generationId = crypto.randomUUID();
  const jobInput = { unitId, prompt: brief, aspectRatio: body.aspectRatio ?? "16:9", specialist: body.specialist ?? "", angleReferencePath: body.angleReferencePath ?? "", cameraAngle: body.cameraAngle ?? "", imageProvider };
  const { data: job, error: jobError } = await access.supabase.from("generation_jobs").insert({
    project_id: projectId, user_id: access.user.id, kind: "location_image", status: "running", input: jobInput,
  }).select("id").single();
  // Job persistence is useful for restoring an in-flight generation after a
  // reload, but it must not make either image provider unavailable when the
  // optional generation_jobs migration has not reached an environment yet.
  if (jobError) console.error("Location job could not be saved", jobError.message);
  try {
    const reference = await loadAngleReference(access, projectId, body.angleReferencePath);
    const aspectRatio = ["16:9", "9:16", "1:1", "4:3", "3:4"].includes(body.aspectRatio ?? "") ? body.aspectRatio! : "16:9";
    const continuityRule = reference ? `REFERENCE IMAGE IS THE MASTER LOCATION. Create a NEW SHOT of THE EXACT SAME PHYSICAL PLACE. The output must not repeat the reference composition. Move the camera to this explicitly required position: ${body.cameraAngle || "opposite-side three-quarter view, at least 90 degrees around the location from the reference camera"}. This camera displacement is mandatory and must be immediately obvious when the two frames are compared. Preserve every wall, door, window, opening, staircase, built-in element, furniture item, prop, surface, material, color, light source and their exact relative positions. Do not redesign, redecorate, add, remove, move, mirror or resize anything. Maintain architectural geometry and spatial continuity. Only the camera position, viewing direction and lens perspective may change. Never return the same framing, camera axis, crop or viewpoint as the reference.` : "Create one coherent, production-ready location with readable architecture and stable spatial landmarks suitable for matching shots.";
    const prompt = `CINEMATIC LOCATION DESIGN. ${aspectRatio}. Designed under ${body.specialist ?? "the selected production designer"}.

${continuityRule}

LOCATION BRIEF:
${brief}

Show the environment itself. No actors, no people, no mannequins, no captions, no typography, no logo, no watermark, no collage and no split screen. One single cinematic frame. Realistic material continuity, deliberate production design, useful depth, clean navigable geography and plausible lighting.`;
    let image: Buffer;
    let usedModel = "gemini-3.1-flash-image";
    if (imageProvider === "openai") {
      const generated = await generateWithOpenAiImage({
        prompt,
        aspectRatio,
        references: reference ? [{ data: Buffer.from(reference.data, "base64"), mimeType: reference.mimeType, name: "master-location.png" }] : [],
      });
      image = generated.image;
      usedModel = generated.model;
    } else {
      const apiKey = process.env.GEMINI_API_KEY
        ?? process.env.GOOGLE_AI_API_KEY
        ?? process.env.GOOGLE_GENERATIVE_AI_API_KEY
        ?? process.env.GOOGLE_API_KEY
        ?? process.env.NANO_BANANA_API_KEY;
      if (!apiKey) throw new Error("NANO BANANA IS NOT CONNECTED.");
      const parts: Array<Record<string, unknown>> = [{ text: prompt }];
      if (reference) parts.push({ inlineData: reference });
      const response = await fetch("https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-image:generateContent", {
      method: "POST", headers: { "x-goog-api-key": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({ contents: [{ role: "user", parts }], generationConfig: { responseModalities: ["IMAGE"], imageConfig: { aspectRatio, imageSize: "1K" } } }),
      signal: AbortSignal.timeout(150_000), cache: "no-store",
    });
      const data = await response.json() as GeminiImageResponse;
      if (!response.ok) { console.error("Location generation failed", response.status, data.error); throw new Error("LOCATION COULD NOT BE GENERATED."); }
      const part = data.candidates?.flatMap((candidate) => candidate.content?.parts ?? []).find((item) => item.inlineData?.data || item.inline_data?.data);
      const base64 = part?.inlineData?.data ?? part?.inline_data?.data;
      if (!base64) throw new Error("LOCATION GENERATION RETURNED NO IMAGE.");
      image = Buffer.from(base64, "base64");
    }
    if (image.length < 32) throw new Error("LOCATION GENERATION RETURNED AN INVALID IMAGE.");
    const imageType = detectImageType(image);
    const safeUnitId = unitId.replace(/[^a-z0-9-]/gi, "-").slice(0, 80);
    const storagePath = `${access.user.id}/${projectId}/locations/${safeUnitId}/${generationId}.${imageType.extension}`;
    const storedBytes = Uint8Array.from(image);
    const { error: uploadError } = await access.supabase.storage.from("carabasai-media").upload(storagePath, storedBytes.buffer, { contentType: imageType.contentType, cacheControl: "86400", upsert: true });
    if (uploadError) throw new Error("GENERATED LOCATION COULD NOT BE SAVED.");
    const { data: verifiedFile, error: verificationError } = await access.supabase.storage.from("carabasai-media").download(storagePath);
    if (verificationError || !verifiedFile) {
      await access.supabase.storage.from("carabasai-media").remove([storagePath]);
      throw new Error("GENERATED LOCATION COULD NOT BE VERIFIED AFTER SAVING.");
    }
    const verifiedImage = Buffer.from(await verifiedFile.arrayBuffer());
    try {
      detectImageType(verifiedImage);
    } catch {
      await access.supabase.storage.from("carabasai-media").remove([storagePath]);
      throw new Error("GENERATED LOCATION WAS DAMAGED WHILE SAVING. TRY AGAIN.");
    }
    if (!verifiedImage.equals(image)) {
      await access.supabase.storage.from("carabasai-media").remove([storagePath]);
      throw new Error("GENERATED LOCATION CHANGED WHILE SAVING. TRY AGAIN.");
    }
    await access.supabase.from("media_assets").upsert({ project_id: projectId, user_id: access.user.id, path: storagePath, kind: "location", original_name: `${generationId}.${imageType.extension}`, mime_type: imageType.contentType, size_bytes: image.length }, { onConflict: "path" });
    const output = { generationId, storagePath, unitId, prompt: brief, createdAt: Date.now(), angleOf: body.angleReferencePath ? body.angleReferencePath : undefined, imageProvider, model: usedModel };
    if (job?.id) {
      await access.supabase.from("generation_jobs").update({ status: "succeeded", output, updated_at: new Date().toISOString() }).eq("id", job.id).eq("user_id", access.user.id);
    }
    const { data: signed } = await access.supabase.storage.from("carabasai-media").createSignedUrl(storagePath, 60 * 60 * 24 * 7);
    return NextResponse.json({ jobId: job?.id, generationId, storagePath, imageUrl: signed?.signedUrl, angle: Boolean(reference), imageProvider, model: usedModel });
  } catch (error) {
    console.error("Location generation error", error);
    const message = error instanceof Error ? error.message : "LOCATION GENERATION FAILED.";
    if (job?.id) {
      await access.supabase.from("generation_jobs").update({ status: "failed", error: message, updated_at: new Date().toISOString() }).eq("id", job.id).eq("user_id", access.user.id);
    }
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

export async function DELETE(request: Request) {
  let access;
  try { access = await authenticateAiRequest(request); }
  catch (error) { const accessError = error instanceof AiAccessError ? error : new AiAccessError("AUTHENTICATION FAILED.", 401); return NextResponse.json({ error: accessError.message }, { status: accessError.status }); }
  const body = await request.json() as { projectId?: string; storagePath?: string };
  const projectId = body.projectId?.trim() ?? "";
  const storagePath = body.storagePath?.trim() ?? "";
  const prefix = `${access.user.id}/${projectId}/locations/`;
  if (!storagePath.startsWith(prefix) || storagePath.includes("..")) return NextResponse.json({ error: "INVALID LOCATION FILE." }, { status: 400 });
  const { error } = await access.supabase.storage.from("carabasai-media").remove([storagePath]);
  if (error) return NextResponse.json({ error: "LOCATION COULD NOT BE DELETED." }, { status: 502 });
  await access.supabase.from("media_assets").delete().eq("path", storagePath).eq("user_id", access.user.id);
  return NextResponse.json({ deleted: true });
}
