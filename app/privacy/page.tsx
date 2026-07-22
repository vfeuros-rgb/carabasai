import Link from "next/link";

const sections = [
  ["Who controls your data", "CARABASAI is the controller of personal data processed through CARABASAI STUDIO. Privacy questions and rights requests can be sent to info@carabasai.com."],
  ["Data we process", "We process account identifiers and profile details; authentication and consent records; project text, prompts, uploaded references and generated media; generation and usage records; support communications; and limited security and technical logs. We do not display passwords or provider API keys in the admin interface."],
  ["Why we process it", "We process data to create and secure accounts, provide film-production tools, save projects and media, generate requested content, prevent abuse, provide support, maintain accounting records and improve reliability. The legal bases are performance of the service contract, legitimate interests in security and product operation, consent where requested, and legal obligations for billing records."],
  ["Service providers and transfers", "CARABASAI uses infrastructure and generation providers including Supabase, Vercel, Cloudflare, Anthropic, OpenAI, Google and BytePlus. A selected provider receives only the project material required for the requested operation. Providers may process data outside the EEA under their applicable data-processing terms and transfer safeguards."],
  ["Retention", "Account and project data is kept while the account is active. When an account is deleted, active database records and user-owned project media are removed. Encrypted provider backups and security remnants expire under provider backup cycles. Administrative access logs are retained for 180 days. Billing and transaction records may be retained for the period required by tax and accounting law."],
  ["Your rights", "Depending on your location, you may request access, correction, export, restriction, objection or deletion. Signed-in users can download a JSON export and delete their account from Account Data. You may also contact info@carabasai.com and complain to your local data-protection authority."],
  ["Security and access", "We use authenticated sessions, user-scoped database policies, private media paths and restricted administrator functions. Administrator access to the user directory is logged. No internet service can guarantee absolute security, so do not upload highly sensitive data or material you are not authorized to process."],
  ["Children and third-party material", "CARABASAI is not intended for children who cannot lawfully consent to online services in their country. You are responsible for having permission to upload personal data, likenesses, scripts and other third-party material."],
  ["Changes", "We may update this policy when the product, providers or legal requirements change. Material changes will be identified by a new effective date."],
];

export default function PrivacyPage() {
  return <main className="min-h-screen bg-[#050505] p-6 text-white sm:p-12"><article className="mx-auto max-w-3xl">
    <p className="text-[10px] font-black tracking-[0.18em] text-[#FFDF00]">CARABASAI</p><h1 className="mt-5 text-4xl font-black">Privacy Policy</h1><p className="mt-3 text-xs text-white/30">Effective 23 July 2026</p>
    <p className="mt-10 text-sm leading-7 text-white/60">This policy explains how CARABASAI processes personal data when you use CARABASAI STUDIO.</p>
    <div className="mt-9 space-y-8 text-sm leading-7 text-white/60">{sections.map(([title, body]) => <section key={title}><h2 className="text-lg font-black text-white">{title}</h2><p className="mt-2">{body}</p></section>)}</div>
    <div className="mt-12 flex flex-wrap gap-6 text-sm font-black"><Link href="/account" className="text-[#FFDF00]">← BACK TO ACCOUNT</Link><Link href="/account/data" className="text-white/50">ACCOUNT DATA</Link></div>
  </article></main>;
}
