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

  const render = useCallback(() => {
    if (!window.turnstile || !containerRef.current || widgetRef.current) return;
    widgetRef.current = window.turnstile.render(containerRef.current, {
      sitekey: siteKey,
      theme: "dark",
      size: "flexible",
      callback: (token) => { setFailed(false); setVerified(true); onToken(token); },
      "expired-callback": () => { setVerified(false); onToken(""); },
      "error-callback": () => { setFailed(true); setVerified(false); onToken(""); },
    });
  }, [onToken, siteKey]);

  useEffect(() => {
    render();
    const retry = window.setInterval(render, 300);
    return () => {
      window.clearInterval(retry);
      if (widgetRef.current && window.turnstile) window.turnstile.remove(widgetRef.current);
      widgetRef.current = null;
    };
  }, [render]);

  return <div className="w-full overflow-hidden rounded-[14px] border border-white/10 bg-black/20 p-3"><Script src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit" strategy="afterInteractive" onLoad={render} onReady={render} /><div className={`${verified ? "hidden" : "flex"} min-h-[65px] w-full items-center justify-center overflow-hidden`}><div ref={containerRef} className="w-full [&>div]:mx-auto [&>div]:max-w-full" /></div><p className={`px-1 text-[9px] font-black ${verified ? "py-3 text-center" : "mt-2"} ${failed ? "text-red-300" : verified ? "text-emerald-300" : "text-white/30"}`}>{failed ? "SECURITY CHECK COULD NOT LOAD. PLEASE REFRESH." : verified ? "SECURITY CHECK COMPLETED" : "SECURITY CHECK"}</p></div>;
}
