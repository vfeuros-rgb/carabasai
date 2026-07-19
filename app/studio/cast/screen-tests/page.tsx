"use client";

import Image from "next/image";
import { useEffect, useMemo, useState } from "react";
import StudioSidebar from "../../../components/StudioSidebar";
import {
  getCachedProjectsIncludingLibrary,
  projectChangeEvent,
  syncProjects,
  type StoredProject,
} from "../../../../lib/project-store";

type GeneratedActor = {
  image: string;
  actorName?: string;
  storagePath?: string;
  source?: "portfolio" | "generated";
};

type GenerationMessage = {
  image?: string;
  candidate?: GeneratedActor;
  projectTitle?: string;
};

type CastingProject = StoredProject & {
  title?: string;
  notes?: string;
  characterCasting?: { generationMessages?: GenerationMessage[] };
};

type ScreenTest = GeneratedActor & { projectTitle: string };

const actorKey = (actor: GeneratedActor) => actor.storagePath ?? actor.image;

function collectScreenTests(projects: CastingProject[]) {
  const unique = new Map<string, ScreenTest>();
  for (const project of projects) {
    const projectTitle = project.title || project.notes || "UNTITLED PROJECT";
    for (const message of project.characterCasting?.generationMessages ?? []) {
      if (!message.image || !message.candidate) continue;
      const actor = { ...message.candidate, image: message.image, projectTitle: message.projectTitle || projectTitle };
      unique.set(actorKey(actor), actor);
    }
  }
  return [...unique.values()];
}

export default function ScreenTestsPage() {
  const [projects, setProjects] = useState<CastingProject[]>([]);
  const [preview, setPreview] = useState<ScreenTest | null>(null);

  useEffect(() => {
    const loadLocal = () => setProjects(getCachedProjectsIncludingLibrary<CastingProject>());
    loadLocal();
    void syncProjects<CastingProject>({ includeLibrary: true }).then(setProjects).catch(console.error);
    window.addEventListener(projectChangeEvent, loadLocal);
    return () => window.removeEventListener(projectChangeEvent, loadLocal);
  }, []);

  const actors = useMemo(() => collectScreenTests(projects), [projects]);

  return (
    <main className="min-h-screen bg-black text-white md:pl-[var(--studio-sidebar-width,260px)]">
      <StudioSidebar />
      <div className="mx-auto max-w-[1500px] px-5 pb-16 pt-24 md:px-12 md:pt-14">
        <p className="text-[9px] font-black tracking-[.18em] text-[#FFDF00]">PROJECT CHARACTER ARCHIVE</p>
        <div className="mt-3 flex items-end justify-between gap-4 border-b border-white/10 pb-8">
          <div>
            <h1 className="text-4xl font-black md:text-6xl">SCREEN TESTS.</h1>
            <p className="mt-3 max-w-2xl text-sm text-white/35">Every character generated during casting across all your projects.</p>
          </div>
          <span className="text-[9px] font-black text-white/30">{actors.length} TESTS</span>
        </div>

        {actors.length ? (
          <div className="mt-8 grid grid-cols-2 gap-0 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-6">
            {actors.map((actor) => (
              <button key={actorKey(actor)} onClick={() => setPreview(actor)} className="group relative aspect-[9/16] overflow-hidden bg-[#080808] hover:z-10 hover:shadow-[0_0_35px_8px_rgba(255,223,0,.35)] hover:ring-2 hover:ring-inset hover:ring-[#FFDF00]">
                <Image src={actor.image} alt={actor.actorName ?? "Generated actor"} fill sizes="20vw" unoptimized={actor.image.startsWith("http")} className="object-cover object-top" />
                <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black via-black/45 to-transparent px-3 pb-3 pt-20 text-left">
                  <p className="text-xs font-black">{actor.actorName ?? "CASTING ACTOR"}</p>
                  <p className="mt-1 truncate text-[7px] font-black text-[#FFDF00]">{actor.projectTitle}</p>
                </div>
              </button>
            ))}
          </div>
        ) : (
          <div className="mt-8 flex min-h-[360px] items-center justify-center rounded-[26px] border border-white/10 text-center text-sm text-white/30">Generated project characters will appear here after their screen tests.</div>
        )}
      </div>

      {preview && (
        <div role="dialog" aria-modal="true" className="fixed inset-0 z-[11000] flex items-center justify-center overflow-y-auto p-4 sm:p-8">
          <Image src={preview.image} alt="" fill unoptimized={preview.image.startsWith("http")} className="-z-20 scale-110 object-cover blur-3xl" />
          <div className="absolute inset-0 -z-10 bg-black/75 backdrop-blur-xl" />
          <button onClick={() => setPreview(null)} className="fixed right-5 top-5 flex h-11 w-11 items-center justify-center rounded-full border border-white/15 bg-black/55 text-2xl text-white/60">×</button>
          <section className="w-full max-w-[430px]">
            <div className="relative mx-auto aspect-[9/16] max-h-[78dvh] overflow-hidden rounded-[24px] border border-white/15 bg-black shadow-2xl">
              <Image src={preview.image} alt={preview.actorName ?? "Generated actor"} fill sizes="430px" unoptimized={preview.image.startsWith("http")} className="object-cover object-top" />
              <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black via-black/35 to-transparent px-5 pb-5 pt-20">
                <p className="text-lg font-black">{preview.actorName ?? "CASTING ACTOR"}</p>
                <p className="mt-1 text-[9px] font-black text-[#FFDF00]">{preview.projectTitle}</p>
              </div>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}
