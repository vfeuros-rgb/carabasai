import { NextResponse } from "next/server";
import { AiAccessError, authenticateAiRequest } from "../../../lib/ai-access";

export const runtime = "nodejs";
export const maxDuration = 300;

const endpoint = "https://ark.ap-southeast.bytepluses.com/api/v3/contents/generations/tasks";
const ratios = new Set(["adaptive", "16:9", "9:16", "1:1", "4:3", "3:4", "21:9"]);
const resolutions = new Set(["480p", "720p", "1080p"]);
const durations = new Set([5, 10]);
const videoModels = new Set([
  "dreamina-seedance-2-0-260128",
  "dreamina-seedance-2-0-fast-260128",
  "dreamina-seedance-2-0-mini-260615",
  "seedance-1-5-pro-251215",
]);
const googleVideoModels = new Set([
  "gemini-omni-flash-preview",
  "veo-3.1-generate-preview",
  "veo-3.1-fast-generate-preview",
  "veo-3.1-lite-generate-preview",
]);

type AiAccess = Awaited<ReturnType<typeof authenticateAiRequest>>;

async function storeVideo(access: AiAccess, bytes: Buffer, fileName: string) {
  const storagePath = `${access.user.id}/video-studio/${fileName}.mp4`;
  const { error } = await access.supabase.storage.from("carabasai-media").upload(storagePath, bytes, { contentType: "video/mp4", cacheControl: "31536000", upsert: true });
  if (error) throw error;
  const { data } = await access.supabase.storage.from("carabasai-media").createSignedUrl(storagePath, 60 * 60 * 24 * 7);
  if (!data?.signedUrl) throw new Error("VIDEO URL COULD NOT BE CREATED.");
  return { videoUrl: data.signedUrl, storagePath };
}

function googleError(payload: unknown, fallback: string) {
  if (payload && typeof payload === "object" && "error" in payload) {
    const error = (payload as { error?: { message?: string } }).error;
    if (error?.message) return error.message;
  }
  return fallback;
}

async function accessFor(request: Request) {
  try { return await authenticateAiRequest(request); }
  catch (error) {
    const accessError = error instanceof AiAccessError ? error : new AiAccessError("AUTHENTICATION FAILED.", 401);
    throw accessError;
  }
}

export async function POST(request: Request) {
  try {
    const access = await accessFor(request);
    const body = await request.json() as { prompt?: string; model?: string; aspectRatio?: string; resolution?: string; duration?: number };
    const prompt = body.prompt?.trim().slice(0, 4000) ?? "";
    if (!prompt) return NextResponse.json({ error: "DESCRIBE THE VIDEO FIRST." }, { status: 400 });
    const ratio = ratios.has(body.aspectRatio ?? "") ? body.aspectRatio! : "16:9";
    const resolution = resolutions.has(body.resolution ?? "") ? body.resolution! : "720p";
    const duration = durations.has(Number(body.duration)) ? Number(body.duration) : 5;
    const requestedModel = body.model ?? "dreamina-seedance-2-0-260128";
    if (googleVideoModels.has(requestedModel)) {
      const googleKey = process.env.GEMINI_API_KEY;
      if (!googleKey) return NextResponse.json({ error: "GOOGLE VIDEO IS NOT CONNECTED." }, { status: 503 });
      if (requestedModel === "gemini-omni-flash-preview") {
        const googleRatio = ratio === "9:16" ? "9:16" : "16:9";
        const response = await fetch("https://generativelanguage.googleapis.com/v1beta/interactions", {
          method: "POST",
          headers: { "x-goog-api-key": googleKey, "Content-Type": "application/json" },
          body: JSON.stringify({ model: requestedModel, input: prompt, response_format: { type: "video", aspect_ratio: googleRatio } }),
          signal: AbortSignal.timeout(290_000), cache: "no-store",
        });
        const payload = await response.json() as { id?: string; steps?: Array<{ content?: Array<{ type?: string; data?: string; uri?: string }> }> };
        if (!response.ok) return NextResponse.json({ error: googleError(payload, "GEMINI OMNI COULD NOT GENERATE THE VIDEO.") }, { status: 502 });
        const output = payload.steps?.flatMap((step) => step.content ?? []).find((item) => item.type === "video");
        let bytes: Buffer;
        if (output?.data) bytes = Buffer.from(output.data, "base64");
        else if (output?.uri) {
          const download = await fetch(output.uri, { headers: { "x-goog-api-key": googleKey }, signal: AbortSignal.timeout(180_000) });
          if (!download.ok) throw new Error("GEMINI OMNI VIDEO COULD NOT BE DOWNLOADED.");
          bytes = Buffer.from(await download.arrayBuffer());
        } else throw new Error("GEMINI OMNI RETURNED NO VIDEO.");
        const stored = await storeVideo(access, bytes, `gemini-omni-${payload.id?.replace(/[^a-zA-Z0-9_-]/g, "-") || crypto.randomUUID()}`);
        return NextResponse.json({ status: "succeeded", model: requestedModel, ...stored });
      }

      const veoRatio = ratio === "9:16" ? "9:16" : "16:9";
      const veoResolution = resolution === "480p" ? "720p" : resolution;
      const veoDuration = duration <= 5 ? 4 : 8;
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${requestedModel}:predictLongRunning`, {
        method: "POST",
        headers: { "x-goog-api-key": googleKey, "Content-Type": "application/json" },
        body: JSON.stringify({ instances: [{ prompt }], parameters: { aspectRatio: veoRatio, resolution: veoResolution, durationSeconds: veoDuration, generateAudio: true, numberOfVideos: 1 } }),
        signal: AbortSignal.timeout(60_000), cache: "no-store",
      });
      const payload = await response.json() as { name?: string };
      if (!response.ok || !payload.name) return NextResponse.json({ error: googleError(payload, "VEO COULD NOT START THE VIDEO.") }, { status: 502 });
      return NextResponse.json({ taskId: `google_${Buffer.from(payload.name).toString("base64url")}`, model: requestedModel });
    }

    const apiKey = process.env.BYTEPLUS_API_KEY;
    if (!apiKey) return NextResponse.json({ error: "SEEDANCE IS NOT CONNECTED." }, { status: 503 });
    const selectedModel = videoModels.has(requestedModel) ? requestedModel : "dreamina-seedance-2-0-260128";
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: selectedModel, content: [{ type: "text", text: prompt }], ratio, resolution, duration, generate_audio: true, watermark: false, return_last_frame: false }),
      signal: AbortSignal.timeout(60_000), cache: "no-store",
    });
    const payload = await response.json() as { id?: string; error?: { message?: string } };
    if (!response.ok || !payload.id) return NextResponse.json({ error: payload.error?.message || "SEEDANCE COULD NOT START THE VIDEO." }, { status: 502 });
    return NextResponse.json({ taskId: payload.id, model: selectedModel });
  } catch (error) {
    const status = error instanceof AiAccessError ? error.status : 502;
    return NextResponse.json({ error: error instanceof Error ? error.message : "VIDEO GENERATION FAILED." }, { status });
  }
}

export async function GET(request: Request) {
  try {
    const access = await accessFor(request);
    const taskId = new URL(request.url).searchParams.get("taskId")?.trim();
    if (!taskId || !/^[a-zA-Z0-9_-]+$/.test(taskId)) return NextResponse.json({ error: "INVALID VIDEO TASK." }, { status: 400 });
    if (taskId.startsWith("google_")) {
      const googleKey = process.env.GEMINI_API_KEY;
      if (!googleKey) return NextResponse.json({ error: "GOOGLE VIDEO IS NOT CONNECTED." }, { status: 503 });
      const operationName = Buffer.from(taskId.slice(7), "base64url").toString("utf8");
      if (!/^operations\/[a-zA-Z0-9._-]+$/.test(operationName)) return NextResponse.json({ error: "INVALID GOOGLE VIDEO TASK." }, { status: 400 });
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/${operationName}`, { headers: { "x-goog-api-key": googleKey }, cache: "no-store", signal: AbortSignal.timeout(60_000) });
      const payload = await response.json() as { done?: boolean; error?: { message?: string }; response?: { generateVideoResponse?: { generatedSamples?: Array<{ video?: { uri?: string } }> } } };
      if (!response.ok || payload.error) return NextResponse.json({ status: "failed", error: googleError(payload, "VEO VIDEO FAILED.") });
      if (!payload.done) return NextResponse.json({ status: "running" });
      const videoUri = payload.response?.generateVideoResponse?.generatedSamples?.[0]?.video?.uri;
      if (!videoUri) return NextResponse.json({ status: "failed", error: "VEO RETURNED NO VIDEO." });
      const videoResponse = await fetch(videoUri, { headers: { "x-goog-api-key": googleKey }, signal: AbortSignal.timeout(180_000), cache: "no-store" });
      if (!videoResponse.ok) throw new Error("VEO VIDEO COULD NOT BE DOWNLOADED.");
      const stored = await storeVideo(access, Buffer.from(await videoResponse.arrayBuffer()), taskId);
      return NextResponse.json({ status: "succeeded", ...stored });
    }

    const apiKey = process.env.BYTEPLUS_API_KEY;
    if (!apiKey) return NextResponse.json({ error: "SEEDANCE IS NOT CONNECTED." }, { status: 503 });
    const response = await fetch(`${endpoint}/${encodeURIComponent(taskId)}`, { headers: { Authorization: `Bearer ${apiKey}` }, cache: "no-store", signal: AbortSignal.timeout(60_000) });
    const payload = await response.json() as { status?: string; content?: { video_url?: string }; error?: { message?: string } };
    if (!response.ok) return NextResponse.json({ error: payload.error?.message || "VIDEO STATUS COULD NOT BE READ." }, { status: 502 });
    if (payload.status === "failed") return NextResponse.json({ status: "failed", error: payload.error?.message || "SEEDANCE VIDEO FAILED." });
    if (payload.status !== "succeeded" || !payload.content?.video_url) return NextResponse.json({ status: payload.status || "running" });
    const videoResponse = await fetch(payload.content.video_url, { signal: AbortSignal.timeout(180_000), cache: "no-store" });
    if (!videoResponse.ok) throw new Error("GENERATED VIDEO COULD NOT BE DOWNLOADED.");
    const stored = await storeVideo(access, Buffer.from(await videoResponse.arrayBuffer()), taskId);
    return NextResponse.json({ status: "succeeded", ...stored });
  } catch (error) {
    const status = error instanceof AiAccessError ? error.status : 502;
    return NextResponse.json({ error: error instanceof Error ? error.message : "VIDEO GENERATION FAILED." }, { status });
  }
}
