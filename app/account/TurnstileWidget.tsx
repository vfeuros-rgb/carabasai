"use client";

import Script from "next/script";
import { useCallback, useEffect, useRef, useState } from "react";

declare global {
  interface Window {
    turnstile?: {
      render: (element: HTMLElement, options: { sitekey: string; theme: string; size: "flexible"; callback: (token: string) => void; "expired-callback": () => void; "error-callback": () => void }) => string;
      remove: (id: string) => void;
    };
  }
}

export default function TurnstileWidget({ onToken }: { onToken: (token: string) => void }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetRef = useRef<string | null>(null);
  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? "1x00000000000000000000AA";
  const [verified, setVerified] = useState(false);
  const [failed, setFailed] = useState(false);
  const [scriptVersion, setScriptVersion] = useState(0);

  const retry = useCallback(() => {
    if (widgetRef.current && window.turnstile) window.turnstile.remove(widgetRef.current);
    widgetRef.current = null;
    if (containerRef.current) containerRef.current.replaceChildren();
    setVerified(false);
    setFailed(false);
    onToken("");
    setScriptVersion((value) => value + 1);
  }, [onToken]);

  const render = useCallback(() => {
    if (!window.turnstile || !containerRef.current || widgetRef.current) return;
    try {
      widgetRef.current = window.turnstile.render(containerRef.current, {
        sitekey: siteKey,
        theme: "dark",
        size: "flexible",
        callback: (token) => { setFailed(false); setVerified(true); onToken(token); },
        "expired-callback": () => { setVerified(false); onToken(""); },
        "error-callback": () => { setFailed(true); setVerified(false); onToken(""); },
      });
    } catch {
      setFailed(true);
    }
  }, [onToken, siteKey]);

  useEffect(() => {
    render();
    const polling = window.setInterval(render, 300);
    const timeout = window.setTimeout(() => {
      if (!widgetRef.current && !verified) setFailed(true);
    }, 8000);
    return () => {
      window.clearInterval(polling);
      window.clearTimeout(timeout);
      if (widgetRef.current && window.turnstile) window.turnstile.remove(widgetRef.current);
      widgetRef.current = null;
    };
  }, [render, scriptVersion]);

  return <div className="w-full overflow-hidden rounded-[14px] border border-white/10 bg-black/20 p-3"><Script key={scriptVersion} src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit" strategy="afterInteractive" onLoad={render} onReady={render} onError={() => setFailed(true)} /><div className={`${verified ? "hidden" : "flex"} min-h-[65px] w-full items-center justify-center overflow-hidden`}><div ref={containerRef} className="w-full [&>div]:mx-auto [&>div]:max-w-full" /></div><div className={`flex items-center px-1 text-[9px] font-black ${verified ? "justify-center py-3" : "mt-2 justify-between"} ${failed ? "text-red-300" : verified ? "text-emerald-300" : "text-white/30"}`}><span>{failed ? "SECURITY CHECK COULD NOT LOAD." : verified ? "SECURITY CHECK COMPLETED" : "SECURITY CHECK"}</span>{failed && <button type="button" onClick={retry} className="border border-red-300/30 px-3 py-2 text-[8px] text-red-200">RETRY</button>}</div></div>;
}
