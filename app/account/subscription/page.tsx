import { redirect } from "next/navigation";
import StudioSidebar from "../../components/StudioSidebar";
import { createClient } from "../../../lib/supabase/server";

export default async function SubscriptionPage() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) redirect("/account?mode=sign-in");
  return <main className="min-h-screen bg-[#050505] text-white"><StudioSidebar /><section className="min-h-screen pt-16 md:pl-[var(--studio-sidebar-width,260px)] md:pt-0"><div className="mx-auto max-w-5xl px-5 py-10 sm:px-10"><p className="text-[10px] font-black tracking-[0.2em] text-[#FFDF00]">MEMBERSHIP</p><h1 className="mt-4 text-4xl font-black sm:text-6xl">SUBSCRIPTION.</h1><div className="mt-10 rounded-[28px] border border-white/10 bg-[#0A0A0A] p-8"><p className="text-xl font-black">Creator account</p><p className="mt-3 text-sm text-white/35">Subscription plans will be connected before public launch. Your current account remains active.</p><span className="mt-6 inline-flex rounded-full border border-[#FFDF00]/25 px-4 py-2 text-[9px] font-black tracking-[0.14em] text-[#FFDF00]">COMING LATER</span></div></div></section></main>;
}
