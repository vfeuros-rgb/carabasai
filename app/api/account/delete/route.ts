import { NextResponse } from "next/server";
import { createClient } from "../../../../lib/supabase/server";

export const dynamic = "force-dynamic";

function collectOwnedPaths(value: unknown, userId: string, output: Set<string>) {
  if (typeof value === "string" && value.startsWith(`${userId}/`)) output.add(value);
  else if (Array.isArray(value)) value.forEach((item) => collectOwnedPaths(item, userId, output));
  else if (value && typeof value === "object") Object.values(value).forEach((item) => collectOwnedPaths(item, userId, output));
}

export async function DELETE() {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  const user = auth.user;
  if (!user) return NextResponse.json({ error: "Authentication required." }, { status: 401 });

  const [media, projects, avatars] = await Promise.all([
    supabase.from("media_assets").select("path"),
    supabase.from("projects").select("project_document"),
    supabase.storage.from("avatars").list(user.id, { limit: 1000 }),
  ]);
  const mediaPaths = new Set<string>((media.data ?? []).map((item) => item.path).filter((path) => path.startsWith(`${user.id}/`)));
  (projects.data ?? []).forEach((project) => collectOwnedPaths(project.project_document, user.id, mediaPaths));

  const paths = [...mediaPaths];
  for (let index = 0; index < paths.length; index += 100) {
    await supabase.storage.from("carabasai-media").remove(paths.slice(index, index + 100));
  }
  const avatarPaths = (avatars.data ?? []).map((item) => `${user.id}/${item.name}`);
  if (avatarPaths.length) await supabase.storage.from("avatars").remove(avatarPaths);

  const { error } = await supabase.rpc("delete_own_account");
  if (error) return NextResponse.json({ error: "Account deletion is not available until the privacy database migration is installed." }, { status: 503 });
  return NextResponse.json({ deleted: true });
}
