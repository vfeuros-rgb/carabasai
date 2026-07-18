const LEADING_PHRASES = [
  /^(?:я\s+)?(?:хочу|хотел(?:а)?\s+бы)\s+(?:сделать|создать|снять|написать)\s+/i,
  /^(?:сделай|создай|сними|напиши)\s+/i,
  /^(?:i\s+)?(?:want|would\s+like)\s+to\s+(?:make|create|shoot|write)\s+/i,
  /^(?:make|create|shoot|write)\s+/i,
];

export function deriveProjectTitle(brief: string) {
  let value = brief
    .replace(/[\r\n]+/g, " ")
    .replace(/[“”«»"'`]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  for (const pattern of LEADING_PHRASES) value = value.replace(pattern, "");
  const phrase = value.split(/[.!?;:]/, 1)[0]?.trim() || value;
  const words = phrase.split(/\s+/).filter(Boolean).slice(0, 5);
  const title = words.join(" ").replace(/[,.\-–—]+$/g, "").trim();
  if (!title) return "Untitled project";
  return title.charAt(0).toLocaleUpperCase() + title.slice(1);
}

export function normalizeAutomaticProjectTitle(title: string | undefined, brief: string | undefined) {
  const notes = brief?.trim() ?? "";
  if (!notes) return title || "Untitled project";
  const current = title?.trim() ?? "";
  if (!current || current === notes || current === notes.slice(0, 42)) return deriveProjectTitle(notes);
  return current;
}
