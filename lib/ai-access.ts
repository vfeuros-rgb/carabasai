import "server-only";

import { createClient as createSupabaseClient, type SupabaseClient, type User } from "@supabase/supabase-js";
import { createClient as createServerClient } from "./supabase/server";

export class AiAccessError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly details?: Record<string, unknown>
  ) {
    super(message);
  }
}

type AuthenticatedAiRequest = {
  user: User;
  supabase: SupabaseClient;
};

export async function authenticateAiRequest(request: Request): Promise<AuthenticatedAiRequest> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new AiAccessError("AUTHENTICATION IS NOT CONFIGURED.", 503);

  const authorization = request.headers.get("authorization");
  const token = authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
  const supabase = token
    ? createSupabaseClient(url, key, {
        auth: { persistSession: false, autoRefreshToken: false },
        global: { headers: { Authorization: `Bearer ${token}` } },
      })
    : await createServerClient();
  const { data, error } = token
    ? await supabase.auth.getUser(token)
    : await supabase.auth.getUser();

  if (error || !data.user) {
    throw new AiAccessError("SIGN IN TO USE THE CREATIVE AGENTS.", 401);
  }
  if (!data.user.email_confirmed_at) {
    throw new AiAccessError("CONFIRM YOUR EMAIL BEFORE USING THE CREATIVE AGENTS.", 403);
  }
  return { user: data.user, supabase };
}

export async function consumeAiQuota(
  supabase: SupabaseClient,
  action: "creative-room" | "project-document"
) {
  const { data, error } = await supabase.rpc("consume_ai_request", { p_action: action });
  if (error) {
    console.error("AI quota check failed", error.message);
    throw new AiAccessError("USAGE LIMITS ARE TEMPORARILY UNAVAILABLE.", 503);
  }

  const result = data as {
    allowed?: boolean;
    daily_remaining?: number;
    minute_remaining?: number;
    retry_after_seconds?: number;
  } | null;
  if (!result?.allowed) {
    const retryAfter = Math.max(1, Number(result?.retry_after_seconds ?? 60));
    const dailyRemaining = Number(result?.daily_remaining ?? 0);
    throw new AiAccessError(
      dailyRemaining <= 0
        ? "YOUR DAILY CREATIVE LIMIT HAS BEEN REACHED. TRY AGAIN TOMORROW."
        : `TOO MANY REQUESTS. TRY AGAIN IN ${retryAfter} SECONDS.`,
      429,
      {
        retryAfter,
        dailyRemaining,
        minuteRemaining: Number(result?.minute_remaining ?? 0),
      }
    );
  }
  return result;
}

