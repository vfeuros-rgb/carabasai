import { NextResponse } from "next/server";
import { AiAccessError, authenticateAiRequest } from "../../../lib/ai-access";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    await authenticateAiRequest(request);
  } catch (error) {
    const accessError = error instanceof AiAccessError ? error : new AiAccessError("AUTHENTICATION FAILED.", 401);
    return NextResponse.json({ error: accessError.message }, { status: accessError.status });
  }

  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const apiToken = process.env.CLOUDFLARE_API_TOKEN;
  if (!accountId || !apiToken) {
    return NextResponse.json({ error: "PROJECT COVER GENERATOR IS NOT CONFIGURED." }, { status: 503 });
  }

  const body = await request.json() as { brief?: string; director?: string; screenwriter?: string };
  const brief = body.brief?.trim().slice(0, 1200);
  if (!brief) return NextResponse.json({ error: "PROJECT BRIEF IS REQUIRED." }, { status: 400 });

  const prompt = [
    "Create a cinematic film project cover, landscape 16:9 composition.",
    `Project concept: ${brief}.`,
    body.director ? `Creative direction selected by: ${body.director}.` : "",
    body.screenwriter ? `Story approach selected by: ${body.screenwriter}.` : "",
    "One strong visual idea, professional film still, dramatic controlled lighting, clear focal subject, rich cinematic production design.",
    "No typography, no captions, no logos, no watermark, no UI, no collage.",
  ].filter(Boolean).join(" ");

  const cloudflareResponse = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/@cf/black-forest-labs/flux-1-schnell`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ prompt, steps: 4 }),
    }
  );

  if (!cloudflareResponse.ok) {
    console.error("Cloudflare cover generation failed", cloudflareResponse.status, await cloudflareResponse.text());
    return NextResponse.json({ error: "PROJECT COVER COULD NOT BE GENERATED." }, { status: 502 });
  }

  const payload = await cloudflareResponse.json() as { result?: { image?: string }; success?: boolean };
  const image = payload.result?.image;
  if (!image) return NextResponse.json({ error: "PROJECT COVER WAS EMPTY." }, { status: 502 });

  return new Response(Buffer.from(image, "base64"), {
    headers: {
      "Content-Type": "image/jpeg",
      "Cache-Control": "no-store",
    },
  });
}
