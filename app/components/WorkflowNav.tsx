"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

type SessionProgress = { messages?: unknown[]; projectDocument?: unknown };

export default function WorkflowNav() {
  const pathname = usePathname();
  const [progress, setProgress] = useState<SessionProgress>({});

  useEffect(() => {
    const raw = sessionStorage.getItem("carabasaiCreativeSession");
    queueMicrotask(() => setProgress(raw ? JSON.parse(raw) as SessionProgress : {}));
  }, [pathname]);

  const active = pathname === "/studio" || pathname === "/studio/" ? "setup" : pathname.includes("creative-room") ? "dialogue" : pathname.includes("project") ? "summary" : "";
  const steps = [
    { id: "setup", label: "CREW SETUP", href: "/studio", available: true },
    { id: "dialogue", label: "DIALOGUE", href: "/studio/creative-room", available: Boolean(progress.messages?.length) || active === "dialogue" || active === "summary" },
    { id: "summary", label: "SUMMARY", href: "/studio/project", available: Boolean(progress.projectDocument) || active === "summary" },
  ].filter((step) => step.available);

  return <nav aria-label="Project workflow" className="mx-auto mb-7 flex w-full max-w-7xl items-center gap-2 border-b border-white/8 pb-4 text-[9px] font-black tracking-[0.12em]">
    {steps.map((step, index) => <span key={step.id} className="flex items-center gap-2">{index > 0 && <span className="text-white/18">/</span>}<Link href={step.href} className={active === step.id ? "text-[#FFDF00]" : "text-white/35 transition hover:text-white/65"}>{step.label}</Link></span>)}
  </nav>;
}
