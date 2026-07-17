import { NextResponse } from "next/server";
import { AiAccessError, authenticateAiRequest } from "../../../lib/ai-access";
import {
  buildCharacterCastingPrompt,
  characterCastingSpecialists,
  generateCastingActorName,
} from "../../../lib/character-casting";

export const runtime = "nodejs";

type ReplicatePrediction = {
  id?: string;
  status?: string;
  output?: string | string[];
  error?: string;
  urls?: { get?: string };
};

function firstOutputUrl(output: ReplicatePrediction["output"]) {
  if (typeof output === "string") return output;
  if (Array.isArray(output))
    return output.find((item) => typeof item === "string") ?? "";
  return "";
}

async function waitForPrediction(
  token: string,
  prediction: ReplicatePrediction,
) {
  if (
    prediction.status === "succeeded" ||
    prediction.status === "failed" ||
    prediction.status === "canceled"
  ) {
    return prediction;
  }
  const statusUrl = prediction.urls?.get;
  if (!statusUrl) return prediction;

  for (let attempt = 0; attempt < 50; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    const response = await fetch(statusUrl, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    if (!response.ok)
      throw new Error(
        `Replicate status request failed with ${response.status}`,
      );
    const current = (await response.json()) as ReplicatePrediction;
    if (
      current.status === "succeeded" ||
      current.status === "failed" ||
      current.status === "canceled"
    ) {
      return current;
    }
  }
  throw new Error("Replicate generation timed out");
}

export async function POST(request: Request) {
  let access;
  try {
    access = await authenticateAiRequest(request);
  } catch (error) {
    const accessError =
      error instanceof AiAccessError
        ? error
        : new AiAccessError("AUTHENTICATION FAILED.", 401);
    return NextResponse.json(
      { error: accessError.message },
      { status: accessError.status },
    );
  }

  const token = process.env.REPLICATE_API_TOKEN;
  if (!token) {
    return NextResponse.json(
      { error: "CHARACTER GENERATION IS NOT CONFIGURED." },
      { status: 503 },
    );
  }

  const body = (await request.json()) as {
    projectId?: string;
    specialistId?: string;
    characterBrief?: string;
    aspectRatio?: "9:16" | "1:1" | "16:9";
  };
  const projectId = body.projectId?.trim();
  const characterBrief = body.characterBrief?.trim().slice(0, 2_500);
  const specialist = characterCastingSpecialists.find(
    (item) => item.id === body.specialistId,
  );

  if (!projectId || !/^[0-9a-f-]{36}$/i.test(projectId)) {
    return NextResponse.json(
      { error: "VALID PROJECT ID IS REQUIRED." },
      { status: 400 },
    );
  }
  if (!specialist) {
    return NextResponse.json(
      { error: "CHARACTER CASTING SPECIALIST IS REQUIRED." },
      { status: 400 },
    );
  }
  if (!characterBrief) {
    return NextResponse.json(
      { error: "CHARACTER BRIEF IS REQUIRED." },
      { status: 400 },
    );
  }

  const model =
    process.env[specialist.generation.modelEnvironmentVariable]?.trim();
  if (
    !model ||
    !/^[a-z0-9_.-]+\/[a-z0-9_.-]+(?::[a-f0-9]{64})?$/i.test(model)
  ) {
    return NextResponse.json(
      { error: "THE SELECTED CASTING STYLE IS NOT CONNECTED." },
      { status: 503 },
    );
  }

  const [modelSlug, version] = model.split(":");
  const replicateResponse = await fetch(
    version
      ? "https://api.replicate.com/v1/predictions"
      : `https://api.replicate.com/v1/models/${modelSlug}/predictions`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Prefer: "wait=60",
      },
      body: JSON.stringify({
        ...(version ? { version } : {}),
        input: {
          prompt: buildCharacterCastingPrompt(specialist, characterBrief),
          aspect_ratio:
            body.aspectRatio ?? specialist.generation.defaultAspectRatio,
          lora_scale: specialist.generation.defaultLoraStrength,
          num_outputs: 1,
          output_format: "webp",
          output_quality: 90,
        },
      }),
      cache: "no-store",
    },
  );

  if (!replicateResponse.ok) {
    console.error(
      "Replicate character generation failed",
      replicateResponse.status,
      await replicateResponse.text(),
    );
    return NextResponse.json(
      { error: "CHARACTER COULD NOT BE GENERATED." },
      { status: 502 },
    );
  }

  let prediction = (await replicateResponse.json()) as ReplicatePrediction;
  try {
    prediction = await waitForPrediction(token, prediction);
  } catch (error) {
    console.error("Replicate character generation polling failed", error);
    return NextResponse.json(
      { error: "CHARACTER GENERATION TIMED OUT." },
      { status: 504 },
    );
  }

  const outputUrl = firstOutputUrl(prediction.output);
  if (prediction.status !== "succeeded" || !outputUrl) {
    console.error(
      "Replicate character generation ended without output",
      prediction.error ?? prediction.status,
    );
    return NextResponse.json(
      { error: "CHARACTER GENERATION FAILED." },
      { status: 502 },
    );
  }

  const imageResponse = await fetch(outputUrl, { cache: "no-store" });
  if (!imageResponse.ok) {
    return NextResponse.json(
      { error: "GENERATED CHARACTER COULD NOT BE DOWNLOADED." },
      { status: 502 },
    );
  }

  const image = Buffer.from(await imageResponse.arrayBuffer());
  const generationId = prediction.id ?? crypto.randomUUID();
  const actorName = generateCastingActorName(characterBrief, generationId);
  const storagePath = `${access.user.id}/${projectId}/characters/${generationId}.webp`;
  const { error: uploadError } = await access.supabase.storage
    .from("carabasai-media")
    .upload(storagePath, image, {
      contentType: imageResponse.headers.get("content-type") ?? "image/webp",
      cacheControl: "86400",
      upsert: false,
    });
  if (uploadError) {
    console.error("Generated character upload failed", uploadError.message);
    return NextResponse.json(
      { error: "GENERATED CHARACTER COULD NOT BE SAVED." },
      { status: 502 },
    );
  }

  const { data: signed } = await access.supabase.storage
    .from("carabasai-media")
    .createSignedUrl(storagePath, 60 * 60 * 24 * 7);

  return NextResponse.json({
    generationId,
    storagePath,
    imageUrl: signed?.signedUrl ?? outputUrl,
    actorName,
    specialistId: specialist.id,
    model,
  });
}
