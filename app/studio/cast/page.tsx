"use client";

import Image from "next/image";
import { useEffect, useMemo, useState } from "react";
import StudioSidebar from "../../components/StudioSidebar";
import {
  getCachedProjects,
  projectChangeEvent,
  syncProjects,
  type StoredProject,
} from "../../../lib/project-store";

type SavedActor = {
  image: string;
  actorName?: string;
  storagePath?: string;
  source: "portfolio" | "generated";
  description?: string;
};

type CastingProject = StoredProject & {
  characterCasting?: { myCast?: SavedActor[] };
};

const actorKey = (actor: SavedActor) => actor.storagePath ?? actor.image;

function collectActors(projects: CastingProject[]) {
  const unique = new Map<string, SavedActor>();
  for (const project of projects) {
    for (const actor of project.characterCasting?.myCast ?? []) {
      unique.set(actorKey(actor), actor);
    }
  }
  return [...unique.values()];
}

export default function CastLibraryPage() {
  const [projects, setProjects] = useState<CastingProject[]>([]);
  const [preview, setPreview] = useState<SavedActor | null>(null);

  useEffect(() => {
    const loadLocal = () => setProjects(getCachedProjects<CastingProject>());
    loadLocal();
    void syncProjects<CastingProject>().then(setProjects).catch(console.error);
    window.addEventListener(projectChangeEvent, loadLocal);
    return () => window.removeEventListener(projectChangeEvent, loadLocal);
  }, []);

  const actors = useMemo(() => collectActors(projects), [projects]);

  return (
    <main className="min-h-screen bg-black text-white md:pl-[var(--studio-sidebar-width,260px)]">
      <StudioSidebar />
      <div className="mx-auto max-w-[1500px] px-5 pb-16 pt-24 md:px-12 md:pt-14">
        <p className="text-[9px] font-black tracking-[.18em] text-[#FFDF00]">
          ACCOUNT CAST LIBRARY
        </p>
        <div className="mt-3 flex items-end justify-between gap-4 border-b border-white/10 pb-8">
          <div>
            <h1 className="text-4xl font-black md:text-6xl">MY CAST.</h1>
            <p className="mt-3 max-w-2xl text-sm text-white/35">
              Actors saved from generated casting sessions. The same library is
              available from every project.
            </p>
          </div>
          <span className="text-[9px] font-black text-white/30">
            {actors.length} ACTORS
          </span>
        </div>

        {actors.length ? (
          <div className="mt-8 grid grid-cols-2 gap-0 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-6">
            {actors.map((actor) => (
              <button
                key={actorKey(actor)}
                onClick={() => setPreview(actor)}
                className="group relative aspect-[9/16] overflow-hidden bg-[#080808] hover:z-10 hover:shadow-[0_0_35px_8px_rgba(255,223,0,.35)] hover:ring-2 hover:ring-inset hover:ring-[#FFDF00]"
              >
                <Image
                  src={actor.image}
                  alt={actor.actorName ?? "Saved actor"}
                  fill
                  sizes="20vw"
                  unoptimized={actor.image.startsWith("http")}
                  className="object-cover object-top"
                />
                <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black via-black/45 to-transparent px-3 pb-3 pt-20 text-left">
                  <p className="text-xs font-black">
                    {actor.actorName ?? "CASTING ACTOR"}
                  </p>
                  <p className="mt-1 text-[7px] font-black text-[#FFDF00]">
                    {actor.source.toUpperCase()}
                  </p>
                </div>
              </button>
            ))}
          </div>
        ) : (
          <div className="mt-8 flex min-h-[360px] items-center justify-center rounded-[26px] border border-white/10 text-center text-sm text-white/30">
            Open a generated candidate in Character Casting and choose ADD TO MY
            CAST.
          </div>
        )}
      </div>

      {preview && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-[11000] flex items-start justify-center overflow-y-auto p-4 sm:p-8 lg:items-center"
        >
          <Image
            src={preview.image}
            alt=""
            fill
            unoptimized={preview.image.startsWith("http")}
            className="-z-20 scale-110 object-cover blur-3xl"
          />
          <div className="absolute inset-0 -z-10 bg-black/75 backdrop-blur-xl" />
          <button
            onClick={() => setPreview(null)}
            className="fixed right-5 top-5 flex h-11 w-11 items-center justify-center rounded-full border border-white/15 bg-black/55 text-2xl text-white/60"
          >
            ×
          </button>
          <section className="grid w-full max-w-[980px] gap-4 lg:grid-cols-[minmax(320px,430px)_minmax(0,1fr)] lg:gap-6">
            <div className="relative mx-auto aspect-[9/16] max-h-[82dvh] w-full max-w-[430px] overflow-hidden rounded-[28px] border border-white/15 bg-black shadow-2xl">
              <Image
                src={preview.image}
                alt={preview.actorName ?? "Saved actor"}
                fill
                sizes="430px"
                unoptimized={preview.image.startsWith("http")}
                className="object-cover object-top"
              />
            </div>
            <aside className="flex min-h-[420px] flex-col rounded-[28px] border border-white/15 bg-black/45 p-6 shadow-[inset_0_1px_0_rgba(255,255,255,.1),0_30px_90px_rgba(0,0,0,.35)] backdrop-blur-3xl sm:p-8">
              <div className="border-b border-white/10 pb-6">
                <p className="text-[8px] font-black tracking-[.18em] text-[#FFDF00]">
                  CASTING PROFILE
                </p>
                <h2 className="mt-3 text-3xl font-black tracking-[-.04em] sm:text-4xl">
                  {preview.actorName ?? "CASTING ACTOR"}
                </h2>
                <div className="mt-5 flex flex-wrap gap-2">
                  <span className="rounded-full border border-[#FFDF00]/25 bg-[#FFDF00]/5 px-3 py-2 text-[7px] font-black text-[#FFDF00]">
                    ACTIVE CAST
                  </span>
                  <span className="rounded-full border border-white/10 bg-white/[.035] px-3 py-2 text-[7px] font-black text-white/45">
                    R001 · SATIRE &amp; CARICATURE
                  </span>
                </div>
              </div>

              <div className="flex-1 py-6">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="text-[8px] font-black tracking-[.18em] text-white/35">
                      PROJECTS
                    </p>
                    <h3 className="mt-2 text-lg font-black">SCREEN CREDITS.</h3>
                  </div>
                  <span className="text-[8px] font-black text-white/25">0 PROJECTS</span>
                </div>
                <div className="mt-5 flex min-h-[190px] items-center justify-center rounded-[22px] border border-dashed border-white/15 bg-white/[.025] p-6 text-center">
                  <div>
                    <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full border border-white/10 bg-black/25 text-lg text-white/25">
                      ▶
                    </div>
                    <p className="mt-4 text-[9px] font-black tracking-[.1em] text-white/50">
                      NO PROJECT CREDITS YET
                    </p>
                    <p className="mx-auto mt-2 max-w-xs text-[9px] leading-5 text-white/25">
                      Projects will appear here when this character is selected for video generation.
                    </p>
                  </div>
                </div>
              </div>

              <p className="border-t border-white/10 pt-5 text-[8px] leading-4 text-white/20">
                PROJECT HISTORY TEMPLATE · VIDEO CASTING CONNECTION COMING LATER
              </p>
            </aside>
          </section>
        </div>
      )}
    </main>
  );
}
