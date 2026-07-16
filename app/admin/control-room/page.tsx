import Link from "next/link";
import { requireAdmin } from "../../../lib/admin-access";

export const dynamic = "force-dynamic";

type State = "online" | "configured" | "attention" | "offline";
type Service = {
  name: string; purpose: string; state: State; status: string; detail: string;
  model?: string; usage?: string; cost?: string; href: string;
};

async function checkEndpoint(url: string, init: RequestInit) {
  try {
    const response = await fetch(url, { ...init, cache: "no-store", signal: AbortSignal.timeout(5000) });
    return response.ok;
  } catch { return false; }
}

function bytes(value: number) {
  if (!value) return "0 MB";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
  return `${(value / 1024 ** index).toFixed(index > 1 ? 1 : 0)} ${units[index]}`;
}

export default async function AdminControlRoom() {
  const { user, supabase } = await requireAdmin();
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  const [projectsResult, messagesResult, notebookResult, mediaResult, usageResult, openAiOnline, anthropicOnline, cloudflareOnline] = await Promise.all([
    supabase.from("projects").select("id,stage,ai_provider,created_at", { count: "exact" }),
    supabase.from("messages").select("id", { count: "exact", head: true }),
    supabase.from("notebook_items").select("id", { count: "exact", head: true }),
    supabase.from("media_assets").select("size_bytes,kind"),
    supabase.from("ai_usage_buckets").select("request_count").eq("bucket_kind", "day").gte("bucket_start", today.toISOString()),
    process.env.OPENAI_API_KEY
      ? checkEndpoint("https://api.openai.com/v1/models", { headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` } })
      : Promise.resolve(false),
    process.env.ANTHROPIC_API_KEY
      ? checkEndpoint("https://api.anthropic.com/v1/models", { headers: { "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" } })
      : Promise.resolve(false),
    process.env.CLOUDFLARE_API_TOKEN
      ? checkEndpoint("https://api.cloudflare.com/client/v4/user/tokens/verify", { headers: { Authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}` } })
      : Promise.resolve(false),
  ]);

  const projects = projectsResult.data ?? [];
  const media = mediaResult.data ?? [];
  const totalMediaBytes = media.reduce((sum, item) => sum + Number(item.size_bytes ?? 0), 0);
  const aiRequestsToday = (usageResult.data ?? []).reduce((sum, item) => sum + Number(item.request_count ?? 0), 0);
  const stages = projects.reduce<Record<string, number>>((acc, project) => {
    acc[project.stage] = (acc[project.stage] ?? 0) + 1; return acc;
  }, {});
  const providerCounts = projects.reduce<Record<string, number>>((acc, project) => {
    acc[project.ai_provider] = (acc[project.ai_provider] ?? 0) + 1; return acc;
  }, {});

  const services: Service[] = [
    {
      name: "Anthropic", purpose: "Claude creative agents",
      state: anthropicOnline ? "online" : process.env.ANTHROPIC_API_KEY ? "attention" : "offline",
      status: anthropicOnline ? "Connected" : "Check connection", detail: "Agent dialogue and project development.",
      model: process.env.ANTHROPIC_MODEL ?? "Provider default", usage: `${providerCounts.anthropic ?? 0} projects`,
      cost: process.env.ANTHROPIC_ADMIN_API_KEY ? "Cost API ready" : "Admin usage key needed",
      href: "https://console.anthropic.com/settings/billing",
    },
    {
      name: "OpenAI", purpose: "GPT creative agents",
      state: openAiOnline ? "online" : process.env.OPENAI_API_KEY ? "attention" : "offline",
      status: openAiOnline ? "Connected" : "Check connection", detail: "Alternative dialogue and document provider.",
      model: process.env.OPENAI_MODEL ?? "Provider default", usage: `${providerCounts.openai ?? 0} projects`,
      cost: process.env.OPENAI_ADMIN_KEY ? "Cost API ready" : "Organization admin key needed",
      href: "https://platform.openai.com/usage",
    },
    {
      name: "Cloudflare Workers AI", purpose: "Project cover generation",
      state: cloudflareOnline ? "online" : process.env.CLOUDFLARE_API_TOKEN ? "attention" : "offline",
      status: cloudflareOnline ? "Connected" : "Check token", detail: "Text-free cinematic covers in 21:9.",
      model: "FLUX.2 Dev", usage: "10,000 free neurons / day", cost: "Overage: $0.011 / 1K neurons",
      href: "https://dash.cloudflare.com/?to=/:account/ai/workers-ai",
    },
    {
      name: "Supabase", purpose: "Auth, database and private media",
      state: projectsResult.error ? "attention" : "online", status: projectsResult.error ? "Database check failed" : "Connected",
      detail: "Users, sessions, project documents and assets.", usage: `${projects.length} projects · ${bytes(totalMediaBytes)}`,
      cost: "Billing managed in Supabase", href: "https://supabase.com/dashboard",
    },
    {
      name: "Vercel", purpose: "Production hosting and deployments",
      state: process.env.VERCEL ? "online" : "configured", status: process.env.VERCEL ? "Production online" : "Local environment",
      detail: "Next.js hosting for studio.carabasai.com.", usage: process.env.VERCEL_ENV ?? "Local",
      cost: process.env.VERCEL_TOKEN ? "Usage API ready" : "Vercel token needed for costs",
      href: "https://vercel.com/carabasai/carabasai-wq8s",
    },
    {
      name: "Cloudflare Turnstile", purpose: "Bot protection",
      state: process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ? "online" : "offline",
      status: process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ? "Connected" : "Not configured",
      detail: "Protects account registration and recovery.", usage: "Managed challenge", cost: "Free",
      href: "https://dash.cloudflare.com/?to=/:account/turnstile",
    },
    {
      name: "GoDaddy", purpose: "Domain and business email", state: "configured", status: "Manual billing",
      detail: "carabasai.com, studio subdomain and mail aliases.", usage: "studio.carabasai.com",
      cost: "Renewal visible at registrar", href: "https://account.godaddy.com/products",
    },
  ];

  const onlineServices = services.filter((service) => service.state === "online").length;
  const projectMaximum = Math.max(1, ...Object.values(stages));
  const stats: [string, string | number][] = [
    ["PROJECTS", projects.length], ["MESSAGES", messagesResult.count ?? 0], ["NOTEBOOK ITEMS", notebookResult.count ?? 0],
    ["MEDIA", bytes(totalMediaBytes)], ["AI REQUESTS TODAY", `${aiRequestsToday}/40`],
  ];

  return (
    <main className="min-h-screen bg-[#050505] text-white">
      <div className="mx-auto max-w-[1600px] px-5 py-8 sm:px-10 lg:px-14">
        <header className="flex flex-col gap-6 border-b border-white/10 pb-8 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-[10px] font-black tracking-[0.28em] text-[#FFDF00]">CARABASAI · PRIVATE ADMIN</p>
            <h1 className="mt-4 text-4xl font-black tracking-[-0.05em] sm:text-6xl">CONTROL ROOM.</h1>
            <p className="mt-3 max-w-2xl text-sm text-white/40">Infrastructure, AI usage and production health for {user.email}.</p>
          </div>
          <div className="flex items-center gap-3">
            <span className="rounded-full border border-emerald-400/25 bg-emerald-400/10 px-4 py-2 text-[10px] font-black tracking-[0.16em] text-emerald-300">{onlineServices}/{services.length} LIVE</span>
            <Link href="/account" className="rounded-full border border-white/15 px-4 py-2 text-[10px] font-black tracking-[0.16em] text-white/55 hover:text-white">EXIT ADMIN</Link>
          </div>
        </header>

        <section className="grid gap-3 py-8 sm:grid-cols-2 xl:grid-cols-5">
          {stats.map(([label, value]) => (
            <div key={label} className="rounded-2xl border border-white/10 bg-[#0B0B0B] p-5">
              <p className="text-[9px] font-black tracking-[0.18em] text-white/35">{label}</p>
              <p className="mt-3 text-3xl font-black tracking-[-0.04em]">{value}</p>
            </div>
          ))}
        </section>

        <section className="grid gap-6 xl:grid-cols-[1.7fr_1fr]">
          <div>
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-sm font-black tracking-[0.14em]">CONNECTED SERVICES</h2>
              <p className="text-[10px] text-white/30">Keys are never exposed in this interface</p>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              {services.map((service) => (
                <article key={service.name} className="rounded-3xl border border-white/10 bg-[#0A0A0A] p-6 transition hover:border-[#FFDF00]/30">
                  <div className="flex items-start justify-between gap-4">
                    <div><p className="text-[9px] font-black tracking-[0.17em] text-[#FFDF00]">{service.purpose.toUpperCase()}</p><h3 className="mt-2 text-xl font-black">{service.name}</h3></div>
                    <span className={`mt-1 h-2.5 w-2.5 rounded-full ${service.state === "online" ? "bg-emerald-400 shadow-[0_0_16px_#34d399]" : service.state === "attention" ? "bg-orange-400" : service.state === "configured" ? "bg-[#FFDF00]" : "bg-red-500"}`} />
                  </div>
                  <p className="mt-4 min-h-10 text-xs leading-5 text-white/40">{service.detail}</p>
                  <dl className="mt-5 space-y-3 border-t border-white/10 pt-5 text-[11px]">
                    <div className="flex justify-between gap-4"><dt className="text-white/30">Status</dt><dd className="text-right font-bold">{service.status}</dd></div>
                    {service.model && <div className="flex justify-between gap-4"><dt className="text-white/30">Model</dt><dd className="text-right font-bold">{service.model}</dd></div>}
                    {service.usage && <div className="flex justify-between gap-4"><dt className="text-white/30">Usage</dt><dd className="text-right font-bold">{service.usage}</dd></div>}
                    {service.cost && <div className="flex justify-between gap-4"><dt className="text-white/30">Billing</dt><dd className="text-right font-bold">{service.cost}</dd></div>}
                  </dl>
                  <a href={service.href} target="_blank" rel="noreferrer" className="mt-5 flex items-center justify-between rounded-xl border border-white/10 px-4 py-3 text-[9px] font-black tracking-[0.14em] text-white/45 hover:border-[#FFDF00]/40 hover:text-[#FFDF00]">OPEN SERVICE <span>↗</span></a>
                </article>
              ))}
            </div>
          </div>

          <aside className="space-y-6">
            <section className="rounded-3xl border border-white/10 bg-[#0A0A0A] p-6">
              <p className="text-[9px] font-black tracking-[0.17em] text-[#FFDF00]">PRODUCTION PIPELINE</p>
              <h2 className="mt-2 text-xl font-black">Project stages</h2>
              <div className="mt-6 space-y-5">
                {["crew", "dialogue", "summary", "production"].map((stage) => {
                  const count = stages[stage] ?? 0;
                  return <div key={stage}><div className="mb-2 flex justify-between text-[10px] font-black tracking-[0.12em]"><span className="text-white/45">{stage.toUpperCase()}</span><span>{count}</span></div><div className="h-1.5 overflow-hidden rounded-full bg-white/10"><div className="h-full rounded-full bg-[#FFDF00]" style={{ width: `${(count / projectMaximum) * 100}%` }} /></div></div>;
                })}
              </div>
            </section>
            <section className="rounded-3xl border border-[#FFDF00]/20 bg-[#FFDF00]/[0.035] p-6">
              <p className="text-[9px] font-black tracking-[0.17em] text-[#FFDF00]">FINANCIAL VISIBILITY</p>
              <h2 className="mt-2 text-xl font-black">Next connections</h2>
              <p className="mt-3 text-xs leading-5 text-white/40">Add provider admin keys to Vercel to display real monthly costs. Ordinary generation keys intentionally cannot read organization billing.</p>
              <div className="mt-5 space-y-2 text-[10px] font-bold text-white/55"><p>ANTHROPIC_ADMIN_API_KEY</p><p>OPENAI_ADMIN_KEY</p><p>VERCEL_TOKEN</p></div>
            </section>
          </aside>
        </section>
        <footer className="mt-10 border-t border-white/10 py-6 text-[9px] tracking-[0.12em] text-white/20">LAST SERVER CHECK · {new Date().toLocaleString("en-GB", { timeZone: "Europe/Berlin" })} CET · {media.length} MEDIA RECORDS</footer>
      </div>
    </main>
  );
}
