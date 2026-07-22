"use client";

import Link from "next/link";
import { useState } from "react";
import { createClient } from "../../../lib/supabase/client";

export default function AccountDataPage() {
  const [confirmation, setConfirmation] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");

  async function deleteAccount() {
    if (confirmation !== "DELETE") return;
    setDeleting(true); setError("");
    const response = await fetch("/api/account/delete", { method: "DELETE" });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) { setError(result.error ?? "Account deletion failed."); setDeleting(false); return; }
    await createClient().auth.signOut();
    ["carabasaiSessionHistory", "carabasaiActiveProjectId", "carabasaiPendingProjectSync"].forEach((key) => localStorage.removeItem(key));
    window.location.assign("/account");
  }

  return <main className="min-h-screen bg-[#050505] px-5 py-10 text-white sm:px-10">
    <div className="mx-auto max-w-3xl">
      <p className="text-[10px] font-black tracking-[.18em] text-[#FFDF00]">MY ACCOUNT · PRIVACY</p>
      <h1 className="mt-4 text-4xl font-black">YOUR DATA.</h1>
      <p className="mt-4 max-w-2xl text-sm leading-6 text-white/45">Download a machine-readable copy of your account and project records, or permanently delete the account and its private project media.</p>

      <section className="mt-10 bg-[#0D0D0D] p-6 sm:p-8">
        <h2 className="text-xl font-black">Download your data</h2>
        <p className="mt-3 text-sm leading-6 text-white/45">The JSON export contains your profile, projects, screenplay messages, notebook entries, generation records and media metadata. It does not contain passwords or API keys.</p>
        <a href="/api/account/export" className="mt-6 inline-flex bg-[#FFDF00] px-6 py-3 text-[10px] font-black text-black">DOWNLOAD JSON EXPORT</a>
      </section>

      <section className="mt-6 bg-red-950/20 p-6 sm:p-8">
        <h2 className="text-xl font-black text-red-200">Delete your account</h2>
        <p className="mt-3 text-sm leading-6 text-white/45">This permanently removes your login, projects, messages, notebook records and stored project media. Provider backups may retain encrypted technical copies for their normal backup cycle, after which they expire.</p>
        <label className="mt-6 block text-[9px] font-black tracking-[.15em] text-white/40">TYPE DELETE TO CONFIRM</label>
        <input value={confirmation} onChange={(event) => setConfirmation(event.target.value)} className="mt-2 w-full bg-black px-4 py-3 text-sm outline-none ring-1 ring-white/10 focus:ring-red-300/50" />
        {error && <p className="mt-3 text-xs text-red-300">{error}</p>}
        <button type="button" disabled={confirmation !== "DELETE" || deleting} onClick={() => void deleteAccount()} className="mt-5 bg-red-400 px-6 py-3 text-[10px] font-black text-black disabled:cursor-not-allowed disabled:opacity-25">{deleting ? "DELETING..." : "DELETE ACCOUNT PERMANENTLY"}</button>
      </section>
      <div className="mt-8 flex gap-6 text-[10px] font-black"><Link href="/account" className="text-[#FFDF00]">← BACK TO ACCOUNT</Link><Link href="/privacy" className="text-white/40">PRIVACY POLICY</Link></div>
    </div>
  </main>;
}
