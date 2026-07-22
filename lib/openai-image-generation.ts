import sharp from "sharp";

export type OpenAiImageReference = {
  data: Buffer;
  mimeType: string;
  name?: string;
};

function sizeForAspectRatio(aspectRatio: string) {
  const [width, height] = aspectRatio.split(":").map(Number);
  if (width > height) return "1536x1024";
  if (height > width) return "1024x1536";
  return "1024x1024";
}

function exactSizeForAspectRatio(aspectRatio: string) {
  switch (aspectRatio) {
    case "16:9":
      return { width: 1536, height: 864 };
    case "9:16":
      return { width: 864, height: 1536 };
    case "4:3":
      return { width: 1365, height: 1024 };
    case "3:4":
      return { width: 1024, height: 1365 };
    default:
      return { width: 1024, height: 1024 };
  }
}

async function normalizeImageAspectRatio(image: Buffer, aspectRatio: string) {
  const { width, height } = exactSizeForAspectRatio(aspectRatio);
  return sharp(image)
    .rotate()
    .resize(width, height, { fit: "cover", position: "centre" })
    .png({ compressionLevel: 9 })
    .toBuffer();
}

export async function generateWithOpenAiImage(options: {
  prompt: string;
  aspectRatio?: string;
  references?: OpenAiImageReference[];
  model?: string;
  quality?: "low" | "medium" | "high";
}) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("GPT IMAGE IS NOT CONNECTED.");

  const model = options.model?.trim() || process.env.OPENAI_IMAGE_MODEL?.trim() || "gpt-image-2";
  const quality = options.quality ?? "medium";
  const aspectRatio = options.aspectRatio ?? "1:1";
  const size = sizeForAspectRatio(aspectRatio);
  const references = options.references ?? [];
  let response: Response;

  if (references.length) {
    const form = new FormData();
    form.append("model", model);
    form.append("prompt", options.prompt);
    form.append("size", size);
    form.append("quality", quality);
    form.append("output_format", "png");
    // gpt-image-2 rejects input_fidelity on image edits. The reference image
    // is still supplied below and the continuity requirements live in the
    // prompt, so omitting this unsupported field preserves the edit flow.
    references.slice(0, 16).forEach((reference, index) => {
      form.append(
        "image[]",
        new Blob([new Uint8Array(reference.data)], { type: reference.mimeType }),
        reference.name ?? `reference-${index + 1}.png`,
      );
    });
    response = await fetch("https://api.openai.com/v1/images/edits", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
      signal: AbortSignal.timeout(110_000),
      cache: "no-store",
    });
  } else {
    response = await fetch("https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        prompt: options.prompt,
        size,
        quality,
        output_format: "png",
      }),
      signal: AbortSignal.timeout(110_000),
      cache: "no-store",
    });
  }

  const payload = (await response.json()) as {
    data?: Array<{ b64_json?: string; url?: string }>;
    error?: { message?: string };
  };
  if (!response.ok) {
    console.error("GPT Image request failed", response.status, payload.error?.message);
    throw new Error("GPT IMAGE COULD NOT GENERATE THIS FRAME.");
  }
  const result = payload.data?.[0];
  if (result?.b64_json) {
    const image = await normalizeImageAspectRatio(Buffer.from(result.b64_json, "base64"), aspectRatio);
    return { image, model };
  }
  if (result?.url) {
    const imageResponse = await fetch(result.url, { signal: AbortSignal.timeout(60_000) });
    if (imageResponse.ok) {
      const image = await normalizeImageAspectRatio(
        Buffer.from(await imageResponse.arrayBuffer()),
        aspectRatio,
      );
      return { image, model };
    }
  }
  throw new Error("GPT IMAGE RETURNED NO IMAGE.");
}
