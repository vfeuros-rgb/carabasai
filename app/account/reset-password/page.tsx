"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { createClient } from "../../../lib/supabase/client";

export default function ResetPasswordPage() {
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [sessionReady, setSessionReady] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    let active = true;
    const timeout = window.setTimeout(() => {
      if (active) setMessage("COULD NOT VERIFY THIS LINK. REQUEST A NEW PASSWORD RECOVERY EMAIL.");
    }, 10000);

    async function prepareRecovery() {
      try {
        const query = new URLSearchParams(window.location.search);
        const fragment = new URLSearchParams(window.location.hash.replace(/^#/, ""));
        const code = query.get("code");
        const accessToken = fragment.get("access_token");
        const refreshToken = fragment.get("refresh_token");

        if (code) {
          const { error } = await supabase.auth.exchangeCodeForSession(code);
          if (error) throw error;
        } else if (accessToken && refreshToken) {
          const { error } = await supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
          if (error) throw error;
        }

        const { data, error } = await supabase.auth.getSession();
        if (error) throw error;
        if (!data.session) throw new Error("Recovery session was not created.");
        if (active) {
          window.clearTimeout(timeout);
          setSessionReady(true);
          setMessage("");
          window.history.replaceState({}, "", "/account/reset-password");
        }
      } catch {
        if (active) {
          window.clearTimeout(timeout);
          setSessionReady(false);
          setMessage("THIS RECOVERY LINK IS INVALID, EXPIRED, OR ALREADY USED. REQUEST A NEW ONE.");
        }
      }
    }

    prepareRecovery();
    return () => { active = false; window.clearTimeout(timeout); };
  }, []);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!sessionReady) { setMessage("OPEN A FRESH PASSWORD RECOVERY LINK FROM YOUR EMAIL."); return; }
    if (password !== confirmation) { setMessage("PASSWORDS DO NOT MATCH."); return; }
    setLoading(true); setMessage("");
    const { error } = await createClient().auth.updateUser({ password });
    setMessage(error ? error.message : "PASSWORD UPDATED. YOU CAN CONTINUE TO YOUR ACCOUNT.");
    setLoading(false);
  }

  return <main className="flex min-h-screen items-center justify-center bg-[#050505] p-5 text-white"><section className="w-full max-w-md rounded-[28px] border border-white/10 bg-white/[0.025] p-7"><p className="text-[10px] font-black tracking-[0.18em] text-[#FFDF00]">CARABASAI ACCOUNT</p><h1 className="mt-4 text-3xl font-black">SET A NEW PASSWORD.</h1><p className={`mt-4 text-[10px] font-black ${sessionReady ? "text-emerald-300" : "text-white/35"}`}>{sessionReady ? "RECOVERY LINK VERIFIED" : "VERIFYING RECOVERY LINK..."}</p><form onSubmit={save} className="mt-7 space-y-3"><input type="password" required minLength={8} disabled={!sessionReady} value={password} onChange={(event) => setPassword(event.target.value)} placeholder="NEW PASSWORD" autoComplete="new-password" className="h-14 w-full rounded-[14px] border border-white/10 bg-black/30 px-4 text-sm outline-none disabled:opacity-35 focus:border-[#FFDF00]/50" /><input type="password" required minLength={8} disabled={!sessionReady} value={confirmation} onChange={(event) => setConfirmation(event.target.value)} placeholder="REPEAT NEW PASSWORD" autoComplete="new-password" className="h-14 w-full rounded-[14px] border border-white/10 bg-black/30 px-4 text-sm outline-none disabled:opacity-35 focus:border-[#FFDF00]/50" /><button disabled={loading || !sessionReady} className="h-12 w-full rounded-full bg-[#FFDF00] text-[10px] font-black text-black disabled:opacity-30">{loading ? "PLEASE WAIT..." : "SAVE NEW PASSWORD"}</button></form>{message && <p className="mt-5 text-[10px] leading-5 text-white/55">{message}</p>}<Link href="/account" className="mt-7 inline-flex text-[10px] font-black text-white/40">← BACK TO ACCOUNT</Link></section></main>;
}
