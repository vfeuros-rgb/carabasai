"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ACTIVE_PROJECT_KEY, deleteProject } from "../../lib/project-store";
import { platformConfirm } from "../../lib/platform-dialog";

type SessionProgress = { id?: string; title?: string; notes?: string; messages?: unknown[]; projectDocument?: unknown; stage?: string; characterCasting?: unknown };

export default function WorkflowNav() {
  const pathname = usePathname();
  const [progress, setProgress] = useState<SessionProgress>({});
  const [projectMenuOpen, setProjectMenuOpen] = useState(false);
  const projectMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const raw = sessionStorage.getItem("carabasaiCreativeSession");
    queueMicrotask(() => setProgress(raw ? JSON.parse(raw) as SessionProgress : {}));
  }, [pathname]);

  useEffect(() => {
    if (!projectMenuOpen) return;
    const closeMenu = (event: PointerEvent) => {
      if (!projectMenuRef.current?.contains(event.target as Node)) setProjectMenuOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setProjectMenuOpen(false);
    };
    document.addEventListener("pointerdown", closeMenu);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeMenu);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [projectMenuOpen]);

  const active = pathname === "/studio" || pathname === "/studio/" ? "setup" : pathname.includes("creative-room") ? "dialogue" : pathname.includes("character-casting") ? "casting" : pathname.includes("project") ? "summary" : "";
  const steps = [
    { id: "setup", label: "CREW SETUP", href: "/studio", available: true },
    { id: "dialogue", label: "DIALOGUE", href: "/studio/creative-room", available: Boolean(progress.messages?.length) || active === "dialogue" || active === "summary" },
    { id: "summary", label: "SUMMARY", href: "/studio/project", available: Boolean(progress.projectDocument) || active === "summary" },
    { id: "casting", label: "CASTING", href: "/studio/character-casting", available: Boolean(progress.characterCasting) || progress.stage === "casting" || active === "casting" },
  ].filter((step) => step.available);

  async function removeCurrentProject() {
    if (!progress.id) return;
    const name = progress.title || progress.notes || "UNTITLED PROJECT";
    const confirmed = await platformConfirm({ eyebrow: "PROJECT ACTION", title: "DELETE PROJECT?", message: `“${name}” will be permanently removed from your studio. This cannot be undone.`, confirmLabel: "DELETE PROJECT", tone: "danger" });
    if (!confirmed) return;
    setProjectMenuOpen(false);
    await deleteProject(progress.id);
    sessionStorage.removeItem("carabasaiCreativeSession");
    localStorage.removeItem(ACTIVE_PROJECT_KEY);
    window.location.assign("/studio");
  }

  function startNewProject() {
    setProjectMenuOpen(false);
    sessionStorage.removeItem("carabasaiCreativeSession");
    localStorage.removeItem(ACTIVE_PROJECT_KEY);
    window.dispatchEvent(new Event("carabasai-sidebar-change"));
    window.location.assign("/studio");
  }

  return <nav aria-label="Project workflow" className="relative z-[60] mx-auto mb-7 flex h-14 w-full max-w-7xl shrink-0 items-center gap-2 overflow-visible rounded-[16px] border border-white/10 bg-[#353535] px-4 text-[9px] font-black tracking-[0.12em] shadow-[0_12px_34px_rgba(0,0,0,.24)] sm:px-5">
    <div className="flex min-w-0 flex-nowrap items-center gap-2 overflow-x-auto">{steps.map((step, index) => <span key={step.id} className="flex shrink-0 items-center gap-2">{index > 0 && <span className="text-white/18">/</span>}{step.id === "setup" ? <button type="button" onClick={() => window.location.assign("/studio")} className={active === step.id ? "text-[#FFDF00]" : "text-white/35 transition hover:text-white/65"}>{step.label}</button> : <Link href={step.href} className={active === step.id ? "text-[#FFDF00]" : "text-white/35 transition hover:text-white/65"}>{step.label}</Link>}</span>)}</div>
    {progress.id && <div ref={projectMenuRef} className="relative ml-auto shrink-0">
      <button type="button" onClick={() => setProjectMenuOpen((current) => !current)} aria-expanded={projectMenuOpen} aria-haspopup="menu" aria-label="Project actions" className={`flex h-8 w-8 items-center justify-center rounded-full border text-base leading-none transition ${projectMenuOpen ? "border-[#FFDF00]/40 text-[#FFDF00]" : "border-white/10 text-white/45 hover:border-white/25 hover:text-white"}`}>⋮</button>
      {projectMenuOpen && <div role="menu" className="absolute right-0 top-10 z-[80] w-44 rounded-[14px] border border-white/10 bg-[#111] p-1.5 shadow-2xl">
        <button type="button" role="menuitem" onClick={startNewProject} className="flex h-9 w-full items-center justify-between rounded-lg px-3 text-left text-[8px] font-black tracking-[0.1em] text-white/60 hover:bg-white/5 hover:text-[#FFDF00]">NEW PROJECT <span>＋</span></button>
        <button type="button" role="menuitem" onClick={() => void removeCurrentProject()} className="flex h-9 w-full items-center justify-between rounded-lg px-3 text-left text-[8px] font-black tracking-[0.1em] text-red-300/60 hover:bg-red-500/5 hover:text-red-300">DELETE PROJECT <span>⌫</span></button>
      </div>}
    </div>}
  </nav>;
}
