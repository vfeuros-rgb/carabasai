"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { PLATFORM_DIALOG_EVENT, PlatformDialogRequest } from "@/lib/platform-dialog";

export default function PlatformDialogHost() {
  const [queue, setQueue] = useState<PlatformDialogRequest[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const current = queue[0];

  useEffect(() => {
    const receive = (event: Event) => {
      setQueue((items) => [...items, (event as CustomEvent<PlatformDialogRequest>).detail]);
    };
    window.addEventListener(PLATFORM_DIALOG_EVENT, receive);
    return () => window.removeEventListener(PLATFORM_DIALOG_EVENT, receive);
  }, []);

  useEffect(() => {
    if (!current) return;
    if (current.kind === "prompt") requestAnimationFrame(() => inputRef.current?.select());
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") finish(current.kind === "prompt" ? null : false);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
    // finish is intentionally bound to the current queued request.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.id]);

  function finish(result: boolean | string | null) {
    if (!current) return;
    current.resolve(result);
    setQueue((items) => items.slice(1));
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!current) return;
    if (current.kind === "prompt") {
      const next = inputRef.current?.value.trim() ?? "";
      if (next) finish(next);
      return;
    }
    finish(true);
  }

  if (!current) return null;
  const danger = current.tone === "danger";

  return <div className="fixed inset-0 z-[500] flex items-center justify-center bg-black/80 px-5 py-8 backdrop-blur-sm" role="presentation">
    <form onSubmit={submit} role="dialog" aria-modal="true" aria-labelledby="platform-dialog-title" className={`w-full max-w-[520px] overflow-hidden rounded-[28px] border bg-[#090909] shadow-[0_30px_100px_rgba(0,0,0,.75)] ${danger ? "border-red-400/25" : "border-[#FFDF00]/25"}`}>
      <div className="h-1 w-full bg-[#FFDF00]" />
      <div className="p-7 sm:p-9">
        <p className={`mb-5 text-[9px] font-black tracking-[0.24em] ${danger ? "text-red-300" : "text-[#FFDF00]"}`}>{current.eyebrow ?? "CARABASAI STUDIO"}</p>
        <h2 id="platform-dialog-title" className="text-3xl font-black leading-[0.98] tracking-[-0.04em] text-white sm:text-4xl">{current.title}</h2>
        {current.message && <p className="mt-5 max-w-[420px] text-sm leading-6 text-white/45">{current.message}</p>}
        {current.kind === "prompt" && <input key={current.id} ref={inputRef} defaultValue={current.defaultValue ?? ""} className="mt-7 h-14 w-full rounded-2xl border border-white/12 bg-black px-5 text-base text-white outline-none transition focus:border-[#FFDF00]/60" aria-label="New value" />}
        <div className="mt-8 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          {current.kind !== "notice" && <button type="button" onClick={() => finish(current.kind === "prompt" ? null : false)} className="h-12 rounded-full border border-white/12 px-6 text-[9px] font-black tracking-[0.12em] text-white/45 transition hover:border-white/25 hover:text-white">{current.cancelLabel ?? "CANCEL"}</button>}
          <button type="submit" className={`h-12 rounded-full px-7 text-[9px] font-black tracking-[0.12em] text-black transition hover:brightness-110 ${danger ? "bg-red-300" : "bg-[#FFDF00]"}`}>{current.confirmLabel ?? (current.kind === "notice" ? "OK" : "CONFIRM")}</button>
        </div>
      </div>
    </form>
  </div>;
}
