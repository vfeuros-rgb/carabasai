import * as tus from "tus-js-client";
import { createClient } from "./client";

export type MediaKind = "references" | "chat-attachments" | "generated-images" | "generated-videos" | "project-covers" | "exports";
export type MediaTransform = { width?: number; height?: number; resize?: "cover" | "contain" | "fill"; quality?: number };
const BUCKET = "carabasai-media";

function safeName(name: string) {
  return name.normalize("NFKD").replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/-+/g, "-");
}

export async function uploadProjectMedia(file: File, projectId: string, kind: MediaKind, onProgress?: (percent: number) => void) {
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user) throw new Error("SIGN IN BEFORE UPLOADING FILES.");
  const objectPath = `${session.user.id}/${projectId}/${kind}/${crypto.randomUUID()}-${safeName(file.name)}`;

  if (file.size <= 6 * 1024 * 1024) {
    const { error } = await supabase.storage.from(BUCKET).upload(objectPath, file, { contentType: file.type, cacheControl: "31536000", upsert: false });
    if (error) throw error;
    onProgress?.(100);
  } else {
    const projectIdFromUrl = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!).hostname.split(".")[0];
    await new Promise<void>((resolve, reject) => {
      const upload = new tus.Upload(file, {
        endpoint: `https://${projectIdFromUrl}.storage.supabase.co/storage/v1/upload/resumable`,
        retryDelays: [0, 3000, 5000, 10000, 20000],
        headers: { authorization: `Bearer ${session.access_token}`, "x-upsert": "false" },
        uploadDataDuringCreation: true,
        removeFingerprintOnSuccess: true,
        chunkSize: 6 * 1024 * 1024,
        metadata: { bucketName: BUCKET, objectName: objectPath, contentType: file.type, cacheControl: "31536000" },
        onProgress: (uploaded, total) => onProgress?.(Math.round((uploaded / total) * 100)),
        onError: reject,
        onSuccess: () => resolve(),
      });
      upload.findPreviousUploads().then((previous) => {
        if (previous[0]) upload.resumeFromPreviousUpload(previous[0]);
        upload.start();
      }).catch(reject);
    });
  }

  return { bucket: BUCKET, path: objectPath, name: file.name, type: file.type, size: file.size };
}

export async function createMediaUrl(path: string, expiresIn = 3600, transform?: MediaTransform) {
  const { data, error } = await createClient().storage.from(BUCKET).createSignedUrl(path, expiresIn, transform ? { transform } : undefined);
  if (error) throw error;
  return data.signedUrl;
}

export async function createMediaUrls(paths: string[], expiresIn = 3600, transform?: MediaTransform) {
  if (!paths.length) return {} as Record<string, string>;
  if (transform) {
    const entries: Array<[string, string]> = [];
    for (let index = 0; index < paths.length; index += 8) {
      const chunk = paths.slice(index, index + 8);
      const urls = await Promise.all(chunk.map(async (path) => [path, await createMediaUrl(path, expiresIn, transform)] as [string, string]));
      entries.push(...urls);
    }
    return Object.fromEntries(entries);
  }
  const { data, error } = await createClient().storage.from(BUCKET).createSignedUrls(paths, expiresIn);
  if (error) throw error;
  return Object.fromEntries(data.flatMap((item, index) => item.signedUrl ? [[paths[index], item.signedUrl]] : []));
}
