type ReferenceMetadata = Record<string, string | number | boolean>;

export type ScreenplayReference = {
  text: string;
  metadata: ReferenceMetadata;
  score?: number;
};

const INDEX_NAME = process.env.SCREENPLAY_VECTORIZE_INDEX ?? "carabasai-screenplay";
const EMBEDDING_MODEL = "@cf/google/embeddinggemma-300m";

function vectorizeToken() {
  return process.env.CLOUDFLARE_VECTORIZE_API_TOKEN ?? process.env.CLOUDFLARE_API_TOKEN;
}

export function vectorizeIsConfigured() {
  return Boolean(
    process.env.CLOUDFLARE_ACCOUNT_ID
    && vectorizeToken(),
  );
}

async function embed(text: string, signal?: AbortSignal) {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${EMBEDDING_MODEL}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${vectorizeToken()}`,
    },
    body: JSON.stringify({
      text: [text.slice(0, 12000)],
    }),
    signal,
  });
  const payload = await response.json() as {
    result?: { data?: number[][] };
    errors?: Array<{ message?: string }>;
  };
  const embedding = payload.result?.data?.[0];
  if (!response.ok || !embedding) throw new Error(payload.errors?.[0]?.message || "REFERENCE EMBEDDING FAILED.");
  return embedding;
}

async function query(
  text: string,
  filter: Record<string, unknown>,
  limit: number,
  signal?: AbortSignal,
): Promise<ScreenplayReference[]> {
  const vector = await embed(text, signal);
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/vectorize/v2/indexes/${INDEX_NAME}/query`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${vectorizeToken()}`,
      },
      body: JSON.stringify({ vector, topK: Math.min(Math.max(limit, 1), 12), filter, returnMetadata: "all" }),
      signal,
    },
  );
  const payload = await response.json() as {
    result?: { matches?: Array<{ score?: number; metadata?: ReferenceMetadata }> };
    errors?: Array<{ message?: string }>;
  };
  if (!response.ok) throw new Error(payload.errors?.[0]?.message || "REFERENCE INDEX QUERY FAILED.");
  return (payload.result?.matches ?? []).flatMap((match) => {
    const metadata = match.metadata ?? {};
    const referenceText = typeof metadata.text === "string" ? metadata.text : "";
    if (!referenceText) return [];
    const { text: _text, ...publicMetadata } = metadata;
    return [{ text: referenceText, metadata: publicMetadata, score: match.score }];
  });
}

export async function retrieveSceneReferences(
  queryText: string,
  genre: string,
  functionTag: string,
  limit = 2,
  signal?: AbortSignal,
) {
  const [strict, crossGenre] = await Promise.all([query(queryText, {
    kind: "scene",
    genre: genre.toLowerCase(),
    function_tag: functionTag,
  }, 1, signal), query(queryText, { kind: "scene", function_tag: functionTag }, Math.max(limit + 2, 4), signal)]);
  const seen = new Set<string>();
  return [...strict, ...crossGenre].filter((item) => {
    const key = `${item.metadata.source_file ?? ""}:${item.metadata.scene_number ?? ""}:${item.text.slice(0, 100)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, limit);
}

export async function retrieveDialogueReferences(
  queryText: string,
  genre: string,
  limit = 6,
  signal?: AbortSignal,
) {
  const normalizedGenre = genre.toLowerCase();
  const [sameGenre, allGenres] = await Promise.all([
    query(queryText, { kind: "dialogue", genre: normalizedGenre }, Math.min(3, limit), signal),
    query(queryText, { kind: "dialogue" }, Math.max(8, limit * 2), signal),
  ]);
  const substantial = (item: ScreenplayReference) => {
    const turns = Number(item.metadata.turn_count ?? 0);
    return !turns || turns >= 3;
  };
  const crossGenre = allGenres.filter((item) => String(item.metadata.genre ?? "").toLowerCase() !== normalizedGenre);
  const ordered = [
    ...crossGenre.filter(substantial),
    ...sameGenre.filter(substantial),
    ...allGenres.filter(substantial),
    ...crossGenre,
    ...sameGenre,
    ...allGenres,
  ];
  const seen = new Set<string>();
  return ordered.filter((item) => {
    const key = `${item.metadata.source_file ?? ""}:${item.metadata.scene_number ?? ""}:${item.text.slice(0, 100)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, limit);
}
