"use client";

import { FormEvent, useEffect, useState } from "react";
import { createClient } from "../../../lib/supabase/client";

export default function ResetPasswordPage() {
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [sessionReady, setSessionReady] = useState(false);

  useEffect(() => {
    const recoveryReady = window.sessionStorage.getItem("carabasai-password-recovery") === "ready";
    if (recoveryReady) {
      queueMicrotask(() => setSessionReady(true));
      return;
    }

    createClient().auth.getSession().then(({ data }) => {
      if (data.session) setSessionReady(true);
      else setMessage("ENTER A NEW RECOVERY CODE TO CONTINUE.");
    }).catch(() => setMessage("ENTER A NEW RECOVERY CODE TO CONTINUE."));
  }, []);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!sessionReady) {
      setMessage("ENTER A NEW RECOVERY CODE TO CONTINUE.");
      return;
    }
    if (password !== confirmation) {
      setMessage("PASSWORDS DO NOT MATCH.");
      return;
    }

    setLoading(true); setMessage("");
    const { error } = await createClient().auth.updateUser({ password });
    if (error) {
      setMessage(error.message);
      setLoading(false);
      return;
    }

    window.sessionStorage.removeItem("carabasai-password-recovery");
    setMessage("PASSWORD UPDATED.");
    setLoading(false);
    window.setTimeout(() => window.location.assign("/studio"), 700);
  }

  async function leaveRecovery() {
    window.sessionStorage.removeItem("carabasai-password-recovery");
    await createClient().auth.signOut({ scope: "local" });
    window.location.assign("/account");
  }

  return <main className="flex min-h-screen items-center justify-center bg-[#050505] p-5 text-white"><section className="w-full max-w-md rounded-[28px] border border-white/10 bg-white/[0.025] p-7"><p className="text-[10px] font-black tracking-[0.18em] text-[#FFDF00]">CARABASAI ACCOUNT</p><h1 className="mt-4 text-3xl font-black">SET A NEW PASSWORD.</h1><p className={`mt-4 text-[10px] font-black ${sessionReady ? "text-emerald-300" : "text-white/35"}`}>{sessionReady ? "CODE VERIFIED" : "RECOVERY CODE REQUIRED"}</p><form onSubmit={save} className="mt-7 space-y-3"><input type="password" required minLength={8} disabled={!sessionReady} value={password} onChange={(event) => setPassword(event.target.value)} placeholder="NEW PASSWORD" autoComplete="new-password" className="h-14 w-full rounded-[14px] border border-white/10 bg-black/30 px-4 text-sm outline-none disabled:opacity-35 focus:border-[#FFDF00]/50" /><input type="password" required minLength={8} disabled={!sessionReady} value={confirmation} onChange={(event) => setConfirmation(event.target.value)} placeholder="REPEAT NEW PASSWORD" autoComplete="new-password" className="h-14 w-full rounded-[14px] border border-white/10 bg-black/30 px-4 text-sm outline-none disabled:opacity-35 focus:border-[#FFDF00]/50" /><button disabled={loading || !sessionReady} className="h-12 w-full rounded-full bg-[#FFDF00] text-[10px] font-black text-black disabled:opacity-30">{loading ? "PLEASE WAIT..." : "SAVE NEW PASSWORD"}</button></form>{message && <p className="mt-5 text-[10px] leading-5 text-white/55">{message}</p>}<button type="button" onClick={leaveRecovery} className="mt-7 inline-flex text-[10px] font-black text-white/40">← BACK TO ACCOUNT</button></section></main>;
}
