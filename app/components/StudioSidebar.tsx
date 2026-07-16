"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { PointerEvent, useEffect, useState } from "react";
import { getCachedProjects, projectChangeEvent, syncProjects } from "../../lib/project-store";

type SavedSession = { id?: string; title?: string; notes?: string; startedAt?: number; projectDocument?: unknown; messages?: unknown[] };

export default function StudioSidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const [width, setWidth] = useState(260);
  const [historyOpen, setHistoryOpen] = useState(true);
  const [sessions, setSessions] = useState<SavedSession[]>([]);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    const restore = () => {
      const savedWidth = Number(localStorage.getItem("carabasaiHistoryWidth"));
      setWidth(savedWidth >= 220 && savedWidth <= 480 ? savedWidth : 260);
      setHistoryOpen(localStorage.getItem("carabasaiSharedHistoryOpen") !== "false");
      setSessions(getCachedProjects<SavedSession>());
    };
    queueMicrotask(restore);
    window.addEventListener("carabasai-sidebar-change", restore);
    window.addEventListener("storage", restore);
    window.addEventListener(projectChangeEvent, restore);
    void syncProjects<SavedSession>().then(setSessions).catch(console.error);
    return () => { window.removeEventListener("carabasai-sidebar-change", restore); window.removeEventListener("storage", restore); window.removeEventListener(projectChangeEvent, restore); };
  }, []);

  function resize(event: PointerEvent<HTMLButtonElement>) {
    event.currentTarget.setPointerCapture(event.pointerId);
    const startX = event.clientX;
    const startWidth = width;
    const move = (moveEvent: globalThis.PointerEvent) => {
      const next = Math.min(480, Math.max(220, startWidth + moveEvent.clientX - startX));
      setWidth(next);
      localStorage.setItem("carabasaiHistoryWidth", String(next));
    };
    const stop = () => {
      window.dispatchEvent(new Event("carabasai-sidebar-change"));
      window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", stop);
    };
    window.addEventListener("pointermove", move); window.addEventListener("pointerup", stop);
  }

  useEffect(() => { document.documentElement.style.setProperty("--studio-sidebar-width", `${width}px`); }, [width]);

  function openSession(session: SavedSession) {
    sessionStorage.setItem("carabasaiCreativeSession", JSON.stringify(session));
    router.push(session.projectDocument ? "/studio/project" : session.messages?.length ? "/studio/creative-room" : "/studio");
  }

  const accountActive = pathname.startsWith("/account");
  const homeActive = pathname === "/studio" || pathname === "/studio/";
  const item = "flex h-11 items-center justify-between rounded-xl border px-4 text-[10px] font-black tracking-[0.12em]";
  return <>
  <button type="button" onClick={() => setMobileOpen(true)} className="fixed left-4 top-4 z-[70] flex h-11 w-11 flex-col items-center justify-center gap-1.5 rounded-full border border-white/15 bg-[#0B0B0B]/95 shadow-xl md:hidden" aria-label="Open navigation"><span className="h-px w-4 bg-[#FFDF00]"/><span className="h-px w-4 bg-[#FFDF00]"/><span className="h-px w-4 bg-[#FFDF00]"/></button>
  {mobileOpen && <button type="button" onClick={() => setMobileOpen(false)} className="fixed inset-0 z-[75] bg-black/75 backdrop-blur-sm md:hidden" aria-label="Close navigation" />}
  <aside className={`fixed bottom-0 left-0 top-0 z-[80] flex max-w-[88vw] flex-col border-r border-white/10 bg-[#080808] p-5 text-white transition-transform duration-200 md:translate-x-0 ${mobileOpen ? "translate-x-0" : "-translate-x-full"}`} style={{ width }}>
    <button type="button" onClick={() => setMobileOpen(false)} className="absolute right-4 top-3 flex h-9 w-9 items-center justify-center rounded-full border border-white/10 text-white/45 md:hidden" aria-label="Close navigation">×</button>
    <p className="text-[11px] font-black tracking-[0.2em] text-[#FFDF00]">CARABASAI STUDIO</p>
    <nav className="mt-6 grid gap-2">
      <Link href="/studio" className={`${item} ${homeActive ? "border-[#FFDF00] bg-[#FFDF00] text-black" : "border-white/10 bg-white/[0.025] text-white/65"}`}>STUDIO HOME <span>⌂</span></Link>
      <Link href="/account" className={`${item} ${accountActive ? "border-[#FFDF00] bg-[#FFDF00] text-black" : "border-white/10 bg-white/[0.025] text-white/65"}`}>MY ACCOUNT <span>○</span></Link>
      <a href="mailto:info@carabasai.com" className={`${item} border-white/10 bg-white/[0.025] text-white/65`}>HELP DESK <span className="text-[#FFDF00]">?</span></a>
    </nav>
    <div className="mt-auto border-t border-white/10 pt-4">
      <button type="button" onClick={() => { const next = !historyOpen; setHistoryOpen(next); localStorage.setItem("carabasaiSharedHistoryOpen", String(next)); }} className="flex w-full items-center justify-between py-2 text-[9px] font-black tracking-[0.14em] text-[#FFDF00]">SESSION HISTORY <span>{historyOpen ? "−" : "+"}</span></button>
      {historyOpen && <div className="mt-2 max-h-[42vh] space-y-2 overflow-y-auto">{sessions.length ? sessions.map((session) => <button key={session.id ?? session.startedAt ?? session.notes} onClick={() => openSession(session)} className="block w-full truncate rounded-lg border border-white/8 bg-white/[0.02] px-3 py-2 text-left text-[9px] text-white/45 hover:border-[#FFDF00]/30">{session.title || session.notes || "UNTITLED SESSION"}</button>) : <p className="py-2 text-[8px] leading-4 text-white/20">YOUR SAVED SESSIONS WILL APPEAR HERE.</p>}</div>}
    </div>
    <button type="button" onPointerDown={resize} className="absolute bottom-0 right-0 top-0 hidden w-2 cursor-col-resize touch-none hover:bg-[#FFDF00]/20 md:block" aria-label="Resize navigation" />
  </aside></>;
}
