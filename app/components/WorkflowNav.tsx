"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { ACTIVE_PROJECT_KEY, deleteProject } from "../../lib/project-store";

type SessionProgress = { id?: string; title?: string; notes?: string; messages?: unknown[]; projectDocument?: unknown };

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

  async function removeCurrentProject() {
    if (!progress.id) return;
    const name = progress.title || progress.notes || "UNTITLED PROJECT";
    if (!window.confirm(`DELETE “${name}”? THIS CANNOT BE UNDONE.`)) return;
    await deleteProject(progress.id);
    sessionStorage.removeItem("carabasaiCreativeSession");
    localStorage.removeItem(ACTIVE_PROJECT_KEY);
    window.location.assign("/studio");
  }

  function startNewProject() {
    sessionStorage.removeItem("carabasaiCreativeSession");
    localStorage.removeItem(ACTIVE_PROJECT_KEY);
    window.dispatchEvent(new Event("carabasai-sidebar-change"));
    window.location.assign("/studio");
  }

  return <nav aria-label="Project workflow" className="relative z-[60] mx-auto mb-7 flex w-full max-w-7xl items-center gap-2 border-b border-white/8 pb-4 text-[9px] font-black tracking-[0.12em]">
    <div className="flex min-w-0 flex-wrap items-center gap-2">{steps.map((step, index) => <span key={step.id} className="flex items-center gap-2">{index > 0 && <span className="text-white/18">/</span>}{step.id === "setup" ? <button type="button" onClick={() => window.location.assign("/studio")} className={active === step.id ? "text-[#FFDF00]" : "text-white/35 transition hover:text-white/65"}>{step.label}</button> : <Link href={step.href} className={active === step.id ? "text-[#FFDF00]" : "text-white/35 transition hover:text-white/65"}>{step.label}</Link>}</span>)}</div>
    {progress.id && <div className="ml-auto flex shrink-0 items-center gap-3">
      <button type="button" onClick={startNewProject} className="text-[8px] text-white/35 transition hover:text-[#FFDF00]">NEW PROJECT +</button>
      <span className="text-white/10">/</span>
      <button type="button" onClick={() => void removeCurrentProject()} className="text-[8px] text-red-300/35 transition hover:text-red-300">DELETE PROJECT</button>
    </div>}
  </nav>;
}
