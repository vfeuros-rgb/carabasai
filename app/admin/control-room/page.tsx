import Link from "next/link";
import { requireAdmin } from "../../../lib/admin-access";

export const dynamic = "force-dynamic";

type State = "online" | "configured" | "attention" | "offline";
type AdminIncident = {
  id: string; createdAt: string; service: string; action: string; status: number; message: string;
  userEmail?: string; projectId?: string; projectTitle?: string;
};
type Service = {
  name: string; purpose: string; state: State; status: string; detail: string;
  model?: string; usage?: string; cost?: string; href: string;
  launchPlan: "keep" | "upgrade";
  launchNote: string;
};

type BillingItem = {
  name: string; purpose: string; cadence: "monthly" | "annual" | "usage" | "free";
  monthlyUsd: number; annualUsd: number; allowance: string; consumed: string; remaining: string;
  source: "live" | "estimated" | "manual"; href: string; connected?: boolean; nextCharge?: string;
};
type AdminUser = {
  user_id: string; email: string; full_name: string; created_at: string; email_confirmed_at: string | null;
  last_sign_in_at: string | null; project_count: number; media_bytes: number;
};
type AuditLog = {
  id: string; admin_user_id: string; action: string; target_user_id: string | null; details: Record<string, unknown>; created_at: string;
};

function envText(name: string, fallback: string) {
  const value = process.env[name]?.trim();
  return value || fallback;
}

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

  const [projectsResult, messagesResult, notebookResult, mediaResult, usageResult, usersResult, auditResult, openAiOnline, anthropicOnline, cloudflareOnline] = await Promise.all([
    supabase.from("projects").select("id,stage,ai_provider,created_at,project_document", { count: "exact" }),
    supabase.from("messages").select("id", { count: "exact", head: true }),
    supabase.from("notebook_items").select("id", { count: "exact", head: true }),
    supabase.from("media_assets").select("size_bytes,kind"),
    supabase.from("ai_usage_buckets").select("request_count").eq("bucket_kind", "day").gte("bucket_start", today.toISOString()),
    supabase.rpc("admin_user_directory"),
    supabase.from("admin_audit_logs").select("id,admin_user_id,action,target_user_id,details,created_at").order("created_at", { ascending: false }).limit(100),
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

  const registeredUsers = (usersResult.data ?? []) as AdminUser[];
  const auditLogs = (auditResult.data ?? []) as AuditLog[];
  if (!usersResult.error) {
    await supabase.rpc("record_admin_audit", { p_action: "view_user_directory", p_details: { row_count: registeredUsers.length } });
  }

  const projects = projectsResult.data ?? [];
  const incidents = projects
    .flatMap((project) => {
      const stored = project.project_document && typeof project.project_document === "object"
        ? (project.project_document as { admin_incidents?: AdminIncident[] }).admin_incidents
        : [];
      return (stored ?? []).map((incident) => ({ ...incident, projectTitle: incident.projectTitle ?? project.id }));
    })
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
    .slice(0, 30);
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
  const anthropicUsageMonth = envMoney("ANTHROPIC_USAGE_MONTH_USD", 12.20);
  const openAiUsageMonth = envMoney("OPENAI_USAGE_MONTH_USD", 5);
  const chatGptPlusMonthlyEur = envMoney("CHATGPT_PLUS_MONTHLY_EUR", 23.58);
  const chatGptPlusMonthlyUsd = chatGptPlusMonthlyEur * rates.usdPerEur;
  const supabaseMonthly = envMoney("SUPABASE_MONTHLY_USD");
  const vercelMonthly = envMoney("VERCEL_MONTHLY_USD", 20);
  const byteplusUsageMonth = envMoney("BYTEPLUS_USAGE_MONTH_USD", 30.10);
  const geminiUsageMonth = envMoney("GEMINI_USAGE_MONTH_USD", 5.50 * rates.usdPerEur);
  const replicateUsageMonth = envMoney("REPLICATE_USAGE_MONTH_USD");
  const godaddyAnnualEur = envMoney("GODADDY_CARABASAI_ANNUAL_EUR", 21.99) + envMoney("GODADDY_FLORIANI_ANNUAL_EUR", 21.99);
  const tildaAnnualRub = envMoney("TILDA_BUSINESS_ANNUAL_RUB", 12_000);
  const godaddyAnnual = godaddyAnnualEur * rates.usdPerEur;
  const tildaAnnualUsd = (tildaAnnualRub / rates.rubPerEur) * rates.usdPerEur;
  const billing: BillingItem[] = [
    { name: "BytePlus · Seedance", purpose: "Seedance video generation", cadence: "usage", monthlyUsd: byteplusUsageMonth, annualUsd: byteplusUsageMonth * 12, allowance: "Postpaid by token consumption · hourly billing", consumed: "$30.10 billed in Jul 2026", remaining: "No monthly subscription", source: "manual", connected: Boolean(process.env.BYTEPLUS_API_KEY), nextCharge: envText("BYTEPLUS_NEXT_CHARGE", "WHEN CREDITS RUN OUT"), href: "https://console.byteplus.com/ark/region:ap-southeast-1/usage" },
    { name: "Google Gemini", purpose: "Gemini and Veo generation", cadence: "usage", monthlyUsd: geminiUsageMonth, annualUsd: geminiUsageMonth * 12, allowance: "€10.00 prepaid on 17 Jul 2026", consumed: "€5.50 used", remaining: "€4.50 credit balance", source: "manual", connected: Boolean(process.env.GEMINI_API_KEY), nextCharge: envText("GEMINI_NEXT_CHARGE", "WHEN CREDITS RUN OUT"), href: "https://console.cloud.google.com/billing" },
    { name: "Replicate", purpose: "Image and video model inference", cadence: "usage", monthlyUsd: replicateUsageMonth, annualUsd: replicateUsageMonth * 12, allowance: "Usage-based inference", consumed: replicateUsageMonth ? `${money(replicateUsageMonth)} entered this month` : "No monthly subscription", remaining: "Balance and usage are shown in Replicate", source: replicateUsageMonth ? "manual" : "estimated", connected: Boolean(process.env.REPLICATE_API_TOKEN), nextCharge: envText("REPLICATE_NEXT_CHARGE", "WHEN CREDITS RUN OUT"), href: "https://replicate.com/account/billing" },
    { name: "Cloudflare Workers AI", purpose: "Project cover generation", cadence: "monthly", monthlyUsd: cloudflareBaseMonthly + cloudflareUsageMonth, annualUsd: (cloudflareBaseMonthly + cloudflareUsageMonth) * 12, allowance: "$5.00 / month · tax added on invoice", consumed: `≈ ${estimatedNeuronsToday.toLocaleString("en-US")} neurons today · ${coversThisMonth} covers this month`, remaining: `≈ ${estimatedNeuronsRemaining.toLocaleString("en-US")} neurons today`, source: "manual", connected: Boolean(process.env.CLOUDFLARE_API_TOKEN), nextCharge: envText("CLOUDFLARE_NEXT_CHARGE", "16 AUG 2026"), href: "https://dash.cloudflare.com/?to=/:account/ai/workers-ai" },
    { name: "Anthropic · Claude", purpose: "Claude dialogue and documents", cadence: "usage", monthlyUsd: anthropicUsageMonth, annualUsd: anthropicUsageMonth * 12, allowance: "2 credit purchases · $5.00 + tax = $6.10 each", consumed: "$12.20 paid in Jul 2026", remaining: "$5.30 credit balance", source: "manual", connected: Boolean(process.env.ANTHROPIC_API_KEY), nextCharge: envText("ANTHROPIC_NEXT_CHARGE", "WHEN CREDITS RUN OUT"), href: "https://console.anthropic.com/settings/billing" },
    { name: "OpenAI API", purpose: "GPT dialogue and documents", cadence: "usage", monthlyUsd: openAiUsageMonth, annualUsd: openAiUsageMonth * 12, allowance: "Prepaid / usage-based API", consumed: `${providerCounts.openai ?? 0} projects · ${money(openAiUsageMonth)} entered`, remaining: "Balance needs an organization Admin key", source: openAiUsageMonth ? "manual" : "estimated", connected: Boolean(process.env.OPENAI_API_KEY), nextCharge: envText("OPENAI_NEXT_CHARGE", "WHEN CREDITS RUN OUT"), href: "https://platform.openai.com/usage" },
    { name: "ChatGPT Plus", purpose: "Personal ChatGPT subscription", cadence: "monthly", monthlyUsd: chatGptPlusMonthlyUsd, annualUsd: chatGptPlusMonthlyUsd * 12, allowance: "Personal subscription · separate from the OpenAI API", consumed: `${euro(chatGptPlusMonthlyEur)} / month`, remaining: `${euro(chatGptPlusMonthlyEur * 12)} / year projection`, source: "manual", connected: true, nextCharge: envText("CHATGPT_PLUS_NEXT_CHARGE", "DATE NOT PROVIDED"), href: "https://chatgpt.com/#settings/Subscription" },
    { name: "Supabase", purpose: "Auth, database and media", cadence: supabaseMonthly ? "monthly" : "free", monthlyUsd: supabaseMonthly, annualUsd: supabaseMonthly * 12, allowance: supabaseMonthly ? "Paid plan" : "Free development plan", consumed: `${projects.length} projects · ${bytes(totalMediaBytes)}`, remaining: "Exact quotas in Supabase Usage", source: "manual", connected: true, nextCharge: supabaseMonthly ? envText("SUPABASE_NEXT_CHARGE", "DATE NOT PROVIDED") : "NO PAYMENT · FREE PLAN", href: "https://supabase.com/dashboard" },
    { name: "Vercel Pro", purpose: "Hosting and deployments", cadence: "monthly", monthlyUsd: vercelMonthly, annualUsd: vercelMonthly * 12, allowance: "$20 included credit · usage billed on demand", consumed: "$4.79 / $20 included credit used · $20 upcoming invoice", remaining: "Current cycle: 18 Jul – 18 Aug 2026", source: "manual", connected: true, nextCharge: envText("VERCEL_NEXT_CHARGE", "18 AUG 2026"), href: "https://vercel.com/carabasai/~/settings/billing" },
    { name: "GoDaddy · carabasai.com", purpose: "Carabasai domain and business email", cadence: "annual", monthlyUsd: 21.99 * rates.usdPerEur / 12, annualUsd: 21.99 * rates.usdPerEur, allowance: "Paid through 31 Jan 2027", consumed: "€21.99 / year", remaining: "Renew by 31 Jan 2027", source: "manual", connected: true, nextCharge: "31 Jan 2027", href: "https://account.godaddy.com/products" },
    { name: "GoDaddy · Floriani", purpose: "Other website on the same account", cadence: "annual", monthlyUsd: 21.99 * rates.usdPerEur / 12, annualUsd: 21.99 * rates.usdPerEur, allowance: "Paid through 20 Apr 2027", consumed: "€21.99 / year", remaining: "Renew by 20 Apr 2027", source: "manual", connected: true, nextCharge: "20 Apr 2027", href: "https://account.godaddy.com/products" },
    { name: "Tilda Business", purpose: "Website builder subscription", cadence: "annual", monthlyUsd: tildaAnnualUsd / 12, annualUsd: tildaAnnualUsd, allowance: "Paid through 13 Oct 2027", consumed: "₽12,000 / year", remaining: "Renew by 13 Oct 2027", source: "manual", connected: true, nextCharge: "13 Oct 2027", href: "https://tilda.cc/identity/plan/" },
    { name: "Cloudflare Turnstile", purpose: "Bot protection", cadence: "free", monthlyUsd: 0, annualUsd: 0, allowance: "Free", consumed: "Registration and recovery", remaining: "No subscription payment", source: "live", connected: true, nextCharge: "NO PAYMENT · FREE PLAN", href: "https://dash.cloudflare.com/?to=/:account/turnstile" },
  ];
  const fixedMonthly = cloudflareBaseMonthly + chatGptPlusMonthlyUsd + supabaseMonthly + vercelMonthly + godaddyAnnual / 12 + tildaAnnualUsd / 12;
  const variableMonthly = cloudflareUsageMonth + anthropicUsageMonth + openAiUsageMonth + byteplusUsageMonth + geminiUsageMonth + replicateUsageMonth;
  const monthlyTotal = fixedMonthly + variableMonthly;
  const annualCommitted = cloudflareBaseMonthly * 12 + chatGptPlusMonthlyUsd * 12 + supabaseMonthly * 12 + vercelMonthly * 12 + godaddyAnnual + tildaAnnualUsd;
  const annualProjection = monthlyTotal * 12;
  const monthlyTotalEur = monthlyTotal / rates.usdPerEur;
  const annualProjectionEur = annualProjection / rates.usdPerEur;

  const services: Service[] = [
    {
      name: "BytePlus · Seedance", purpose: "AI video generation",
      state: process.env.BYTEPLUS_API_KEY ? "configured" : "offline",
      status: process.env.BYTEPLUS_API_KEY ? "API key connected" : "Not configured", detail: "Seedance video models through BytePlus ModelArk.",
      model: "Seedance family", usage: byteplusUsageMonth ? `${money(byteplusUsageMonth)} this month` : "Usage total not connected",
      cost: "Usage-based", launchPlan: "upgrade", launchNote: "Track credits, video jobs and model errors before launch.",
      href: "https://console.byteplus.com/ark/region:ap-southeast-1/usage",
    },
    {
      name: "Google Gemini", purpose: "Gemini and Veo models",
      state: process.env.GEMINI_API_KEY ? "configured" : "offline",
      status: process.env.GEMINI_API_KEY ? "API key connected" : "Not configured", detail: "Google image, reasoning and video generation.",
      model: "Gemini / Veo", usage: geminiUsageMonth ? `${money(geminiUsageMonth)} this month` : "Usage total not connected",
      cost: "Usage-based", launchPlan: "upgrade", launchNote: "Verify Veo quotas and billing before public video generation.",
      href: "https://console.cloud.google.com/billing",
    },
    {
      name: "Replicate", purpose: "Hosted image and video models",
      state: process.env.REPLICATE_API_TOKEN ? "configured" : "offline",
      status: process.env.REPLICATE_API_TOKEN ? "API token connected" : "Not configured", detail: "External image and video model inference.",
      model: process.env.REPLICATE_R001_MODEL ?? "Configured model", usage: replicateUsageMonth ? `${money(replicateUsageMonth)} this month` : "Usage total not connected",
      cost: "Usage-based", launchPlan: "upgrade", launchNote: "Add spending limits and production monitoring before launch.",
      href: "https://replicate.com/account/billing",
    },
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
    ["USERS", registeredUsers.length],
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

        <section className="grid gap-3 py-8 sm:grid-cols-2 xl:grid-cols-6">
          {stats.map(([label, value]) => (
            <div key={label} className="rounded-2xl border border-white/10 bg-[#0B0B0B] p-5">
              <p className="text-[9px] font-black tracking-[0.18em] text-white/35">{label}</p>
              <p className="mt-3 text-3xl font-black tracking-[-0.04em]">{value}</p>
            </div>
          ))}
        </section>

        <section className="mb-10 overflow-hidden rounded-3xl bg-[#0A0A0A]">
          <div className="flex flex-col gap-3 bg-[#141414] px-6 py-5 sm:flex-row sm:items-end sm:justify-between">
            <div><p className="text-[9px] font-black tracking-[0.18em] text-[#FFDF00]">PRIVACY · MINIMIZED ACCESS</p><h2 className="mt-2 text-2xl font-black">Registered users</h2></div>
            <p className="max-w-xl text-[10px] leading-4 text-white/30">Passwords, payment-card data, prompts and project content are not shown here. Directory access is recorded below.</p>
          </div>
          {usersResult.error ? <div className="px-6 py-8"><p className="text-sm font-bold text-orange-300">Privacy database migration is waiting to be installed.</p><p className="mt-2 text-[10px] text-white/35">The admin directory remains closed until the protected database functions are active.</p></div> : registeredUsers.length ? <div className="overflow-x-auto">
            <div className="min-w-[1000px] divide-y divide-white/10">{registeredUsers.map((entry) => <article key={entry.user_id} className="grid grid-cols-[1.3fr_1fr_.8fr_.75fr_.65fr_.65fr] gap-5 px-6 py-4 text-[10px]">
              <div><p className="font-black text-white/80">{entry.email}</p><p className="mt-1 text-white/25">{entry.full_name || "Name not provided"}</p></div>
              <div><p className="text-white/25">REGISTERED</p><p className="mt-1 font-bold">{new Date(entry.created_at).toLocaleString("en-GB", { timeZone: "Europe/Berlin" })}</p></div>
              <div><p className="text-white/25">EMAIL</p><p className={`mt-1 font-black ${entry.email_confirmed_at ? "text-emerald-300" : "text-orange-300"}`}>{entry.email_confirmed_at ? "CONFIRMED" : "PENDING"}</p></div>
              <div><p className="text-white/25">LAST SIGN-IN</p><p className="mt-1 font-bold">{entry.last_sign_in_at ? new Date(entry.last_sign_in_at).toLocaleDateString("en-GB", { timeZone: "Europe/Berlin" }) : "Never"}</p></div>
              <div><p className="text-white/25">PROJECTS</p><p className="mt-1 text-lg font-black">{entry.project_count}</p></div>
              <div><p className="text-white/25">MEDIA</p><p className="mt-1 text-lg font-black">{bytes(entry.media_bytes)}</p></div>
            </article>)}</div>
          </div> : <p className="px-6 py-8 text-xs text-white/35">No registered users.</p>}
        </section>

        <section className="mb-10 grid gap-6 xl:grid-cols-[1.5fr_1fr]">
          <div className="overflow-hidden rounded-3xl bg-[#0A0A0A]">
            <div className="bg-[#141414] px-6 py-5"><p className="text-[9px] font-black tracking-[0.18em] text-[#FFDF00]">ACCOUNTABILITY</p><h2 className="mt-2 text-2xl font-black">Administrator audit log</h2></div>
            <div className="max-h-[420px] divide-y divide-white/10 overflow-y-auto">{auditLogs.length ? auditLogs.map((log) => <article key={log.id} className="grid gap-2 px-6 py-4 sm:grid-cols-[170px_1fr]">
              <p className="text-[9px] text-white/30">{new Date(log.created_at).toLocaleString("en-GB", { timeZone: "Europe/Berlin" })}</p><div><p className="text-[10px] font-black text-white/75">{log.action.replaceAll("_", " ").toUpperCase()}</p><p className="mt-1 break-all text-[9px] text-white/25">ADMIN {log.admin_user_id}{log.target_user_id ? ` · TARGET ${log.target_user_id}` : ""}</p></div>
            </article>) : <p className="px-6 py-8 text-xs text-white/35">No administrator actions recorded yet.</p>}</div>
          </div>
          <div className="rounded-3xl bg-[#0A0A0A] p-6"><p className="text-[9px] font-black tracking-[0.18em] text-[#FFDF00]">RETENTION</p><h2 className="mt-2 text-xl font-black">Data lifecycle</h2><div className="mt-6 space-y-4 text-[10px] leading-5 text-white/40"><p><b className="text-white/70">ACTIVE ACCOUNTS</b><br/>Kept while the service is used.</p><p><b className="text-white/70">ACCOUNT DELETION</b><br/>Database rows and owned media are removed on request.</p><p><b className="text-white/70">ADMIN AUDIT</b><br/>180 days, then eligible for pruning.</p><p><b className="text-white/70">BILLING RECORDS</b><br/>Retained as required by tax and accounting law.</p></div></div>
        </section>

        <section className="mb-10 overflow-hidden rounded-3xl border border-red-400/20 bg-[#0A0808]">
          <div className="flex items-end justify-between gap-4 border-b border-white/10 px-6 py-5">
            <div>
              <p className="text-[9px] font-black tracking-[0.18em] text-red-300">PRIVATE SYSTEM ALERTS</p>
              <h2 className="mt-2 text-2xl font-black tracking-[-0.03em]">Provider incidents</h2>
            </div>
            <p className="text-[10px] text-white/30">Visible only to administrators</p>
          </div>
          {incidents.length === 0 ? (
            <p className="px-6 py-6 text-xs text-white/35">No recorded provider incidents.</p>
          ) : (
            <div className="divide-y divide-white/10">
              {incidents.map((incident) => (
                <article key={incident.id} className="grid gap-3 px-6 py-5 lg:grid-cols-[170px_1fr_220px]">
                  <div>
                    <p className="text-[10px] font-black text-red-300">{incident.service} · {incident.status}</p>
                    <p className="mt-1 text-[9px] text-white/30">{new Date(incident.createdAt).toLocaleString("en-GB", { timeZone: "Europe/Berlin" })}</p>
                  </div>
                  <div>
                    <p className="text-xs font-bold text-white/70">{incident.action}</p>
                    <p className="mt-1 break-words text-[10px] leading-5 text-white/40">{incident.message}</p>
                  </div>
                  <div className="text-[9px] leading-4 text-white/30">
                    <p>{incident.projectTitle ?? incident.projectId ?? "Unknown project"}</p>
                    <p>{incident.userEmail ?? "Unknown user"}</p>
                  </div>
                </article>
              ))}
            </div>
          )}
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
              <p className="mt-2 text-[10px] leading-5 text-white/40">Vercel Pro $20/mo · Cloudflare $5/mo · Claude credits $12.20 in Jul · BytePlus $30.10 in Jul · Gemini €5.50 used · ChatGPT Plus €23.58/mo · GoDaddy €43.98/yr · Tilda ₽12,000/yr</p>
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
          <div className="mt-4 overflow-hidden rounded-3xl border border-[#FFDF00]/25 bg-[#0A0A0A]">
            <div className="hidden grid-cols-[1.2fr_.65fr_.65fr_.65fr_1.15fr_1fr_1fr] gap-4 border-b border-[#FFDF00]/20 bg-[#FFDF00]/[0.04] px-6 py-4 text-[8px] font-black tracking-[0.15em] text-white/35 lg:grid">
              <span>SERVICE</span><span>STATUS</span><span>MONTH</span><span>YEAR</span><span>NEXT CHARGE</span><span>USAGE</span><span>LIMIT / BALANCE</span>
            </div>
            {billing.map((item) => (
              <a key={item.name} href={item.href} target="_blank" rel="noreferrer" className="grid gap-4 border-b border-white/10 px-6 py-5 last:border-0 hover:bg-[#FFDF00]/[0.035] lg:grid-cols-[1.2fr_.65fr_.65fr_.65fr_1.15fr_1fr_1fr]">
                <div><p className="text-sm font-black">{item.name}</p><p className="mt-1 text-[10px] text-white/35">{item.purpose}</p></div>
                <div><p className="text-[8px] text-white/25 lg:hidden">STATUS</p><p className={`text-[10px] font-black tracking-[0.1em] ${item.connected === false ? "text-red-400" : "text-emerald-300"}`}>{item.connected === false ? "NO KEY" : item.connected ? "CONNECTED" : item.cadence.toUpperCase()}</p><p className="mt-1 text-[8px] font-bold text-white/25">{item.source.toUpperCase()}</p></div>
                <div><p className="text-[8px] text-white/25 lg:hidden">MONTH</p><p className="text-sm font-black">{money(item.monthlyUsd)}</p></div>
                <div><p className="text-[8px] text-white/25 lg:hidden">YEAR</p><p className="text-sm font-black">{money(item.annualUsd)}</p></div>
                <div><p className="text-[8px] text-white/25 lg:hidden">NEXT CHARGE</p><p className="text-[10px] font-black leading-4 text-[#FFDF00]">{item.nextCharge ?? "Not specified"}</p><p className="mt-1 text-[8px] text-white/25">{item.cadence.toUpperCase()}</p></div>
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
            <section className="rounded-3xl bg-[#0A0A0A] p-6">
              <p className="text-[9px] font-black tracking-[0.17em] text-[#FFDF00]">DATA PROCESSING AGREEMENTS</p>
              <h2 className="mt-2 text-xl font-black">DPA register</h2>
              <p className="mt-3 text-xs leading-5 text-white/40">Technical safeguards are active. Provider contracts and transfer terms must be accepted by the account owner in each provider console.</p>
              <div className="mt-5 divide-y divide-white/10">{["Supabase", "Vercel", "Cloudflare", "Anthropic", "OpenAI", "Google", "BytePlus"].map((provider) => <div key={provider} className="flex items-center justify-between gap-4 py-3 text-[10px]"><span className="font-bold text-white/65">{provider}</span><span className="font-black text-orange-300">OWNER REVIEW</span></div>)}</div>
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
