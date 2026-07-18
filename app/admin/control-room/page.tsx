import Link from "next/link";
import { requireAdmin } from "../../../lib/admin-access";

export const dynamic = "force-dynamic";

type State = "online" | "configured" | "attention" | "offline";
type Service = {
  name: string; purpose: string; state: State; status: string; detail: string;
  model?: string; usage?: string; cost?: string; href: string;
  launchPlan: "keep" | "upgrade";
  launchNote: string;
};

type BillingItem = {
  name: string; purpose: string; cadence: "monthly" | "annual" | "usage" | "free";
  monthlyUsd: number; annualUsd: number; allowance: string; consumed: string; remaining: string;
  source: "live" | "estimated" | "manual"; href: string;
};

async function exchangeRates() {
  const fallback = { usdPerEur: 1.1405, rubPerEur: 88.9097, asOf: "16 Jul 2026" };
  try {
    const [ecb, cbr] = await Promise.all([
      fetch("https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml", { next: { revalidate: 21600 } }).then((response) => response.text()),
      fetch("https://www.cbr.ru/scripts/XML_daily.asp", { next: { revalidate: 21600 } }).then((response) => response.text()),
    ]);
    const usd = Number(ecb.match(/currency=['\"]USD['\"] rate=['\"]([0-9.]+)['\"]/)?.[1]);
    const eurBlock = cbr.match(/<Valute[^>]*>\s*<NumCode>978<\/NumCode>[\s\S]*?<\/Valute>/)?.[0] ?? "";
    const nominal = Number(eurBlock.match(/<Nominal>([0-9]+)<\/Nominal>/)?.[1] ?? 1);
    const rub = Number((eurBlock.match(/<Value>([0-9,]+)<\/Value>/)?.[1] ?? "").replace(",", ".")) / nominal;
    return { usdPerEur: usd > 0 ? usd : fallback.usdPerEur, rubPerEur: rub > 0 ? rub : fallback.rubPerEur, asOf: new Date().toLocaleDateString("en-GB", { timeZone: "Europe/Berlin" }) };
  } catch {
    return fallback;
  }
}

function envMoney(name: string, fallback = 0) {
  const value = Number(process.env[name] ?? fallback);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

function money(value: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: value % 1 ? 2 : 0 }).format(value);
}

function euro(value: number) {
  return new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(value);
}

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
  const rates = await exchangeRates();
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  const [projectsResult, messagesResult, notebookResult, mediaResult, usageResult, openAiOnline, anthropicOnline, cloudflareOnline] = await Promise.all([
    supabase.from("projects").select("id,stage,ai_provider,created_at,project_document", { count: "exact" }),
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

  const now = new Date();
  const currentMonth = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  const currentDay = now.toISOString().slice(0, 10);
  const generatedCovers = projects.filter((project) => {
    const document = project.project_document as { carabasai_session?: { coverModel?: string; coverPath?: string } } | null;
    return Boolean(document?.carabasai_session?.coverModel || document?.carabasai_session?.coverPath);
  });
  const coversThisMonth = generatedCovers.filter((project) => String(project.created_at).startsWith(currentMonth)).length;
  const coversToday = generatedCovers.filter((project) => String(project.created_at).startsWith(currentDay)).length;
  const estimatedNeuronsToday = coversToday * 3000;
  const estimatedNeuronsRemaining = Math.max(0, 10_000 - estimatedNeuronsToday);

  const cloudflareBaseMonthly = envMoney("CLOUDFLARE_WORKERS_MONTHLY_USD", 5);
  const cloudflareUsageMonth = envMoney("CLOUDFLARE_AI_USAGE_MONTH_USD");
  const anthropicUsageMonth = envMoney("ANTHROPIC_USAGE_MONTH_USD", 5);
  const openAiUsageMonth = envMoney("OPENAI_USAGE_MONTH_USD", 5);
  const chatGptPlusMonthlyEur = envMoney("CHATGPT_PLUS_MONTHLY_EUR", 23.58);
  const chatGptPlusMonthlyUsd = chatGptPlusMonthlyEur * rates.usdPerEur;
  const supabaseMonthly = envMoney("SUPABASE_MONTHLY_USD");
  const vercelMonthly = envMoney("VERCEL_MONTHLY_USD", 24.40);
  const godaddyAnnualEur = envMoney("GODADDY_CARABASAI_ANNUAL_EUR", 21.99) + envMoney("GODADDY_FLORIANI_ANNUAL_EUR", 21.99);
  const tildaAnnualRub = envMoney("TILDA_BUSINESS_ANNUAL_RUB", 12_000);
  const godaddyAnnual = godaddyAnnualEur * rates.usdPerEur;
  const tildaAnnualUsd = (tildaAnnualRub / rates.rubPerEur) * rates.usdPerEur;
  const billing: BillingItem[] = [
    { name: "Cloudflare Workers AI", purpose: "Project cover generation", cadence: "monthly", monthlyUsd: cloudflareBaseMonthly + cloudflareUsageMonth, annualUsd: (cloudflareBaseMonthly + cloudflareUsageMonth) * 12, allowance: "10,000 neurons / day included", consumed: `≈ ${estimatedNeuronsToday.toLocaleString("en-US")} neurons today · ${coversThisMonth} covers this month`, remaining: `≈ ${estimatedNeuronsRemaining.toLocaleString("en-US")} neurons today`, source: "estimated", href: "https://dash.cloudflare.com/?to=/:account/ai/workers-ai" },
    { name: "Anthropic", purpose: "Claude dialogue and documents", cadence: "usage", monthlyUsd: anthropicUsageMonth, annualUsd: anthropicUsageMonth * 12, allowance: "Usage-based API", consumed: `${providerCounts.anthropic ?? 0} projects · ${money(anthropicUsageMonth)} entered`, remaining: "Balance needs an Admin API connection", source: anthropicUsageMonth ? "manual" : "estimated", href: "https://console.anthropic.com/settings/billing" },
    { name: "OpenAI API", purpose: "GPT dialogue and documents", cadence: "usage", monthlyUsd: openAiUsageMonth, annualUsd: openAiUsageMonth * 12, allowance: "Prepaid / usage-based API", consumed: `${providerCounts.openai ?? 0} projects · ${money(openAiUsageMonth)} entered`, remaining: "Balance needs an organization Admin key", source: openAiUsageMonth ? "manual" : "estimated", href: "https://platform.openai.com/usage" },
    { name: "ChatGPT Plus", purpose: "Personal ChatGPT subscription", cadence: "monthly", monthlyUsd: chatGptPlusMonthlyUsd, annualUsd: chatGptPlusMonthlyUsd * 12, allowance: "Personal subscription · separate from the OpenAI API", consumed: `${euro(chatGptPlusMonthlyEur)} / month`, remaining: `${euro(chatGptPlusMonthlyEur * 12)} / year projection`, source: "manual", href: "https://chatgpt.com/#settings/Subscription" },
    { name: "Supabase", purpose: "Auth, database and media", cadence: supabaseMonthly ? "monthly" : "free", monthlyUsd: supabaseMonthly, annualUsd: supabaseMonthly * 12, allowance: supabaseMonthly ? "Paid plan" : "Free development plan", consumed: `${projects.length} projects · ${bytes(totalMediaBytes)}`, remaining: "Exact quotas in Supabase Usage", source: "manual", href: "https://supabase.com/dashboard" },
    { name: "Vercel Pro", purpose: "Hosting and deployments", cadence: "monthly", monthlyUsd: vercelMonthly, annualUsd: vercelMonthly * 12, allowance: "Pro hosting plan", consumed: "$24.40 paid this month", remaining: "Cancel renewal before the next billing date", source: "manual", href: "https://vercel.com/carabasai/~/settings/billing" },
    { name: "GoDaddy · carabasai.com", purpose: "Carabasai domain and business email", cadence: "annual", monthlyUsd: 21.99 * rates.usdPerEur / 12, annualUsd: 21.99 * rates.usdPerEur, allowance: "Paid through 31 Jan 2027", consumed: "€21.99 / year", remaining: "Renew by 31 Jan 2027", source: "manual", href: "https://account.godaddy.com/products" },
    { name: "GoDaddy · Floriani", purpose: "Other website on the same account", cadence: "annual", monthlyUsd: 21.99 * rates.usdPerEur / 12, annualUsd: 21.99 * rates.usdPerEur, allowance: "Paid through 20 Apr 2027", consumed: "€21.99 / year", remaining: "Renew by 20 Apr 2027", source: "manual", href: "https://account.godaddy.com/products" },
    { name: "Tilda Business", purpose: "Website builder subscription", cadence: "annual", monthlyUsd: tildaAnnualUsd / 12, annualUsd: tildaAnnualUsd, allowance: "Paid through 13 Oct 2027", consumed: "₽12,000 / year", remaining: "Renew by 13 Oct 2027", source: "manual", href: "https://tilda.cc/identity/plan/" },
    { name: "Cloudflare Turnstile", purpose: "Bot protection", cadence: "free", monthlyUsd: 0, annualUsd: 0, allowance: "Free", consumed: "Registration and recovery", remaining: "No subscription payment", source: "live", href: "https://dash.cloudflare.com/?to=/:account/turnstile" },
  ];
  const fixedMonthly = cloudflareBaseMonthly + chatGptPlusMonthlyUsd + supabaseMonthly + vercelMonthly + godaddyAnnual / 12 + tildaAnnualUsd / 12;
  const variableMonthly = cloudflareUsageMonth + anthropicUsageMonth + openAiUsageMonth;
  const monthlyTotal = fixedMonthly + variableMonthly;
  const annualCommitted = cloudflareBaseMonthly * 12 + chatGptPlusMonthlyUsd * 12 + supabaseMonthly * 12 + vercelMonthly * 12 + godaddyAnnual + tildaAnnualUsd;
  const annualProjection = monthlyTotal * 12;
  const monthlyTotalEur = monthlyTotal / rates.usdPerEur;
  const annualProjectionEur = annualProjection / rates.usdPerEur;

  const services: Service[] = [
    {
      name: "Anthropic", purpose: "Claude creative agents",
      state: anthropicOnline ? "online" : process.env.ANTHROPIC_API_KEY ? "attention" : "offline",
      status: anthropicOnline ? "Connected" : "Check connection", detail: "Agent dialogue and project development.",
      model: process.env.ANTHROPIC_MODEL ?? "Provider default", usage: `${providerCounts.anthropic ?? 0} projects`,
      cost: process.env.ANTHROPIC_ADMIN_API_KEY ? "Cost API ready" : "Admin usage key needed",
      launchPlan: "upgrade", launchNote: "Review production limits and billing tier before public launch.",
      href: "https://console.anthropic.com/settings/billing",
    },
    {
      name: "OpenAI", purpose: "GPT creative agents",
      state: openAiOnline ? "online" : process.env.OPENAI_API_KEY ? "attention" : "offline",
      status: openAiOnline ? "Connected" : "Check connection", detail: "Alternative dialogue and document provider.",
      model: process.env.OPENAI_MODEL ?? "Provider default", usage: `${providerCounts.openai ?? 0} projects`,
      cost: process.env.OPENAI_ADMIN_KEY ? "Cost API ready" : "Organization admin key needed",
      launchPlan: "upgrade", launchNote: "Review production limits and billing tier before public launch.",
      href: "https://platform.openai.com/usage",
    },
    {
      name: "Cloudflare Workers AI", purpose: "Project cover generation",
      state: cloudflareOnline ? "online" : process.env.CLOUDFLARE_API_TOKEN ? "attention" : "offline",
      status: cloudflareOnline ? "Connected" : "Check token", detail: "Cinematic project covers in 16:9.",
      model: "FLUX.2 Dev", usage: "10,000 free neurons / day", cost: "Overage: $0.011 / 1K neurons",
      launchPlan: "upgrade", launchNote: "Enable paid usage only when cover generation is opened to users.",
      href: "https://dash.cloudflare.com/?to=/:account/ai/workers-ai",
    },
    {
      name: "Supabase", purpose: "Auth, database and private media",
      state: projectsResult.error ? "attention" : "online", status: projectsResult.error ? "Database check failed" : "Connected",
      detail: "Users, sessions, project documents and assets.", usage: `${projects.length} projects · ${bytes(totalMediaBytes)}`,
      cost: "Billing managed in Supabase", launchPlan: "upgrade",
      launchNote: "Upgrade storage, database and backup limits before accepting public users.",
      href: "https://supabase.com/dashboard",
    },
    {
      name: "Vercel", purpose: "Production hosting and deployments",
      state: process.env.VERCEL ? "online" : "configured", status: process.env.VERCEL ? "Production online" : "Local environment",
      detail: "Next.js hosting for studio.carabasai.com.", usage: process.env.VERCEL_ENV ?? "Local",
      cost: process.env.VERCEL_TOKEN ? "Usage API ready" : "Vercel token needed for costs",
      launchPlan: "upgrade", launchNote: "Move from the personal tier to a production plan before launch.",
      href: "https://vercel.com/carabasai/carabasai-wq8s",
    },
    {
      name: "Cloudflare Turnstile", purpose: "Bot protection",
      state: process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ? "online" : "offline",
      status: process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ? "Connected" : "Not configured",
      detail: "Protects account registration and recovery.", usage: "Managed challenge", cost: "Free",
      launchPlan: "keep", launchNote: "Keep enabled for registration and recovery.",
      href: "https://dash.cloudflare.com/?to=/:account/turnstile",
    },
    {
      name: "GoDaddy", purpose: "Domain and business email", state: "configured", status: "Manual billing",
      detail: "carabasai.com, studio subdomain and mail aliases.", usage: "studio.carabasai.com",
      cost: "Renewal visible at registrar", launchPlan: "keep",
      launchNote: "Keep domain and mailbox active; verify renewal dates before launch.",
      href: "https://account.godaddy.com/products",
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

        <section className="mb-10">
          <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-[9px] font-black tracking-[0.18em] text-[#FFDF00]">FINANCE & USAGE</p>
              <h2 className="mt-2 text-2xl font-black tracking-[-0.03em]">Studio operating costs</h2>
            </div>
            <p className="max-w-xl text-[10px] leading-4 text-white/30">Fixed plans are separated from variable API spend. ESTIMATED and MANUAL values are not provider invoices.</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            {[
              ["FIXED / MONTH", money(fixedMonthly)], ["VARIABLE THIS MONTH", money(variableMonthly)],
              ["TOTAL THIS MONTH", money(monthlyTotal)], ["COMMITTED / YEAR", money(annualCommitted)],
              ["ANNUAL PROJECTION", money(annualProjection)],
            ].map(([label, value]) => (
              <div key={label} className="rounded-2xl border border-[#FFDF00]/15 bg-[#FFDF00]/[0.035] p-5">
                <p className="text-[8px] font-black tracking-[0.16em] text-[#FFDF00]">{label}</p>
                <p className="mt-3 text-2xl font-black">{value}</p>
              </div>
            ))}
          </div>
          <div className="mt-4 grid gap-4 rounded-3xl border border-[#FFDF00]/30 bg-[#FFDF00]/[0.055] p-6 lg:grid-cols-[1fr_auto] lg:items-center">
            <div>
              <p className="text-[9px] font-black tracking-[0.18em] text-[#FFDF00]">ALL SUBSCRIPTIONS · EUR</p>
              <h3 className="mt-2 text-xl font-black">Your complete payment picture</h3>
              <p className="mt-2 text-[10px] leading-5 text-white/40">Vercel Pro $24.40/mo · Cloudflare $5/mo · Claude API $5/mo · OpenAI API $5/mo · ChatGPT Plus €23.58/mo · GoDaddy €43.98/yr · Tilda ₽12,000/yr</p>
              <p className="mt-2 text-[9px] text-white/25">Rate {rates.asOf}: €1 = ${rates.usdPerEur.toFixed(4)} · €1 = ₽{rates.rubPerEur.toFixed(4)}. Provider invoices remain the source of truth.</p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="min-w-36 rounded-2xl border border-white/10 bg-black/25 p-4">
                <p className="text-[8px] font-black tracking-[0.14em] text-white/35">PER MONTH</p>
                <p className="mt-2 text-2xl font-black text-[#FFDF00]">{euro(monthlyTotalEur)}</p>
              </div>
              <div className="min-w-36 rounded-2xl border border-white/10 bg-black/25 p-4">
                <p className="text-[8px] font-black tracking-[0.14em] text-white/35">PER YEAR</p>
                <p className="mt-2 text-2xl font-black text-[#FFDF00]">{euro(annualProjectionEur)}</p>
              </div>
            </div>
          </div>
          <div className="mt-4 overflow-hidden rounded-3xl border border-white/10 bg-[#0A0A0A]">
            <div className="hidden grid-cols-[1.25fr_.8fr_.7fr_.7fr_1.5fr_1.1fr] gap-4 border-b border-white/10 px-6 py-4 text-[8px] font-black tracking-[0.15em] text-white/25 lg:grid">
              <span>SERVICE</span><span>BILLING</span><span>MONTH</span><span>YEAR</span><span>USAGE / ALLOWANCE</span><span>REMAINING</span>
            </div>
            {billing.map((item) => (
              <a key={item.name} href={item.href} target="_blank" rel="noreferrer" className="grid gap-4 border-b border-white/10 px-6 py-5 last:border-0 hover:bg-white/[0.025] lg:grid-cols-[1.25fr_.8fr_.7fr_.7fr_1.5fr_1.1fr]">
                <div><p className="text-sm font-black">{item.name}</p><p className="mt-1 text-[10px] text-white/35">{item.purpose}</p></div>
                <div><p className="text-[8px] text-white/25 lg:hidden">BILLING</p><p className="text-[10px] font-black tracking-[0.12em] text-[#FFDF00]">{item.cadence.toUpperCase()}</p><p className="mt-1 text-[8px] font-bold text-white/25">{item.source.toUpperCase()}</p></div>
                <div><p className="text-[8px] text-white/25 lg:hidden">MONTH</p><p className="text-sm font-black">{money(item.monthlyUsd)}</p></div>
                <div><p className="text-[8px] text-white/25 lg:hidden">YEAR</p><p className="text-sm font-black">{money(item.annualUsd)}</p></div>
                <div><p className="text-[10px] font-bold text-white/60">{item.consumed}</p><p className="mt-1 text-[9px] text-white/30">{item.allowance}</p></div>
                <div><p className="text-[10px] leading-4 text-white/45">{item.remaining}</p></div>
              </a>
            ))}
          </div>
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
                  <div className={`mt-4 rounded-xl border px-3 py-2.5 ${service.launchPlan === "upgrade" ? "border-[#FFDF00]/20 bg-[#FFDF00]/[0.04]" : "border-emerald-400/15 bg-emerald-400/[0.04]"}`}>
                    <p className={`text-[8px] font-black tracking-[0.14em] ${service.launchPlan === "upgrade" ? "text-[#FFDF00]" : "text-emerald-300"}`}>
                      {service.launchPlan === "upgrade" ? "UPGRADE BEFORE LAUNCH" : "KEEP ACTIVE"}
                    </p>
                    <p className="mt-1 text-[10px] leading-4 text-white/35">{service.launchNote}</p>
                  </div>
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
            <section className="rounded-3xl border border-white/10 bg-[#0A0A0A] p-6">
              <p className="text-[9px] font-black tracking-[0.17em] text-[#FFDF00]">LAUNCH CHECKLIST</p>
              <h2 className="mt-2 text-xl font-black">Deferred upgrades</h2>
              <p className="mt-3 text-xs leading-5 text-white/40">These services stay in the infrastructure register now. Paid production upgrades can wait until the public launch.</p>
              <div className="mt-5 space-y-3">
                {services.filter((service) => service.launchPlan === "upgrade").map((service) => (
                  <div key={service.name} className="flex items-center justify-between gap-4 border-t border-white/10 pt-3 text-[10px]">
                    <span className="font-bold text-white/60">{service.name}</span>
                    <span className="text-right font-black tracking-[0.1em] text-[#FFDF00]">BEFORE LAUNCH</span>
                  </div>
                ))}
              </div>
            </section>
          </aside>
        </section>
        <footer className="mt-10 border-t border-white/10 py-6 text-[9px] tracking-[0.12em] text-white/20">LAST SERVER CHECK · {new Date().toLocaleString("en-GB", { timeZone: "Europe/Berlin" })} CET · {media.length} MEDIA RECORDS</footer>
      </div>
    </main>
  );
}
