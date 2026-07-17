"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import StudioSidebar from "../../components/StudioSidebar";
import WorkflowNav from "../../components/WorkflowNav";
import { characterCastingSpecialists, type CharacterCastingSpecialist } from "../../../lib/character-casting";

type CastingSession = {
  id?: string;
  projectDocument?: { title?: string; logline?: string; sections?: Array<{ title?: string; summary?: string; points?: string[] }> };
  characterCastingSpecialist?: CharacterCastingSpecialist;
  characterCasting?: { selectedCharacter?: string };
};

export default function CharacterCastingPage() {
  const [session, setSession] = useState<CastingSession | null>(null);
  const [portfolioOpen, setPortfolioOpen] = useState(false);
  const [selectedCharacter, setSelectedCharacter] = useState("");
  const [input, setInput] = useState("");

  useEffect(() => {
    const raw = sessionStorage.getItem("carabasaiCreativeSession");
    if (!raw) return;
    const restored = JSON.parse(raw) as CastingSession;
    setSession(restored);
    setSelectedCharacter(restored.characterCasting?.selectedCharacter ?? "");
  }, []);

  const specialist = session?.characterCastingSpecialist ?? characterCastingSpecialists[0];
  const projectContext = useMemo(() => {
    const document = session?.projectDocument;
    if (!document) return "your project";
    return [document.logline, ...(document.sections ?? []).flatMap((section) => [section.summary, ...(section.points ?? [])])]
      .filter(Boolean).join(" ").slice(0, 420);
  }, [session]);

  function chooseCharacter(image: string) {
    if (!session) return;
    const updated = { ...session, characterCasting: { ...session.characterCasting, selectedCharacter: image } };
    sessionStorage.setItem("carabasaiCreativeSession", JSON.stringify(updated));
    setSession(updated);
    setSelectedCharacter(image);
    setPortfolioOpen(false);
  }

  if (!session) {
    return <main className="min-h-screen bg-[#050505] text-white"><StudioSidebar /><div className="flex min-h-screen items-center justify-center"><p className="text-xs font-black text-[#FFDF00]">OPENING CASTING ROOM...</p></div></main>;
  }

  return <main className="min-h-screen bg-[#050505] px-4 pb-5 pt-20 text-white md:pl-[calc(var(--studio-sidebar-width,260px)+28px)] md:pt-5">
    <StudioSidebar />
    <WorkflowNav />
    <div className="mx-auto grid max-w-7xl gap-5 pt-12 lg:grid-cols-[280px_minmax(0,1fr)]">
      <aside className="space-y-4">
        <Link href="/studio/project" className="block text-[9px] font-black tracking-[.15em] text-white/35 hover:text-[#FFDF00]">← PROJECT DOCUMENT</Link>
        <button className="w-full rounded-[24px] border border-[#FFDF00]/25 bg-[#FFDF00]/[0.035] p-5 text-left">
          <div className="flex items-center gap-4"><Image src={specialist.portrait} alt="" width={68} height={68} className="h-16 w-16 rounded-2xl object-cover object-top"/><div><p className="text-[9px] font-black tracking-[.15em] text-[#FFDF00]">CASTING LEAD</p><h2 className="mt-2 text-lg font-black">{specialist.name}</h2><p className="mt-1 text-[9px] text-white/35">CHANGE SPECIALIST →</p></div></div>
        </button>
        <button onClick={() => setPortfolioOpen(true)} className="w-full rounded-full border border-white/10 px-5 py-3 text-[9px] font-black hover:border-[#FFDF00]/40">OPEN PORTFOLIO</button>
        <section className="rounded-[24px] border border-white/10 p-5"><div className="flex items-center justify-between"><p className="text-[9px] font-black tracking-[.14em] text-[#FFDF00]">CAST</p><button onClick={() => setPortfolioOpen(true)} className="text-xl text-[#FFDF00]">+</button></div>{selectedCharacter ? <Image src={selectedCharacter} alt="Selected character" width={180} height={320} className="mt-4 aspect-[9/16] w-full rounded-2xl object-cover object-top"/> : <p className="mt-4 text-[10px] leading-5 text-white/30">Choose an existing face or ask the casting lead to find a new one.</p>}</section>
      </aside>
      <section className="flex h-[calc(100dvh-125px)] min-h-[620px] flex-col overflow-hidden rounded-[28px] border border-white/10 bg-[#0A0A0A]">
        <header className="shrink-0 border-b border-white/10 p-6"><p className="text-[10px] font-black tracking-[.18em] text-[#FFDF00]">CHARACTER DEVELOPMENT</p><h1 className="mt-2 text-2xl font-black">CAST THE PEOPLE WHO CARRY THE STORY.</h1></header>
        <div className="min-h-0 flex-1 overflow-y-auto p-5 sm:p-7"><article className="flex gap-3"><Image src={specialist.portrait} alt="" width={40} height={40} className="h-10 w-10 rounded-full object-cover"/><div className="max-w-[78%] rounded-[22px] border border-[#FFDF00]/20 bg-[#17150b] p-5 text-white/75"><p className="text-[8px] font-black tracking-[.12em] text-[#FFDF00]">{specialist.name}</p><p className="mt-3 text-sm leading-6">I have read the project document. From what I can see, we need to cast the people who can carry this story before we touch costume. We can begin with a face already in my company, or you can describe someone new and I will build the casting brief.</p><p className="mt-3 text-xs leading-5 text-white/35">Project context: {projectContext}</p></div></article></div>
        <footer className="shrink-0 border-t border-white/10 p-4"><div className="flex items-end gap-3 rounded-[20px] border border-white/10 bg-black p-3"><textarea value={input} onChange={(event) => setInput(event.target.value)} placeholder="DIRECT THE CASTING..." className="min-h-12 flex-1 resize-none bg-transparent p-3 text-sm outline-none"/><button disabled={!input.trim()} className="rounded-full bg-[#FFDF00] px-6 py-4 text-[10px] font-black text-black disabled:opacity-25">SEND</button></div></footer>
      </section>
    </div>
    {portfolioOpen && <div className="fixed inset-0 z-[10000] bg-black/90 p-3 backdrop-blur-md"><section className="mx-auto flex h-full max-w-5xl flex-col overflow-hidden rounded-[26px] border border-white/10 bg-[#090909]"><header className="flex items-center justify-between p-5"><div><p className="text-[10px] font-black text-[#FFDF00]">{specialist.name} / PORTFOLIO</p><h2 className="mt-2 text-xl font-black">CHOOSE A CASTING TYPE.</h2></div><button onClick={() => setPortfolioOpen(false)} className="text-3xl text-white/45">×</button></header><div className="min-h-0 flex-1 overflow-y-auto"><div className="grid grid-cols-2 gap-0 sm:grid-cols-4">{specialist.characterExamples.map((character) => <button key={character.image} onClick={() => chooseCharacter(character.image)} className={`relative aspect-[9/16] overflow-hidden ${selectedCharacter === character.image ? "ring-4 ring-inset ring-[#FFDF00]" : ""}`}><Image src={character.image} alt={character.alt} fill sizes="25vw" className="object-cover object-top"/></button>)}</div></div></section></div>}
  </main>;
}
