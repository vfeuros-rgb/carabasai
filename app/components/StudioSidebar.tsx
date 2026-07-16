"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { PointerEvent, useEffect, useState } from "react";

type SavedSession = { id?: string; title?: string; notes?: string; startedAt?: number; projectDocument?: unknown; messages?: unknown[] };

export default function StudioSidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const [width, setWidth] = useState(260);
  const [historyOpen, setHistoryOpen] = useState(true);
  const [sessions, setSessions] = useState<SavedSession[]>([]);

  useEffect(() => {
    const restore = () => {
      const savedWidth = Number(localStorage.getItem("carabasaiHistoryWidth"));
      setWidth(savedWidth >= 220 && savedWidth <= 480 ? savedWidth : 260);
      setHistoryOpen(localStorage.getItem("carabasaiSharedHistoryOpen") !== "false");
      setSessions(JSON.parse(localStorage.getItem("carabasaiSessionHistory") ?? "[]") as SavedSession[]);
    };
    queueMicrotask(restore);
    window.addEventListener("carabasai-sidebar-change", restore);
    window.addEventListener("storage", restore);
    return () => { window.removeEventListener("carabasai-sidebar-change", restore); window.removeEventListener("storage", restore); };
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
  return <aside className="fixed bottom-0 left-0 top-0 z-[60] flex flex-col border-r border-white/10 bg-[#080808] p-5 text-white" style={{ width }}>
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
    <button type="button" onPointerDown={resize} className="absolute bottom-0 right-0 top-0 w-2 cursor-col-resize touch-none hover:bg-[#FFDF00]/20" aria-label="Resize navigation" />
  </aside>;
}
