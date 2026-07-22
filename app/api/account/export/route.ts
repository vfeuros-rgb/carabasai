import { NextResponse } from "next/server";
import { createClient } from "../../../../lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "Authentication required." }, { status: 401 });

  const [profile, projects, messages, notebook, media, sections, jobs] = await Promise.all([
    supabase.from("account_leads").select("email,full_name,terms_accepted_at,email_confirmed_at,created_at,updated_at").maybeSingle(),
    supabase.from("projects").select("*").order("created_at"),
    supabase.from("messages").select("*").order("created_at"),
    supabase.from("notebook_items").select("*").order("created_at"),
    supabase.from("media_assets").select("id,project_id,bucket,path,kind,original_name,mime_type,size_bytes,created_at").order("created_at"),
    supabase.from("project_sections").select("*").order("updated_at"),
    supabase.from("generation_jobs").select("id,project_id,kind,status,input,output,error,created_at,updated_at").order("created_at"),
  ]);

  const failed = [profile, projects, messages, notebook, media, sections, jobs].find((result) => result.error);
  if (failed?.error) return NextResponse.json({ error: "Could not prepare the export." }, { status: 500 });

  const body = JSON.stringify({
    exportedAt: new Date().toISOString(),
    format: "CARABASAI_ACCOUNT_EXPORT_V1",
    account: profile.data,
    projects: projects.data ?? [],
    messages: messages.data ?? [],
    notebookItems: notebook.data ?? [],
    mediaMetadata: media.data ?? [],
    projectSections: sections.data ?? [],
    generationJobs: jobs.data ?? [],
  }, null, 2);

  return new NextResponse(body, {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="carabasai-data-${new Date().toISOString().slice(0, 10)}.json"`,
      "Cache-Control": "no-store",
    },
  });
}
