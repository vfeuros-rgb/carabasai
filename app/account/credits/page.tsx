import { redirect } from "next/navigation";
import StudioSidebar from "../../components/StudioSidebar";
import { createClient } from "../../../lib/supabase/server";

export default async function CreditsPage() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) redirect("/account?mode=sign-in");
  return <main className="min-h-screen bg-[#050505] text-white"><StudioSidebar /><section className="min-h-screen pt-16 md:pl-[var(--studio-sidebar-width,260px)] md:pt-0"><div className="mx-auto max-w-5xl px-5 py-10 sm:px-10"><p className="text-[10px] font-black tracking-[0.2em] text-[#FFDF00]">STUDIO CREDITS</p><h1 className="mt-4 text-4xl font-black sm:text-6xl">BUY CREDITS.</h1><div className="mt-10 rounded-[28px] border border-white/10 bg-[#0A0A0A] p-8"><p className="text-xl font-black">Credit purchases are not active yet.</p><p className="mt-3 text-sm text-white/35">Packages, payment processing and usage accounting will be added before launch.</p><button disabled className="mt-6 rounded-full bg-[#FFDF00] px-6 py-3 text-[10px] font-black text-black opacity-35">BUY CREDITS</button></div></div></section></main>;
}
