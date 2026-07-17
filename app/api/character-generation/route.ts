import { readFile } from "node:fs/promises";
import path from "node:path";
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

type GeminiImageResponse = {
  candidates?: Array<{
    content?: {
      parts?: Array<{
        inlineData?: { data?: string; mimeType?: string };
        inline_data?: { data?: string; mime_type?: string };
      }>;
    };
  }>;
  error?: { message?: string };
};

type DynamicImageReference = {
  data?: string;
  mimeType?: string;
};

const NANO_BANANA_STYLE_REFERENCE_COUNT = 10;
const NANO_BANANA_DYNAMIC_REFERENCE_LIMIT = 4;
const NANO_BANANA_REFERENCE_MODEL = "gemini-3.1-flash-image";
const ALLOWED_REFERENCE_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

function firstOutputUrl(output: ReplicatePrediction["output"]) {
  if (typeof output === "string") return output;
  if (Array.isArray(output))
    return output.find((item) => typeof item === "string") ?? "";
  return "";
}

function detectImageType(image: Buffer) {
  if (
    image.length >= 12 &&
    image.subarray(0, 4).toString("ascii") === "RIFF" &&
    image.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return { contentType: "image/webp", extension: "webp" };
  }
  if (
    image.length >= 3 &&
    image[0] === 0xff &&
    image[1] === 0xd8 &&
    image[2] === 0xff
  ) {
    return { contentType: "image/jpeg", extension: "jpg" };
  }
  if (
    image.length >= 8 &&
    image
      .subarray(0, 8)
      .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return { contentType: "image/png", extension: "png" };
  }
  return { contentType: "image/webp", extension: "webp" };
}

async function normalizeVisualBrief(brief: string) {
  if (!/[А-Яа-яЁё]/.test(brief)) return brief;

  const instruction = `Translate the casting brief below into concise English for an image model.
Preserve every explicit fact exactly, especially age, apparent gender, ancestry, skin tone, hair color, hair texture, facial hair, height, build and distinguishing features.
Do not invent, remove, soften or reinterpret any attribute. Output only the English visual description, with no commentary.

CASTING BRIEF:
${brief}`;

  try {
    if (process.env.ANTHROPIC_API_KEY) {
      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": process.env.ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-6",
          max_tokens: 300,
          temperature: 0,
          messages: [{ role: "user", content: instruction }],
        }),
        signal: AbortSignal.timeout(20_000),
      });
      if (response.ok) {
        const data = (await response.json()) as {
          content?: Array<{ type?: string; text?: string }>;
        };
        const translated = data.content?.find(
          (item) => item.type === "text",
        )?.text;
        if (translated?.trim()) return translated.trim();
      }
    }

    if (process.env.OPENAI_API_KEY) {
      const response = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: process.env.OPENAI_MODEL ?? "gpt-5.6-terra",
          instructions:
            "Translate casting briefs into exact, concise English visual descriptions. Preserve every explicit attribute and output only the translation.",
          input: brief,
          reasoning: { effort: "low" },
          max_output_tokens: 300,
        }),
        signal: AbortSignal.timeout(20_000),
      });
      if (response.ok) {
        const data = (await response.json()) as {
          output?: Array<{
            content?: Array<{ type?: string; text?: string }>;
          }>;
        };
        const translated = data.output
          ?.flatMap((item) => item.content ?? [])
          .find((item) => item.type === "output_text")?.text;
        if (translated?.trim()) return translated.trim();
      }
    }
  } catch (error) {
    console.error("Casting brief normalization failed", error);
  }

  return brief;
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

function selectStyleReferences<T>(references: T[], count: number) {
  if (references.length <= count) return references;

  // Sample across the complete portfolio instead of biasing the model toward
  // the first faces in the collection. For Elias's 20 images this selects
  // every second portrait and produces exactly ten style references.
  return Array.from(
    { length: count },
    (_, index) => references[Math.floor((index * references.length) / count)],
  );
}

function parseDynamicReferences(references?: DynamicImageReference[]) {
  return (references ?? [])
    .slice(0, NANO_BANANA_DYNAMIC_REFERENCE_LIMIT)
    .flatMap((reference) => {
      const mimeType = reference.mimeType?.trim().toLowerCase() ?? "";
      const rawData = reference.data?.trim() ?? "";
      if (!ALLOWED_REFERENCE_MIME_TYPES.has(mimeType) || !rawData) return [];

      const data = rawData.replace(
        /^data:image\/(?:jpeg|png|webp);base64,/i,
        "",
      );
      if (!/^[a-z0-9+/=\s]+$/i.test(data)) return [];

      // Keep request bodies bounded. Four 8 MB decoded images are already
      // more than enough for casting references.
      const estimatedBytes = Math.floor((data.length * 3) / 4);
      if (estimatedBytes > 8 * 1024 * 1024) return [];

      return [{ inlineData: { mimeType, data } }];
    });
}

async function generateWithNanoBanana(
  specialist: (typeof characterCastingSpecialists)[number],
  prompt: string,
  aspectRatio: "9:16" | "1:1" | "16:9",
  requestedModel?: string,
  dynamicReferences: DynamicImageReference[] = [],
) {
  const apiKey =
    process.env.GEMINI_API_KEY ??
    process.env.GOOGLE_AI_API_KEY ??
    process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  if (!apiKey) throw new Error("NANO_BANANA_NOT_CONFIGURED");

  const allowedModels = new Set([
    "gemini-3.1-flash-image",
    "gemini-3.1-flash-lite-image",
    "gemini-3-pro-image",
    "gemini-2.5-flash-image",
  ]);
  const configuredDefault =
    process.env.NANO_BANANA_MODEL?.trim() || NANO_BANANA_REFERENCE_MODEL;
  const model =
    requestedModel && allowedModels.has(requestedModel)
      ? requestedModel
      : allowedModels.has(configuredDefault)
        ? configuredDefault
        : NANO_BANANA_REFERENCE_MODEL;
  const selectedStyleReferences = selectStyleReferences(
    specialist.characterExamples,
    NANO_BANANA_STYLE_REFERENCE_COUNT,
  );
  const referenceParts = await Promise.all(
    selectedStyleReferences.map(async (example) => {
      const filePath = path.join(
        process.cwd(),
        "public",
        example.image.replace(/^\//, ""),
      );
      const data = await readFile(filePath);
      const extension = path.extname(filePath).toLowerCase();
      const mimeType =
        extension === ".png"
          ? "image/png"
          : extension === ".webp"
            ? "image/webp"
            : "image/jpeg";
      return { inlineData: { mimeType, data: data.toString("base64") } };
    }),
  );
  const dynamicReferenceParts = parseDynamicReferences(dynamicReferences);

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
    {
      method: "POST",
      headers: {
        "x-goog-api-key": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [
              {
                text: `${prompt}\n\nREFERENCE ORDER IS IMPORTANT. The first ${referenceParts.length} attached portraits are STYLE REFERENCES ONLY, sampled across the complete R001 portfolio. Never copy their identities. Match their unmistakably caricatured stop-motion puppet anatomy, sculpted silicone/clay facial treatment, realistically detailed hair, plain matte-black clothing, centered head-to-toe studio composition and saturated solid-color background. Any images after those first ${referenceParts.length} are DYNAMIC CHARACTER OR PROJECT REFERENCES: preserve only the explicitly relevant identity, anatomy or project details from them while rendering everything in R001. The result must visibly belong to this exact visual family and must not look like an ordinary real person. Create one new full-body casting portrait. No visible text, labels, props, borders, collage, or visible watermark.`,
              },
              ...referenceParts,
              ...dynamicReferenceParts,
            ],
          },
        ],
        generationConfig: {
          responseModalities: ["IMAGE"],
          imageConfig: { aspectRatio, imageSize: "1K" },
        },
      }),
      signal: AbortSignal.timeout(120_000),
      cache: "no-store",
    },
  );
  const data = (await response.json()) as GeminiImageResponse;
  if (!response.ok) {
    console.error("Nano Banana generation failed", response.status, data.error);
    throw new Error("NANO_BANANA_GENERATION_FAILED");
  }
  const part = data.candidates
    ?.flatMap((candidate) => candidate.content?.parts ?? [])
    .find((item) => item.inlineData?.data || item.inline_data?.data);
  const base64 = part?.inlineData?.data ?? part?.inline_data?.data;
  if (!base64) throw new Error("NANO_BANANA_EMPTY_OUTPUT");

  return {
    image: Buffer.from(base64, "base64"),
    generationId: crypto.randomUUID(),
    model,
    referenceUsage: {
      style: referenceParts.length,
      dynamic: dynamicReferenceParts.length,
      dynamicAvailable:
        NANO_BANANA_DYNAMIC_REFERENCE_LIMIT - dynamicReferenceParts.length,
      total: referenceParts.length + dynamicReferenceParts.length,
    },
  };
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

  const body = (await request.json()) as {
    projectId?: string;
    specialistId?: string;
    characterBrief?: string;
    aspectRatio?: "9:16" | "1:1" | "16:9";
    imageProvider?: "flux" | "banana";
    imageModel?: string;
    dynamicReferences?: DynamicImageReference[];
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

  const normalizedBrief = await normalizeVisualBrief(characterBrief);
  const aspectRatio =
    body.aspectRatio ?? specialist.generation.defaultAspectRatio;
  const prompt = buildCharacterCastingPrompt(specialist, normalizedBrief);
  const imageProvider = body.imageProvider === "flux" ? "flux" : "banana";
  let image: Buffer;
  let generationId: string;
  let model: string;
  let outputUrl = "";
  let referenceUsage:
    | {
        style: number;
        dynamic: number;
        dynamicAvailable: number;
        total: number;
      }
    | undefined;

  if (imageProvider === "banana") {
    try {
      const generated = await generateWithNanoBanana(
        specialist,
        prompt,
        aspectRatio,
        body.imageModel,
        body.dynamicReferences,
      );
      image = generated.image;
      generationId = generated.generationId;
      model = generated.model;
      referenceUsage = generated.referenceUsage;
    } catch (error) {
      console.error("Nano Banana character generation failed", error);
      return NextResponse.json(
        {
          error:
            error instanceof Error &&
            error.message === "NANO_BANANA_NOT_CONFIGURED"
              ? "NANO BANANA IS NOT CONNECTED."
              : "CHARACTER COULD NOT BE GENERATED WITH NANO BANANA.",
        },
        {
          status:
            error instanceof Error &&
            error.message === "NANO_BANANA_NOT_CONFIGURED"
              ? 503
              : 502,
        },
      );
    }
  } else {
    const token = process.env.REPLICATE_API_TOKEN;
    model =
      process.env[specialist.generation.modelEnvironmentVariable]?.trim() ?? "";
    if (
      !token ||
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
            prompt,
            aspect_ratio: aspectRatio,
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

    outputUrl = firstOutputUrl(prediction.output);
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

    image = Buffer.from(await imageResponse.arrayBuffer());
    generationId = prediction.id ?? crypto.randomUUID();
  }

  if (!image.length) {
    return NextResponse.json(
      { error: "GENERATED CHARACTER WAS EMPTY." },
      { status: 502 },
    );
  }
  const actorName = generateCastingActorName(
    `${characterBrief}\n${normalizedBrief}`,
    generationId,
  );
  const imageType = detectImageType(image);
  const storagePath = `${access.user.id}/${projectId}/characters/${generationId}.${imageType.extension}`;
  const { error: uploadError } = await access.supabase.storage
    .from("carabasai-media")
    .upload(storagePath, image, {
      contentType: imageType.contentType,
      cacheControl: "86400",
      upsert: true,
    });
  if (uploadError) {
    console.error("Generated character upload failed", {
      message: uploadError.message,
      name: uploadError.name,
      storagePath,
      contentType: imageType.contentType,
      bytes: image.length,
      userId: access.user.id,
    });
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
    imageProvider,
    ...(referenceUsage ? { referenceUsage } : {}),
  });
}
