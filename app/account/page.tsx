"use client";

import Link from "next/link";
import { ChangeEvent, FormEvent, useEffect, useState } from "react";
import { createClient } from "../../lib/supabase/client";
import TurnstileWidget from "./TurnstileWidget";
import StudioSidebar from "../components/StudioSidebar";

type Mode = "sign-in" | "sign-up";
type AccountSession = { id?: string; title?: string; notes?: string; startedAt?: number; references?: { dataUrl?: string; type?: string }[]; messages?: unknown[]; notebook?: unknown[]; projectDocument?: unknown };

export default function AccountPage() {
  const [mode, setMode] = useState<Mode>("sign-in");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirmation, setPasswordConfirmation] = useState("");
  const [accepted, setAccepted] = useState(false);
  const [captchaToken, setCaptchaToken] = useState("");
  const [message, setMessage] = useState("");
  const [userEmail, setUserEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [recoveryMode, setRecoveryMode] = useState(false);
  const [avatarUrl, setAvatarUrl] = useState("");
  const [awaitingConfirmation, setAwaitingConfirmation] = useState(false);
  const [captchaVersion, setCaptchaVersion] = useState(0);
  const [recoverySent, setRecoverySent] = useState(false);
  const [recoveryCooldown, setRecoveryCooldown] = useState(0);
  const [recoveryCode, setRecoveryCode] = useState("");
  const [historyOpen, setHistoryOpen] = useState(true);
  const [accountSessions, setAccountSessions] = useState<AccountSession[]>([]);
  const [authReady, setAuthReady] = useState(false);
  const [projectsOpen, setProjectsOpen] = useState(false);

  const presetAvatars = ["🎬", "🎭", "🎞️", "🕯️", "🎥", "✍️"];

  useEffect(() => {
    try {
      createClient().auth.getUser().then(({ data }) => {
        setUserEmail(data.user?.email ?? "");
        setName(String(data.user?.user_metadata.full_name ?? ""));
        setAvatarUrl(String(data.user?.user_metadata.avatar_url ?? ""));
      }).finally(() => setAuthReady(true));
    } catch { queueMicrotask(() => setAuthReady(true)); }
    const search = new URLSearchParams(window.location.search);
    const requestedMode = search.get("mode");
    if (requestedMode === "sign-up" || requestedMode === "sign-in") queueMicrotask(() => setMode(requestedMode));
    const confirmation = search.get("confirmation");
    if (confirmation) queueMicrotask(() => setMessage(confirmation === "success" ? "EMAIL CONFIRMED. YOUR ACCOUNT IS READY." : "EMAIL CONFIRMATION FAILED OR EXPIRED."));
    queueMicrotask(() => setAccountSessions(JSON.parse(localStorage.getItem("carabasaiSessionHistory") ?? "[]") as AccountSession[]));
  }, []);

  useEffect(() => {
    if (recoveryCooldown <= 0) return;
    const timer = window.setInterval(() => setRecoveryCooldown((current) => Math.max(0, current - 1)), 1000);
    return () => window.clearInterval(timer);
  }, [recoveryCooldown]);

  function changeMode(next: Mode) {
    setMode(next); setMessage(""); setCaptchaToken(""); setPasswordConfirmation("");
  }

  async function authenticate(event: FormEvent) {
    event.preventDefault();
    if (!captchaToken) { setMessage("COMPLETE THE SECURITY CHECK."); return; }
    if (mode === "sign-up" && !accepted) { setMessage("ACCEPT THE TERMS TO CONTINUE."); return; }
    if (mode === "sign-up" && password !== passwordConfirmation) { setMessage("PASSWORDS DO NOT MATCH."); return; }
    setLoading(true); setMessage(mode === "sign-in" ? "SIGNING IN..." : "CREATING ACCOUNT...");
    try {
      const supabase = createClient();
      const result = mode === "sign-in"
        ? await supabase.auth.signInWithPassword({ email, password, options: { captchaToken } })
        : await supabase.auth.signUp({
            email,
            password,
            options: {
              data: { full_name: name.trim(), terms_accepted_at: new Date().toISOString() },
              captchaToken,
              emailRedirectTo: `${window.location.origin}/auth/callback`,
            },
          });
      if (result.error) throw result.error;
      if (mode === "sign-up" && !result.data.session) {
        setAwaitingConfirmation(true);
        setMessage("");
      } else {
        setUserEmail(result.data.user?.email ?? email);
        setMessage("ACCOUNT CONNECTED.");
        if (mode === "sign-in") {
          window.location.assign("/studio");
        }
      }
    } catch (error) {
      const rawMessage = error instanceof Error ? error.message : "COULD NOT CONNECT ACCOUNT.";
      setMessage(/rate limit|too many/i.test(rawMessage) ? "EMAIL SENDING LIMIT REACHED FOR THIS PROJECT. A DIFFERENT EMAIL WILL NOT BYPASS IT. WAIT ABOUT AN HOUR OR CONNECT CUSTOM SMTP." : rawMessage);
      setCaptchaToken("");
      setCaptchaVersion((current) => current + 1);
    }
    finally { setLoading(false); }
  }

  async function signOut() { await createClient().auth.signOut(); setUserEmail(""); setMessage("SIGNED OUT."); }

  async function sendRecovery(event: FormEvent) {
    event.preventDefault(); setLoading(true); setMessage("");
    if (!captchaToken) { setMessage("COMPLETE THE SECURITY CHECK."); setLoading(false); return; }
    if (recoveryCooldown > 0) { setLoading(false); return; }
    const { error } = await createClient().auth.resetPasswordForEmail(email, { captchaToken });
    if (error) {
      const rateLimited = /rate limit|too many/i.test(error.message);
      setMessage(rateLimited ? "EMAIL SERVICE IS TEMPORARILY BUSY. PLEASE TRY AGAIN LATER." : error.message);
      if (rateLimited) setRecoveryCooldown(60);
      setCaptchaToken("");
      setCaptchaVersion((current) => current + 1);
    } else {
      setRecoverySent(true);
      setRecoveryCooldown(60);
      setMessage("");
      setCaptchaToken("");
      setCaptchaVersion((current) => current + 1);
    }
    setLoading(false);
  }

  async function verifyRecoveryCode(event: FormEvent) {
    event.preventDefault();
    const normalizedCode = recoveryCode.replace(/\D/g, "");
    if (normalizedCode.length !== 6) {
      setMessage("ENTER THE 6-DIGIT CODE FROM THE EMAIL.");
      return;
    }
    setLoading(true); setMessage("");
    const { error } = await createClient().auth.verifyOtp({
      email,
      token: normalizedCode,
      type: "recovery",
    });
    if (error) {
      setMessage("THE CODE IS INCORRECT OR EXPIRED. REQUEST A NEW CODE.");
      setLoading(false);
      return;
    }
    window.sessionStorage.setItem("carabasai-password-recovery", "ready");
    window.location.assign("/account/reset-password");
  }

  async function saveAvatar(nextAvatar: string) {
    setLoading(true); setMessage("");
    const { error } = await createClient().auth.updateUser({ data: { avatar_url: nextAvatar } });
    if (error) setMessage(error.message); else { setAvatarUrl(nextAvatar); setMessage("AVATAR UPDATED."); }
    setLoading(false);
  }

  async function uploadAvatar(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]; if (!file) return;
    if (!file.type.startsWith("image/") || file.size > 5 * 1024 * 1024) { setMessage("CHOOSE AN IMAGE UP TO 5 MB."); return; }
    setLoading(true); setMessage("");
    const supabase = createClient();
    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) { setMessage("SIGN IN FIRST."); setLoading(false); return; }
    const extension = file.name.split(".").pop()?.toLowerCase() || "jpg";
    const path = `${userData.user.id}/avatar-${Date.now()}.${extension}`;
    const { error: uploadError } = await supabase.storage.from("avatars").upload(path, file, { upsert: true });
    if (uploadError) { setMessage(uploadError.message); setLoading(false); return; }
    const publicUrl = supabase.storage.from("avatars").getPublicUrl(path).data.publicUrl;
    await saveAvatar(publicUrl);
  }

  if (!authReady) return <main className="min-h-screen bg-[#050505]" aria-label="Loading account" />;

  if (userEmail) return <main className="min-h-screen bg-[#050505] text-white">
    <StudioSidebar />
    <aside className="hidden">
      <p className="text-[11px] font-black tracking-[0.2em] text-[#FFDF00]">CARABASAI STUDIO</p>
      <nav className="mt-6 grid gap-2">
        <Link href="/studio" className="flex h-11 items-center justify-between rounded-xl border border-white/10 bg-white/[0.025] px-4 text-[10px] font-black tracking-[0.12em] text-white/65">STUDIO HOME <span className="text-[#FFDF00]">⌂</span></Link>
        <Link href="/account" className="flex h-11 items-center justify-between rounded-xl bg-[#FFDF00] px-4 text-[10px] font-black tracking-[0.12em] text-black">MY ACCOUNT <span>○</span></Link>
        <a href="mailto:info@carabasai.com" className="flex h-11 items-center justify-between rounded-xl border border-white/10 bg-white/[0.025] px-4 text-[10px] font-black tracking-[0.12em] text-white/65">HELP DESK <span className="text-[#FFDF00]">?</span></a>
      </nav>
      <div className="mt-auto hidden border-t border-white/10 pt-4 md:block">
        <button type="button" onClick={() => setHistoryOpen((current) => !current)} className="flex w-full items-center justify-between py-2 text-[9px] font-black tracking-[0.14em] text-[#FFDF00]">SESSION HISTORY <span>{historyOpen ? "−" : "+"}</span></button>
        {historyOpen && <div className="mt-2 max-h-40 space-y-2 overflow-y-auto">{accountSessions.length ? accountSessions.map((session) => <Link key={session.id ?? session.startedAt ?? session.notes} href="/studio" className="block truncate rounded-lg border border-white/8 bg-white/[0.02] px-3 py-2 text-[9px] text-white/45">{session.title || session.notes || "UNTITLED SESSION"}</Link>) : <p className="py-2 text-[8px] leading-4 text-white/20">YOUR SAVED SESSIONS WILL APPEAR HERE.</p>}</div>}
      </div>
      <div className="hidden">
        <div className="flex items-center gap-3 px-2">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full border border-[#FFDF00]/30 bg-black/40 text-sm">{avatarUrl.startsWith("http") ? <img src={avatarUrl} alt="Avatar" className="h-full w-full object-cover" /> : avatarUrl || name.charAt(0).toUpperCase() || "A"}</div>
          <div className="hidden min-w-0 md:block"><p className="truncate text-[10px] font-black text-white/80">{name || "Carabasai creator"}</p><p className="mt-1 truncate text-[8px] text-white/30">{userEmail}</p></div>
        </div>
        <button type="button" onClick={signOut} className="mt-4 flex h-10 w-full items-center justify-center rounded-full border border-white/10 text-[9px] font-black text-white/35 hover:border-white/20 hover:text-white/60"><span className="md:hidden">↪</span><span className="hidden md:inline">SIGN OUT</span></button>
      </div>
    </aside>

    <section className="min-h-screen pt-16 md:pl-[var(--studio-sidebar-width,260px)] md:pt-0">
      <div className="mx-auto w-full max-w-[1500px] px-8 py-10 lg:px-14">
        <header><p className="text-[10px] font-black tracking-[0.18em] text-[#FFDF00]">{name || "CREATOR"}</p><h1 className="mt-3 text-3xl font-black tracking-[-0.05em] sm:text-4xl">WELCOME BACK TO YOUR STUDIO.</h1><p className="mt-3 text-sm text-white/35">{accountSessions.length} active {accountSessions.length === 1 ? "project" : "projects"} in your workspace.</p></header>

        <section className="mt-12"><div className="mb-4 flex items-center justify-between"><h2 className="text-sm font-black tracking-[0.08em]">PRODUCTION WALL</h2><button className="rounded-full border border-white/12 px-4 py-2 text-[9px] font-black text-white/50">OPEN WALL ↗</button></div><div className="relative h-[290px] overflow-hidden rounded-[24px] border border-white/10 bg-[url('/studio-bg.jpeg')] bg-cover bg-center"><div className="absolute inset-0 bg-gradient-to-r from-black/70 via-black/25 to-black/60"/><div className="absolute bottom-7 left-7"><p className="text-[10px] font-black tracking-[0.16em] text-[#FFDF00]">YOUR VISUAL WORKSPACE</p><p className="mt-2 max-w-md text-sm text-white/55">Images, videos, references and generated frames will live here.</p></div></div></section>

        <section className="mt-10"><div className="mb-5 flex items-center justify-between"><h2 className="text-sm font-black tracking-[0.08em]">ACTIVE PROJECTS</h2><button type="button" onClick={() => setProjectsOpen(true)} className="text-[10px] font-black text-white/45 hover:text-[#FFDF00]">VIEW ALL PROJECTS →</button></div><div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">{accountSessions.slice(0,4).map((project, index) => { const progress = project.projectDocument ? 70 : project.messages?.length ? 45 : project.notes ? 20 : 10; const image = project.references?.find((item) => item.type?.startsWith("image/"))?.dataUrl; return <Link key={project.id ?? project.startedAt ?? index} href="/studio" className="overflow-hidden rounded-[20px] border border-white/10 bg-[#0B0B0B] transition hover:-translate-y-1 hover:border-[#FFDF00]/30"><div className="h-36 bg-cover bg-center" style={{backgroundImage:`url(${image || "/studio-bg.jpeg"})`}}/><div className="p-5"><p className="text-[8px] font-black tracking-[0.12em] text-[#FFDF00]">IN PROGRESS</p><h3 className="mt-3 truncate text-lg font-black">{project.title || project.notes || "UNTITLED PROJECT"}</h3><div className="mt-5 flex items-center justify-between text-[9px] text-white/35"><span>PRODUCTION</span><span>{progress}%</span></div><div className="mt-2 h-1 overflow-hidden rounded-full bg-white/8"><div className="h-full bg-[#FFDF00]" style={{width:`${progress}%`}}/></div></div></Link>})}{accountSessions.length === 0 && <Link href="/studio" className="col-span-full flex min-h-52 items-center justify-center rounded-[20px] border border-dashed border-white/15 text-[10px] font-black text-white/35 hover:border-[#FFDF00]/35 hover:text-[#FFDF00]">START YOUR FIRST PROJECT +</Link>}</div></section>
        {message && <p className="mt-6 text-[10px] leading-5 text-white/50">{message}</p>}
      </div>
      {projectsOpen && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-6 backdrop-blur-sm"><button aria-label="Close projects" onClick={() => setProjectsOpen(false)} className="absolute inset-0"/><div className="relative max-h-[82vh] w-full max-w-4xl overflow-y-auto rounded-[28px] border border-white/12 bg-[#090909] p-7"><div className="flex items-center justify-between"><h2 className="text-2xl font-black">ALL PROJECTS</h2><button onClick={() => setProjectsOpen(false)} className="h-10 w-10 rounded-full border border-white/10 text-white/50">×</button></div><div className="mt-6 grid gap-3 sm:grid-cols-2">{accountSessions.map((project) => <Link key={project.id ?? project.startedAt ?? project.notes} href="/studio" className="rounded-[16px] border border-white/10 p-5 hover:border-[#FFDF00]/30"><p className="truncate font-black">{project.title || project.notes}</p><p className="mt-2 text-[9px] text-white/30">{project.startedAt ? new Date(project.startedAt).toLocaleString("en-GB") : "ACTIVE PROJECT"}</p></Link>)}</div></div></div>}
    </section>
  </main>;

  if (recoveryMode && !userEmail) return <main className="flex min-h-screen items-center justify-center bg-[#050505] p-5 text-white">{recoverySent && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-5 backdrop-blur-sm"><section role="dialog" aria-modal="true" className="w-full max-w-md rounded-[28px] border border-[#FFDF00]/25 bg-[#0A0A0A] p-7 text-center"><div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-[#FFDF00] text-2xl text-black">✉</div><p className="mt-6 text-[10px] font-black tracking-[0.16em] text-[#FFDF00]">RECOVERY CODE SENT</p><h2 className="mt-3 text-2xl font-black">ENTER THE CODE.</h2><p className="mt-4 text-sm leading-6 text-white/50">We sent a 6-digit code to <span className="font-bold text-white/80">{email}</span>.</p><form onSubmit={verifyRecoveryCode} className="mt-6"><input type="text" inputMode="numeric" autoComplete="one-time-code" maxLength={6} required value={recoveryCode} onChange={(event) => setRecoveryCode(event.target.value.replace(/\D/g, "").slice(0, 6))} placeholder="000000" className="h-16 w-full rounded-[16px] border border-white/15 bg-black/40 text-center text-2xl font-black tracking-[0.35em] outline-none focus:border-[#FFDF00]/60" /><button disabled={loading || recoveryCode.length !== 6} className="mt-4 h-12 w-full rounded-full bg-[#FFDF00] text-[10px] font-black text-black disabled:opacity-30">{loading ? "CHECKING CODE..." : "VERIFY CODE"}</button></form>{message && <p className="mt-4 text-[10px] leading-5 text-white/55">{message}</p>}<button type="button" disabled={recoveryCooldown > 0 || loading} onClick={() => { setRecoverySent(false); setRecoveryCode(""); setMessage(""); }} className="mt-4 h-10 w-full rounded-full border border-white/10 text-[9px] font-black text-white/45 disabled:opacity-25">{recoveryCooldown > 0 ? `NEW CODE IN ${recoveryCooldown}s` : "REQUEST ANOTHER CODE"}</button><button type="button" onClick={() => { setRecoverySent(false); setRecoveryCode(""); setMessage(""); }} className="mt-5 text-[10px] font-black text-white/45 hover:text-[#FFDF00]">← BACK</button></section></div>}<section className="w-full max-w-md rounded-[28px] border border-white/10 bg-white/[0.025] p-6 sm:p-8"><p className="text-[10px] font-black tracking-[0.18em] text-[#FFDF00]">PASSWORD RECOVERY</p><h1 className="mt-4 text-3xl font-black">RESET YOUR PASSWORD.</h1><p className="mt-4 text-sm leading-6 text-white/40">We will send a 6-digit recovery code to your email.</p><form onSubmit={sendRecovery} className="mt-7 space-y-3"><input type="email" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="EMAIL" autoComplete="email" className="h-14 w-full rounded-[14px] border border-white/10 bg-black/30 px-4 text-sm outline-none focus:border-[#FFDF00]/50" /><TurnstileWidget key={`recovery-${captchaVersion}`} onToken={setCaptchaToken} /><button disabled={loading || !captchaToken || recoveryCooldown > 0} className="h-12 w-full rounded-full bg-[#FFDF00] text-[10px] font-black text-black disabled:opacity-30">{loading ? "PLEASE WAIT..." : recoveryCooldown > 0 ? `NEW CODE IN ${recoveryCooldown}s` : !captchaToken ? "COMPLETE SECURITY CHECK" : "SEND RECOVERY CODE"}</button></form>{message && <p className="mt-5 text-[10px] leading-5 text-white/55">{message}</p>}<button type="button" onClick={() => { setRecoveryMode(false); setCaptchaToken(""); setMessage(""); setRecoveryCode(""); }} className="mt-7 text-[10px] font-black text-white/40">← BACK TO SIGN IN</button></section></main>;

  return <main className="flex min-h-screen items-center justify-center bg-[#050505] p-5 text-white">{awaitingConfirmation && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-5 backdrop-blur-sm"><section role="dialog" aria-modal="true" className="w-full max-w-md rounded-[28px] border border-[#FFDF00]/25 bg-[#0A0A0A] p-7 text-center shadow-2xl"><div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-[#FFDF00] text-2xl text-black">✉</div><p className="mt-6 text-[10px] font-black tracking-[0.16em] text-[#FFDF00]">CONFIRM YOUR EMAIL</p><h2 className="mt-3 text-2xl font-black">CHECK YOUR INBOX.</h2><p className="mt-4 text-sm leading-6 text-white/50">We sent a confirmation link to <span className="font-bold text-white/80">{email}</span>. Open the email and follow the link to activate your account.</p><p className="mt-4 text-[10px] leading-5 text-white/30">If this email already has an account, sign in or use password recovery instead.</p><button type="button" onClick={() => { setAwaitingConfirmation(false); setMode("sign-in"); }} className="mt-7 h-11 w-full rounded-full border border-white/15 text-[10px] font-black text-white/65">BACK TO SIGN IN</button></section></div>}<section className="w-full max-w-md rounded-[28px] border border-white/10 bg-white/[0.025] p-6 sm:p-8">
    <p className="text-[10px] font-black tracking-[0.18em] text-[#FFDF00]">CARABASAI ACCOUNT</p>
    <h1 className="mt-4 text-3xl font-black tracking-[-0.04em]">{mode === "sign-up" ? "CREATE YOUR ACCOUNT." : "WELCOME BACK."}</h1>
    <p className="mt-4 text-sm leading-6 text-white/40">Keep sessions, references, generated images and video outside this browser.</p>
    {userEmail ? <div className="mt-8 rounded-[18px] border border-[#FFDF00]/20 bg-[#FFDF00]/5 p-5"><div className="flex items-center gap-4"><div className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-full border border-[#FFDF00]/35 bg-black/40 text-2xl">{avatarUrl.startsWith("http") ? <img src={avatarUrl} alt="Avatar" className="h-full w-full object-cover" /> : avatarUrl || name.charAt(0).toUpperCase() || "A"}</div><div><p className="text-[9px] font-black tracking-[0.14em] text-[#FFDF00]">CONNECTED</p><p className="mt-1 text-base font-black text-white/85">{name || "Carabasai creator"}</p><p className="mt-1 text-xs text-white/45">{userEmail}</p></div></div><p className="mt-6 text-[9px] font-black tracking-[0.12em] text-white/35">CHOOSE AVATAR</p><div className="mt-3 grid grid-cols-6 gap-2">{presetAvatars.map((avatar) => <button key={avatar} type="button" onClick={() => saveAvatar(avatar)} className="aspect-square rounded-full border border-white/10 bg-black/30 text-lg hover:border-[#FFDF00]/50">{avatar}</button>)}</div><label className="mt-4 flex cursor-pointer items-center justify-center rounded-full border border-white/15 px-5 py-3 text-[10px] font-black hover:border-[#FFDF00]/40"><input type="file" accept="image/*" onChange={uploadAvatar} className="hidden" />UPLOAD YOUR IMAGE</label><button type="button" onClick={signOut} className="mt-3 w-full rounded-full border border-white/10 px-5 py-3 text-[10px] font-black text-white/45">SIGN OUT</button></div> : <>
      <div className="mt-7 grid grid-cols-2 rounded-full border border-white/10 bg-black/25 p-1"><button type="button" onClick={() => changeMode("sign-in")} className={`rounded-full py-2.5 text-[9px] font-black ${mode === "sign-in" ? "bg-[#FFDF00] text-black" : "text-white/35"}`}>SIGN IN</button><button type="button" onClick={() => changeMode("sign-up")} className={`rounded-full py-2.5 text-[9px] font-black ${mode === "sign-up" ? "bg-[#FFDF00] text-black" : "text-white/35"}`}>CREATE ACCOUNT</button></div>
      <form onSubmit={authenticate} className="mt-5 space-y-3">
        {mode === "sign-up" && <input type="text" required value={name} onChange={(event) => setName(event.target.value)} placeholder="YOUR NAME" autoComplete="name" className="h-14 w-full rounded-[14px] border border-white/10 bg-black/30 px-4 text-sm outline-none focus:border-[#FFDF00]/50" />}
        <input type="email" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="EMAIL" autoComplete="email" className="h-14 w-full rounded-[14px] border border-white/10 bg-black/30 px-4 text-sm outline-none focus:border-[#FFDF00]/50" />
        <input type="password" required minLength={8} value={password} onChange={(event) => setPassword(event.target.value)} placeholder="PASSWORD" autoComplete={mode === "sign-up" ? "new-password" : "current-password"} className="h-14 w-full rounded-[14px] border border-white/10 bg-black/30 px-4 text-sm outline-none focus:border-[#FFDF00]/50" />
        {mode === "sign-up" && <input type="password" required minLength={8} value={passwordConfirmation} onChange={(event) => setPasswordConfirmation(event.target.value)} placeholder="REPEAT PASSWORD" autoComplete="new-password" className="h-14 w-full rounded-[14px] border border-white/10 bg-black/30 px-4 text-sm outline-none focus:border-[#FFDF00]/50" />}
        {mode === "sign-up" && <label className="flex cursor-pointer items-start gap-3 py-2 text-[10px] leading-5 text-white/45"><input type="checkbox" checked={accepted} onChange={(event) => setAccepted(event.target.checked)} className="mt-1 accent-[#FFDF00]" /><span>By registering, you agree to the <Link href="/terms" target="_blank" className="text-white/75 underline">Terms of Use</Link> and <Link href="/privacy" target="_blank" className="text-white/75 underline">Privacy Policy</Link>.</span></label>}
        <TurnstileWidget key={`${mode}-${captchaVersion}`} onToken={(token) => { setCaptchaToken(token); if (token) setMessage(""); }} />
        <button type="submit" disabled={loading || !captchaToken} className="h-12 w-full rounded-full bg-[#FFDF00] text-[10px] font-black text-black disabled:cursor-not-allowed disabled:opacity-30">{loading ? "PLEASE WAIT..." : !captchaToken ? "COMPLETE SECURITY CHECK" : mode === "sign-up" ? "CREATE ACCOUNT" : "SIGN IN"}</button>
      </form>
      <p className="mt-5 text-center text-[10px] text-white/35">{mode === "sign-up" ? "Already have an account? " : "New to Carabasai? "}<button type="button" onClick={() => changeMode(mode === "sign-up" ? "sign-in" : "sign-up")} className="font-black text-[#FFDF00]">{mode === "sign-up" ? "Sign in" : "Create account"}</button></p>
      {mode === "sign-in" && <button type="button" onClick={() => { setCaptchaToken(""); setCaptchaVersion((current) => current + 1); setRecoveryMode(true); setMessage(""); }} className="mt-4 w-full text-center text-[10px] font-black text-white/45 hover:text-[#FFDF00]">FORGOT PASSWORD?</button>}
    </>}
    {message && <p className="mt-5 text-[10px] leading-5 text-white/50">{message}</p>}
    <Link href="/studio" className="mt-8 inline-flex text-[10px] font-black text-white/35 hover:text-[#FFDF00]">← BACK TO STUDIO</Link>
  </section></main>;
}
