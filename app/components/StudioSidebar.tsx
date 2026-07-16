"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import { PointerEvent, useEffect, useRef, useState } from "react";
import { deleteProject, getCachedProjects, projectChangeEvent, saveProjects, syncProjects } from "../../lib/project-store";

type SavedSession = { id?: string; title?: string; notes?: string; startedAt?: number; favorite?: boolean; projectDocument?: unknown; messages?: unknown[] };

export default function StudioSidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const [width, setWidth] = useState(260);
  const [historyOpen, setHistoryOpen] = useState(true);
  const [sessions, setSessions] = useState<SavedSession[]>([]);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState("");
  const [swipedId, setSwipedId] = useState<string | null>(null);
  const [mobileBrandVisible, setMobileBrandVisible] = useState(true);
  const menuSwipe = useRef<{ x: number; y: number } | null>(null);
  const itemSwipe = useRef<{ x: number; y: number; id: string } | null>(null);
  const lastScrollY = useRef(0);
  const scrollDirectionStart = useRef(0);

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

  useEffect(() => {
    lastScrollY.current = window.scrollY;
    scrollDirectionStart.current = window.scrollY;
    const handleScroll = () => {
      const current = window.scrollY;
      const difference = current - lastScrollY.current;
      if (current < 20) setMobileBrandVisible(true);
      else if (difference > 0) {
        if (current - scrollDirectionStart.current > 18) setMobileBrandVisible(false);
        if (lastScrollY.current < scrollDirectionStart.current) scrollDirectionStart.current = lastScrollY.current;
      } else if (difference < 0) {
        if (scrollDirectionStart.current - current > 48) setMobileBrandVisible(true);
        if (lastScrollY.current > scrollDirectionStart.current) scrollDirectionStart.current = lastScrollY.current;
      }
      lastScrollY.current = current;
    };
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  useEffect(() => {
    const start = (event: globalThis.TouchEvent) => {
      const touch = event.touches[0];
      if (touch.clientX <= 90) menuSwipe.current = { x: touch.clientX, y: touch.clientY };
    };
    const end = (event: globalThis.TouchEvent) => {
      const origin = menuSwipe.current;
      const touch = event.changedTouches[0];
      if (origin && touch.clientX - origin.x > 42 && Math.abs(touch.clientY - origin.y) < 90) setMobileOpen(true);
      menuSwipe.current = null;
    };
    document.addEventListener("touchstart", start, { passive: true });
    document.addEventListener("touchend", end, { passive: true });
    return () => { document.removeEventListener("touchstart", start); document.removeEventListener("touchend", end); };
  }, []);

  function openSession(session: SavedSession) {
    sessionStorage.setItem("carabasaiCreativeSession", JSON.stringify(session));
    router.push(session.projectDocument ? "/studio/project" : session.messages?.length ? "/studio/creative-room" : "/studio");
  }

  function persist(next: SavedSession[]) {
    const sorted = [...next].sort((a, b) => Number(Boolean(b.favorite)) - Number(Boolean(a.favorite)));
    setSessions(sorted);
    saveProjects(sorted);
  }

  function toggleFavorite(session: SavedSession) {
    persist(sessions.map((item) => item.id === session.id ? { ...item, favorite: !item.favorite } : item));
  }

  function beginRename(session: SavedSession) {
    setEditingId(session.id ?? null);
    setEditingTitle(session.title || session.notes || "Untitled project");
  }

  function finishRename(session: SavedSession) {
    const title = editingTitle.trim();
    if (title) persist(sessions.map((item) => item.id === session.id ? { ...item, title } : item));
    setEditingId(null);
  }

  async function remove(session: SavedSession) {
    if (!session.id || !window.confirm(`DELETE “${session.title || session.notes || "UNTITLED PROJECT"}”?`)) return;
    setSessions((current) => current.filter((item) => item.id !== session.id));
    setSwipedId(null);
    await deleteProject(session.id);
  }

  const accountActive = pathname.startsWith("/account");
  const homeActive = pathname === "/studio" || pathname === "/studio/";
  const item = "flex h-11 items-center justify-between rounded-xl border px-4 text-[10px] font-black tracking-[0.12em]";
  return <>
  <div className="pointer-events-none fixed inset-x-0 top-0 z-[70] flex h-14 items-center justify-between px-4 md:hidden">
    <button type="button" onClick={() => setMobileOpen(true)} className="pointer-events-auto flex h-8 w-8 items-center justify-center" aria-label="Open navigation">
      <Image src="/logo-carabasai.svg" alt="Open Carabasai Studio menu" width={28} height={28} className="h-7 w-7 object-contain" priority />
    </button>
    <span className={`text-[8px] font-black tracking-[0.2em] text-[#FFDF00] transition-all duration-200 ${mobileBrandVisible ? "translate-y-0 opacity-100" : "-translate-y-3 opacity-0"}`}>CARABASAI STUDIO</span>
  </div>
  {mobileOpen && <button type="button" onClick={() => setMobileOpen(false)} className="fixed inset-0 z-[75] bg-black/75 backdrop-blur-sm md:hidden" aria-label="Close navigation" />}
  <aside className={`fixed bottom-0 left-0 top-0 z-[80] flex max-w-[88vw] flex-col border-r border-white/10 bg-[#080808] p-5 text-white transition-transform duration-200 md:translate-x-0 ${mobileOpen ? "translate-x-0" : "-translate-x-full"}`} style={{ width }}>
    <p className="text-[11px] font-black tracking-[0.2em] text-[#FFDF00]">CARABASAI STUDIO</p>
    <nav className="mt-6 grid gap-2">
      <Link href="/studio" className={`${item} ${homeActive ? "border-[#FFDF00] bg-[#FFDF00] text-black" : "border-white/10 bg-white/[0.025] text-white/65"}`}>STUDIO HOME <span>⌂</span></Link>
      <Link href="/account" className={`${item} ${accountActive ? "border-[#FFDF00] bg-[#FFDF00] text-black" : "border-white/10 bg-white/[0.025] text-white/65"}`}>MY ACCOUNT <span>○</span></Link>
      <a href="mailto:info@carabasai.com" className={`${item} border-white/10 bg-white/[0.025] text-white/65`}>HELP DESK <span className="text-[#FFDF00]">?</span></a>
    </nav>
    <div className="mt-auto border-t border-white/10 pt-4">
      <button type="button" onClick={() => { const next = !historyOpen; setHistoryOpen(next); localStorage.setItem("carabasaiSharedHistoryOpen", String(next)); }} className="flex w-full items-center justify-between py-2 text-[9px] font-black tracking-[0.14em] text-[#FFDF00]">SESSION HISTORY <span>{historyOpen ? "−" : "+"}</span></button>
      {historyOpen && <div className="mt-2 max-h-[42vh] space-y-2 overflow-x-hidden overflow-y-auto">{sessions.length ? sessions.map((session) => {
        const key = session.id ?? String(session.startedAt ?? session.notes);
        const swiped = swipedId === key;
        return <div key={key} className="relative overflow-hidden rounded-lg bg-red-950/40">
          <button type="button" onClick={() => void remove(session)} className="absolute bottom-0 right-0 top-0 flex w-16 items-center justify-center text-base text-red-400 md:hidden" aria-label="Delete project">⌫</button>
          <div
            className={`relative flex min-h-10 items-center gap-1 rounded-lg border border-white/8 bg-[#0B0B0B] px-2 transition-transform md:translate-x-0 ${swiped ? "-translate-x-16" : "translate-x-0"}`}
            onTouchStart={(event) => { const touch = event.touches[0]; itemSwipe.current = { x: touch.clientX, y: touch.clientY, id: key }; }}
            onTouchEnd={(event) => { const start = itemSwipe.current; const touch = event.changedTouches[0]; if (start?.id === key && start.x - touch.clientX > 45 && Math.abs(touch.clientY - start.y) < 45) setSwipedId(key); else if (start?.id === key && touch.clientX - start.x > 35) setSwipedId(null); itemSwipe.current = null; }}
          >
            {editingId === session.id ? <input autoFocus value={editingTitle} onChange={(event) => setEditingTitle(event.target.value)} onBlur={() => finishRename(session)} onKeyDown={(event) => { if (event.key === "Enter") finishRename(session); if (event.key === "Escape") setEditingId(null); }} className="min-w-0 flex-1 bg-transparent py-2 text-[9px] text-white outline-none" /> : <button type="button" onClick={() => openSession(session)} className="min-w-0 flex-1 truncate py-2 text-left text-[9px] text-white/50 hover:text-white">{session.title || session.notes || "UNTITLED SESSION"}</button>}
            <button type="button" onClick={() => toggleFavorite(session)} className={`h-7 w-7 shrink-0 text-sm ${session.favorite ? "text-[#FFDF00]" : "text-white/20 hover:text-white/60"}`} aria-label={session.favorite ? "Remove from favorites" : "Add to favorites"}>★</button>
            <button type="button" onClick={() => beginRename(session)} className="h-7 w-7 shrink-0 text-[11px] text-white/20 hover:text-[#FFDF00]" aria-label="Rename project">✎</button>
            <button type="button" onClick={() => void remove(session)} className="hidden h-7 w-7 shrink-0 text-[11px] text-white/20 hover:text-red-400 md:block" aria-label="Delete project">⌫</button>
          </div>
        </div>;
      }) : <p className="py-2 text-[8px] leading-4 text-white/20">YOUR SAVED SESSIONS WILL APPEAR HERE.</p>}</div>}
    </div>
    <button type="button" onPointerDown={resize} className="absolute bottom-0 right-0 top-0 hidden w-2 cursor-col-resize touch-none hover:bg-[#FFDF00]/20 md:block" aria-label="Resize navigation" />
  </aside></>;
}
