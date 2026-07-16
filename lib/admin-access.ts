import "server-only";

import { notFound } from "next/navigation";
import { createClient } from "./supabase/server";

export async function requireAdmin() {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();
  const allowedEmails = (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
  const email = data.user?.email?.toLowerCase();

  if (error || !data.user || !email || !allowedEmails.includes(email)) notFound();
  return { user: data.user, supabase };
}

