"use client";

import { useEffect, useState } from "react";

export type AIProvider = "anthropic" | "openai";

export function currentAIProvider(): AIProvider {
  return localStorage.getItem("carabasaiAIProvider") === "openai" ? "openai" : "anthropic";
}

export default function AIProviderSwitch() {
  const [provider, setProvider] = useState<AIProvider>("anthropic");

  useEffect(() => {
    // Restore the preference only after browser hydration.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setProvider(currentAIProvider());
  }, []);

  function select(next: AIProvider) {
    setProvider(next);
    localStorage.setItem("carabasaiAIProvider", next);
  }

  return (
    <div className="flex rounded-full border border-white/12 bg-[#101010]/95 p-0.5 text-[7px] font-black tracking-[0.08em]" aria-label="AI model provider">
      <button type="button" onClick={() => select("anthropic")} className={`rounded-full px-2.5 py-1.5 transition ${provider === "anthropic" ? "bg-[#FFDF00] text-black" : "text-white/35 hover:text-white"}`}>CLAUDE</button>
      <button type="button" onClick={() => select("openai")} className={`rounded-full px-2.5 py-1.5 transition ${provider === "openai" ? "bg-[#FFDF00] text-black" : "text-white/35 hover:text-white"}`}>GPT</button>
    </div>
  );
}
