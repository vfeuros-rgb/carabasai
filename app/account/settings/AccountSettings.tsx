"use client";

import { FormEvent, useEffect, useState } from "react";
import TurnstileWidget from "../TurnstileWidget";
import { createClient } from "../../../lib/supabase/client";

type Step = "idle" | "code" | "password" | "complete";

export default function AccountSettings({ email }: { email: string }) {
  const [step, setStep] = useState<Step>("idle");
  const [passwordPanelOpen, setPasswordPanelOpen] = useState(false);
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [captchaToken, setCaptchaToken] = useState("");
  const [captchaVersion, setCaptchaVersion] = useState(0);
  const [cooldown, setCooldown] = useState(0);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = window.setInterval(() => setCooldown((value) => Math.max(0, value - 1)), 1000);
    return () => window.clearInterval(timer);
  }, [cooldown]);

  async function sendCode() {
    if (!captchaToken || cooldown > 0) return;
    setLoading(true); setMessage("");
    const { error } = await createClient().auth.resetPasswordForEmail(email, { captchaToken });
    setCaptchaToken(""); setCaptchaVersion((value) => value + 1);
    if (error) setMessage(/rate limit|too many/i.test(error.message) ? "EMAIL SERVICE IS TEMPORARILY BUSY. TRY AGAIN LATER." : error.message);
    else { setStep("code"); setCooldown(60); }
    setLoading(false);
  }

  async function verifyCode(event: FormEvent) {
    event.preventDefault();
    const token = code.replace(/\D/g, "");
    if (token.length !== 6) return;
    setLoading(true); setMessage("");
    const { error } = await createClient().auth.verifyOtp({ email, token, type: "recovery" });
    if (error) setMessage("THE CODE IS INCORRECT OR EXPIRED.");
    else setStep("password");
    setLoading(false);
  }

  async function updatePassword(event: FormEvent) {
    event.preventDefault();
    if (password !== confirmation) { setMessage("PASSWORDS DO NOT MATCH."); return; }
    setLoading(true); setMessage("");
    const { error } = await createClient().auth.updateUser({ password });
    if (error) setMessage(error.message);
    else { setStep("complete"); setPassword(""); setConfirmation(""); }
    setLoading(false);
  }

  return <div className="mx-auto w-full max-w-4xl px-5 py-8 sm:px-10 sm:py-12">
    <p className="text-[10px] font-black tracking-[0.2em] text-[#FFDF00]">ACCOUNT SETTINGS</p>
    <h1 className="mt-4 text-4xl font-black tracking-[-0.05em] sm:text-5xl">YOUR ACCOUNT.</h1>
    <section className="mt-10 overflow-hidden rounded-[24px] border border-white/10 bg-[#0A0A0A]">
      <div className="flex flex-col gap-2 border-b border-white/10 px-5 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-7">
        <div><p className="text-[9px] font-black tracking-[0.16em] text-white/30">EMAIL</p><p className="mt-2 break-all text-sm font-bold sm:text-base">{email}</p></div>
        <span className="text-[8px] font-black tracking-[0.13em] text-emerald-300">VERIFIED ACCOUNT</span>
      </div>
      <div className="px-5 py-5 sm:px-7">
        <div className="flex items-center justify-between gap-5">
          <div><p className="text-[9px] font-black tracking-[0.16em] text-white/30">PASSWORD</p><p className="mt-2 text-sm text-white/45">••••••••••••</p></div>
          {!passwordPanelOpen && <button type="button" onClick={() => { setPasswordPanelOpen(true); setStep("idle"); setMessage(""); }} className="shrink-0 rounded-full border border-white/15 px-4 py-2.5 text-[9px] font-black tracking-[0.08em] text-white/60 transition hover:border-[#FFDF00]/40 hover:text-[#FFDF00]">CHANGE PASSWORD</button>}
        </div>
        {passwordPanelOpen && <div className="mt-6 max-w-lg border-t border-white/10 pt-6">
        {step === "idle" && <>
          <div className="flex items-start justify-between gap-4"><div><h2 className="text-lg font-black">Confirm password change</h2><p className="mt-2 text-xs leading-5 text-white/35">Complete the security check. We will then send a 6-digit code to {email}.</p></div><button type="button" onClick={() => { setPasswordPanelOpen(false); setCaptchaToken(""); setMessage(""); }} className="text-lg text-white/25 hover:text-white" aria-label="Close password change">×</button></div>
          <div className="mt-5"><TurnstileWidget key={captchaVersion} onToken={setCaptchaToken} /></div>
          <button type="button" disabled={!captchaToken || loading} onClick={() => void sendCode()} className="mt-4 h-11 w-full rounded-full bg-[#FFDF00] text-[9px] font-black text-black disabled:opacity-30">{loading ? "SENDING..." : "SEND 6-DIGIT CODE"}</button>
        </>}
        {step === "code" && <form onSubmit={verifyCode}>
          <h2 className="mt-4 text-2xl font-black">Check your email</h2>
          <p className="mt-3 text-xs leading-5 text-white/35">Enter the 6-digit code sent to {email}.</p>
          <input value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" maxLength={6} placeholder="000000" className="mt-6 h-16 w-full rounded-2xl border border-white/12 bg-black/30 text-center text-2xl font-black tracking-[0.35em] outline-none focus:border-[#FFDF00]/50" />
          <button disabled={code.length !== 6 || loading} className="mt-4 h-12 w-full rounded-full bg-[#FFDF00] text-[10px] font-black text-black disabled:opacity-30">{loading ? "VERIFYING..." : "VERIFY CODE"}</button>
          <button type="button" disabled={cooldown > 0 || loading} onClick={() => setStep("idle")} className="mt-3 h-10 w-full text-[9px] font-black text-white/35 disabled:opacity-30">{cooldown ? `NEW CODE IN ${cooldown}s` : "REQUEST A NEW CODE"}</button>
        </form>}
        {step === "password" && <form onSubmit={updatePassword}>
          <h2 className="mt-4 text-2xl font-black">Set a new password</h2>
          <input type="password" required minLength={8} value={password} onChange={(event) => setPassword(event.target.value)} placeholder="NEW PASSWORD" autoComplete="new-password" className="mt-6 h-14 w-full rounded-2xl border border-white/12 bg-black/30 px-4 text-sm outline-none focus:border-[#FFDF00]/50" />
          <input type="password" required minLength={8} value={confirmation} onChange={(event) => setConfirmation(event.target.value)} placeholder="REPEAT NEW PASSWORD" autoComplete="new-password" className="mt-3 h-14 w-full rounded-2xl border border-white/12 bg-black/30 px-4 text-sm outline-none focus:border-[#FFDF00]/50" />
          <button disabled={loading} className="mt-4 h-12 w-full rounded-full bg-[#FFDF00] text-[10px] font-black text-black disabled:opacity-30">{loading ? "SAVING..." : "SAVE NEW PASSWORD"}</button>
        </form>}
        {step === "complete" && <div className="py-6"><div className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-400 text-xl text-black">✓</div><h2 className="mt-5 text-2xl font-black">Password updated.</h2><p className="mt-3 text-xs text-white/35">Your new password is active.</p></div>}
        {message && <p className="mt-4 text-[10px] leading-5 text-red-300/80">{message}</p>}
        </div>}
      </div>
    </section>
  </div>;
}
