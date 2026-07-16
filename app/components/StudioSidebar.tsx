"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import { PointerEvent, useEffect, useRef, useState } from "react";
import { ACTIVE_PROJECT_KEY, deleteProject, getCachedProjects, projectChangeEvent, saveProjects, setProjectFavorite, syncProjects } from "../../lib/project-store";
import { platformConfirm } from "../../lib/platform-dialog";

type SavedSession = { id?: string; title?: string; notes?: string; startedAt?: number; favorite?: boolean; projectDocument?: unknown; messages?: unknown[] };

export default function StudioSidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const [width, setWidth] = useState(260);
  const [historyOpen, setHistoryOpen] = useState(true);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [sessions, setSessions] = useState<SavedSession[]>([]);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState("");
  const [actionMenuId, setActionMenuId] = useState<string | null>(null);
  const [swipedId, setSwipedId] = useState<string | null>(null);
  const [favoriteSwipedId, setFavoriteSwipedId] = useState<string | null>(null);
  const [mobileBrandVisible, setMobileBrandVisible] = useState(true);
  const [deletedCurrentTitle, setDeletedCurrentTitle] = useState<string | null>(null);
  const menuSwipe = useRef<{ x: number; y: number } | null>(null);
  const itemSwipe = useRef<{ x: number; y: number; id: string } | null>(null);
  const lastScrollY = useRef(0);
  const scrollDirectionStart = useRef(0);

  useEffect(() => {
    const restore = () => {
      const savedWidth = Number(localStorage.getItem("carabasaiHistoryWidth"));
      setWidth(savedWidth >= 220 && savedWidth <= 480 ? savedWidth : 260);
      setHistoryOpen(localStorage.getItem("carabasaiSharedHistoryOpen") !== "false");
      setAccountMenuOpen(localStorage.getItem("carabasaiAccountMenuOpen") === "true" || window.location.pathname.startsWith("/account/"));
      setSessions(getCachedProjects<SavedSession>());
      try { setActiveProjectId((JSON.parse(sessionStorage.getItem("carabasaiCreativeSession") ?? "null") as SavedSession | null)?.id ?? localStorage.getItem(ACTIVE_PROJECT_KEY)); } catch { setActiveProjectId(localStorage.getItem(ACTIVE_PROJECT_KEY)); }
    };
    queueMicrotask(restore);
    window.addEventListener("carabasai-sidebar-change", restore);
    window.addEventListener("storage", restore);
    window.addEventListener(projectChangeEvent, restore);
    const refreshCloud = () => void syncProjects<SavedSession>().then(setSessions).catch(console.error);
    const refreshWhenVisible = () => { if (document.visibilityState === "visible") refreshCloud(); };
    refreshCloud();
    const cloudRefreshTimer = window.setInterval(refreshCloud, 15000);
    window.addEventListener("focus", refreshCloud);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => { window.clearInterval(cloudRefreshTimer); window.removeEventListener("carabasai-sidebar-change", restore); window.removeEventListener("storage", restore); window.removeEventListener(projectChangeEvent, restore); window.removeEventListener("focus", refreshCloud); document.removeEventListener("visibilitychange", refreshWhenVisible); };
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
        if (scrollDirectionStart.current - current > 96) setMobileBrandVisible(true);
        if (lastScrollY.current > scrollDirectionStart.current) scrollDirectionStart.current = lastScrollY.current;
      }
      lastScrollY.current = current;
    };
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  useEffect(() => {
    const menuSwipeIsBlocked = (target?: EventTarget | null) => {
      const element = target instanceof HTMLElement ? target : null;
      return Boolean(
        document.querySelector("[role='dialog'][aria-modal='true']") ||
        element?.closest("input, textarea, select, [contenteditable='true'], [data-disable-menu-swipe], [role='dialog'], [aria-modal='true']"),
      );
    };
    const start = (event: globalThis.TouchEvent) => {
      if (mobileOpen || event.touches.length !== 1) return;
      if (menuSwipeIsBlocked(event.target)) {
        menuSwipe.current = null;
        return;
      }
      const touch = event.touches[0];
      menuSwipe.current = { x: touch.clientX, y: touch.clientY };
    };
    const move = (event: globalThis.TouchEvent) => {
      if (menuSwipeIsBlocked(event.target)) {
        menuSwipe.current = null;
        return;
      }
      const origin = menuSwipe.current;
      const touch = event.touches[0];
      if (!origin || !touch) return;
      const horizontal = touch.clientX - origin.x;
      const vertical = Math.abs(touch.clientY - origin.y);
      if (horizontal > 34 && vertical < 50) {
        setMobileOpen(true);
        menuSwipe.current = null;
      } else if (horizontal < -12 || vertical > 70) {
        menuSwipe.current = null;
      }
    };
    const end = () => {
      menuSwipe.current = null;
    };
    document.addEventListener("touchstart", start, { passive: true });
    document.addEventListener("touchmove", move, { passive: true });
    document.addEventListener("touchend", end, { passive: true });
    document.addEventListener("touchcancel", end, { passive: true });
    return () => { document.removeEventListener("touchstart", start); document.removeEventListener("touchmove", move); document.removeEventListener("touchend", end); document.removeEventListener("touchcancel", end); };
  }, [mobileOpen]);

  function openSession(session: SavedSession) {
    sessionStorage.setItem("carabasaiCreativeSession", JSON.stringify(session));
    if (session.id) localStorage.setItem(ACTIVE_PROJECT_KEY, session.id);
    setActiveProjectId(session.id ?? null);
    router.push(session.projectDocument ? "/studio/project" : session.messages?.length ? "/studio/creative-room" : "/studio");
  }

  function persist(next: SavedSession[]) {
    const sorted = [...next].sort((a, b) => Number(Boolean(b.favorite)) - Number(Boolean(a.favorite)));
    setSessions(sorted);
    saveProjects(sorted);
  }

  function toggleFavorite(session: SavedSession) {
    const favorite = !session.favorite;
    const sorted = sessions.map((item) => item.id === session.id ? { ...item, favorite } : item)
      .sort((a, b) => Number(Boolean(b.favorite)) - Number(Boolean(a.favorite)));
    setSessions(sorted);
    if (session.id) void setProjectFavorite(session.id, favorite).catch(console.error);
    setFavoriteSwipedId(null);
  }

  function beginRename(session: SavedSession) {
    setEditingId(session.id ?? null);
    setEditingTitle(session.title || session.notes || "Untitled project");
    setActionMenuId(null);
  }

  function finishRename(session: SavedSession) {
    const title = editingTitle.trim();
    if (title) persist(sessions.map((item) => item.id === session.id ? { ...item, title } : item));
    setEditingId(null);
  }

  async function remove(session: SavedSession) {
    if (!session.id) return;
    const projectName = session.title || session.notes || "UNTITLED PROJECT";
    const confirmed = await platformConfirm({ eyebrow: "PROJECT ACTION", title: "DELETE PROJECT?", message: `“${projectName}” will be permanently removed from your studio and every synced device.`, confirmLabel: "DELETE PROJECT", tone: "danger" });
    if (!confirmed) return;
    const wasCurrentProject = session.id === activeProjectId;
    const deletedTitle = (session.title || session.notes || "UNTITLED PROJECT").slice(0, 80);
    setSessions((current) => current.filter((item) => item.id !== session.id));
    setSwipedId(null);
    setFavoriteSwipedId(null);
    setActionMenuId(null);
    await deleteProject(session.id);
    if (wasCurrentProject) {
      sessionStorage.removeItem("carabasaiCreativeSession");
      localStorage.removeItem(ACTIVE_PROJECT_KEY);
      setActiveProjectId(null);
      setMobileOpen(false);
      setDeletedCurrentTitle(deletedTitle);
    }
  }

  const workspaceActive = pathname === "/account";
  const accountActive = pathname.startsWith("/account/");
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
      <Link href="/account" onClick={() => setMobileOpen(false)} className={`${item} ${workspaceActive ? "border-[#FFDF00] bg-[#FFDF00] text-black" : "border-white/10 bg-white/[0.025] text-white/65"}`}>WORKSPACE <span>▦</span></Link>
      <button type="button" onClick={() => { const next = !accountMenuOpen; setAccountMenuOpen(next); localStorage.setItem("carabasaiAccountMenuOpen", String(next)); }} className={`${item} ${accountActive ? "border-[#FFDF00] bg-[#FFDF00] text-black" : "border-white/10 bg-white/[0.025] text-white/65"}`}>MY ACCOUNT <span className={`transition-transform ${accountMenuOpen ? "rotate-180" : ""}`}>⌄</span></button>
      {accountMenuOpen && <div className="grid gap-1.5 pl-3">
        <Link href="/account/settings" onClick={() => setMobileOpen(false)} className={`flex h-9 items-center justify-between rounded-lg border px-3 text-[8px] font-black tracking-[0.12em] ${pathname === "/account/settings" ? "border-[#FFDF00]/45 bg-[#FFDF00]/10 text-[#FFDF00]" : "border-white/8 bg-black/20 text-white/45 hover:text-white"}`}>SETTINGS <span>⚙</span></Link>
        <Link href="/account/subscription" onClick={() => setMobileOpen(false)} className={`flex h-9 items-center justify-between rounded-lg border px-3 text-[8px] font-black tracking-[0.12em] ${pathname === "/account/subscription" ? "border-[#FFDF00]/45 bg-[#FFDF00]/10 text-[#FFDF00]" : "border-white/8 bg-black/20 text-white/45 hover:text-white"}`}>SUBSCRIPTION <span>◇</span></Link>
        <Link href="/account/credits" onClick={() => setMobileOpen(false)} className={`flex h-9 items-center justify-between rounded-lg border px-3 text-[8px] font-black tracking-[0.12em] ${pathname === "/account/credits" ? "border-[#FFDF00]/45 bg-[#FFDF00]/10 text-[#FFDF00]" : "border-white/8 bg-black/20 text-white/45 hover:text-white"}`}>BUY CREDITS <span>＋</span></Link>
      </div>}
      <a href="mailto:info@carabasai.com" className={`${item} border-white/10 bg-white/[0.025] text-white/65`}>HELP DESK <span className="text-[#FFDF00]">?</span></a>
    </nav>
    <div className="mt-auto border-t border-white/10 pt-4">
      <button type="button" onClick={() => { const next = !historyOpen; setHistoryOpen(next); localStorage.setItem("carabasaiSharedHistoryOpen", String(next)); }} className="flex w-full items-center justify-between py-2 text-[9px] font-black tracking-[0.14em] text-[#FFDF00]">SESSION HISTORY <span>{historyOpen ? "−" : "+"}</span></button>
      {historyOpen && <div className="mt-2 max-h-[42vh] space-y-2 overflow-x-hidden overflow-y-auto">{sessions.length ? sessions.map((session) => {
        const key = session.id ?? String(session.startedAt ?? session.notes);
        const swiped = swipedId === key;
        const favoriteSwiped = favoriteSwipedId === key;
        const selected = Boolean(session.id && session.id === activeProjectId);
        return <div key={key} className={`relative overflow-hidden rounded-lg ${swiped ? "bg-red-950/40" : favoriteSwiped ? "bg-[#FFDF00]/20" : "bg-transparent"}`}>
          {favoriteSwiped && <button type="button" onClick={() => toggleFavorite(session)} className="absolute bottom-0 left-0 top-0 flex w-16 items-center justify-center text-lg text-[#FFDF00] md:hidden" aria-label={session.favorite ? "Remove project from favorites" : "Add project to favorites"}>★</button>}
          {swiped && <button type="button" onClick={() => void remove(session)} className="absolute bottom-0 right-0 top-0 flex w-16 items-center justify-center text-base text-red-400 md:hidden" aria-label="Delete project">⌫</button>}
          <div
            className={`relative flex min-h-10 items-center gap-1 rounded-lg border px-2 transition-all md:translate-x-0 ${selected ? "border-[#FFDF00]/60 bg-[#FFDF00]/10 shadow-[inset_3px_0_0_#FFDF00]" : "border-white/8 bg-[#0B0B0B]"} ${swiped ? "-translate-x-16" : favoriteSwiped ? "translate-x-16" : "translate-x-0"}`}
            onTouchStart={(event) => { const touch = event.touches[0]; itemSwipe.current = { x: touch.clientX, y: touch.clientY, id: key }; }}
            onTouchEnd={(event) => {
              const start = itemSwipe.current;
              const touch = event.changedTouches[0];
              const horizontal = start ? touch.clientX - start.x : 0;
              const vertical = start ? Math.abs(touch.clientY - start.y) : 999;
              if (start?.id === key && vertical < 45) {
                if (swiped && horizontal > 35) {
                  setSwipedId(null);
                } else if (favoriteSwiped && horizontal < -35) {
                  setFavoriteSwipedId(null);
                } else if (!swiped && !favoriteSwiped && horizontal < -45) {
                  setSwipedId(key);
                } else if (!swiped && !favoriteSwiped && horizontal > 45) {
                  setFavoriteSwipedId(key);
                }
              }
              itemSwipe.current = null;
            }}
          >
            {editingId === session.id ? <input autoFocus value={editingTitle} onChange={(event) => setEditingTitle(event.target.value)} onBlur={() => finishRename(session)} onKeyDown={(event) => { if (event.key === "Enter") finishRename(session); if (event.key === "Escape") setEditingId(null); }} className="min-w-0 flex-1 bg-transparent py-2 text-[9px] text-white outline-none" /> : <button type="button" onClick={() => openSession(session)} className={`min-w-0 flex-1 truncate py-2 text-left text-[9px] hover:text-white ${selected ? "font-bold text-[#FFDF00]" : "text-white/50"}`}>{session.title || session.notes || "UNTITLED SESSION"}</button>}
            {session.favorite && <button type="button" onClick={(event) => { event.stopPropagation(); toggleFavorite(session); }} className="flex h-7 w-7 shrink-0 items-center justify-center text-xs text-[#FFDF00] hover:text-white" title="Remove from favorites" aria-label="Remove project from favorites">★</button>}
            <button type="button" onClick={() => { setSwipedId(null); setFavoriteSwipedId(null); setActionMenuId((current) => current === key ? null : key); }} className="h-7 w-7 shrink-0 text-base leading-none text-white/35 hover:text-[#FFDF00]" aria-label="Project actions">⋮</button>
          </div>
          {actionMenuId === key && <div className="relative z-10 grid gap-1 border-t border-white/8 bg-[#0D0D0D] p-1.5">
            <button type="button" onClick={() => beginRename(session)} className="flex h-8 items-center justify-between rounded-md px-2 text-left text-[8px] font-black tracking-[0.1em] text-white/50 hover:bg-white/5 hover:text-white">RENAME <span>✎</span></button>
            <button type="button" onClick={() => { toggleFavorite(session); setActionMenuId(null); }} className="flex h-8 items-center justify-between rounded-md px-2 text-left text-[8px] font-black tracking-[0.1em] text-white/50 hover:bg-white/5 hover:text-white">{session.favorite ? "REMOVE FAVORITE" : "ADD TO FAVORITES"} <span className={session.favorite ? "text-[#FFDF00]" : "text-white/25"}>★</span></button>
            <button type="button" onClick={() => void remove(session)} className="flex h-8 items-center justify-between rounded-md px-2 text-left text-[8px] font-black tracking-[0.1em] text-red-400/65 hover:bg-red-500/5 hover:text-red-400">DELETE <span>⌫</span></button>
          </div>}
        </div>;
      }) : <p className="py-2 text-[8px] leading-4 text-white/20">YOUR SAVED SESSIONS WILL APPEAR HERE.</p>}</div>}
    </div>
    <button type="button" onPointerDown={resize} className="absolute bottom-0 right-0 top-0 hidden w-2 cursor-col-resize touch-none hover:bg-[#FFDF00]/20 md:block" aria-label="Resize navigation" />
  </aside>
  {deletedCurrentTitle && (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/85 p-5 text-white backdrop-blur-md">
      <section role="dialog" aria-modal="true" aria-labelledby="deleted-project-title" className="w-full max-w-md rounded-[28px] border border-[#FFDF00]/25 bg-[#0A0A0A] p-7 text-center shadow-[0_30px_100px_rgba(0,0,0,0.8)] sm:p-9">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full border border-[#FFDF00]/35 bg-[#FFDF00]/10 text-xl text-[#FFDF00]">⌫</div>
        <p className="mt-6 text-[9px] font-black tracking-[0.18em] text-[#FFDF00]">CARABASAI STUDIO</p>
        <h2 id="deleted-project-title" className="mt-3 text-2xl font-black tracking-[-0.04em]">PROJECT DELETED.</h2>
        <p className="mx-auto mt-4 max-w-sm text-sm leading-6 text-white/45">
          “{deletedCurrentTitle}” is no longer in your studio. Return to Studio Home and begin a new project.
        </p>
        <button type="button" onClick={() => window.location.assign("/studio")} className="mt-7 h-12 w-full rounded-full bg-[#FFDF00] text-[10px] font-black tracking-[0.08em] text-black transition hover:bg-white">
          START A NEW PROJECT
        </button>
      </section>
    </div>
  )}
  </>;
}
