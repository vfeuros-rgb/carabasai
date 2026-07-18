"use client";

import { useCallback, useEffect, useState } from "react";

const ACKNOWLEDGED_VERSION_KEY = "carabasaiAcknowledgedSiteVersion";
const DISMISSED_VERSION_KEY = "carabasaiDismissedSiteVersion";

export default function SiteUpdateBanner({ buildVersion }: { buildVersion: string }) {
  const [availableVersion, setAvailableVersion] = useState("");

  const considerVersion = useCallback((version: string) => {
    if (!version) return;
    const acknowledged = localStorage.getItem(ACKNOWLEDGED_VERSION_KEY);
    const dismissed = sessionStorage.getItem(DISMISSED_VERSION_KEY);
    if (version !== acknowledged && version !== dismissed) setAvailableVersion(version);
  }, []);

  useEffect(() => {
    considerVersion(buildVersion);
    const checkForUpdate = async () => {
      try {
        const response = await fetch(`/api/version?t=${Date.now()}`, { cache: "no-store" });
        if (!response.ok) return;
        const payload = await response.json() as { version?: string };
        if (payload.version && payload.version !== buildVersion) considerVersion(payload.version);
      } catch {
        // Version checks must never interrupt studio work.
      }
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") void checkForUpdate();
    };
    const interval = window.setInterval(() => void checkForUpdate(), 60_000);
    window.addEventListener("focus", checkForUpdate);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", checkForUpdate);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [buildVersion, considerVersion]);

  if (!availableVersion) return null;
  return (
    <aside className="fixed inset-x-0 top-0 z-[25000] flex min-h-14 items-center justify-between gap-4 bg-[#FFDF00] px-4 py-3 text-black shadow-[0_8px_30px_rgba(0,0,0,.38)] sm:px-7" role="status" aria-live="polite">
      <div className="min-w-0">
        <p className="text-[10px] font-black tracking-[.12em] sm:text-xs">A NEW VERSION OF CARABASAI STUDIO IS AVAILABLE.</p>
        <p className="mt-1 hidden text-[9px] font-bold text-black/60 sm:block">Update to load the latest fixes and features.</p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <button type="button" onClick={() => { sessionStorage.setItem(DISMISSED_VERSION_KEY, availableVersion); setAvailableVersion(""); }} className="rounded-full border border-black/25 px-4 py-2 text-[9px] font-black hover:bg-black/10">LATER</button>
        <button type="button" onClick={() => { localStorage.setItem(ACKNOWLEDGED_VERSION_KEY, availableVersion); window.location.reload(); }} className="rounded-full bg-black px-4 py-2 text-[9px] font-black text-[#FFDF00] hover:bg-black/80 sm:px-5">UPDATE NOW</button>
      </div>
    </aside>
  );
}
