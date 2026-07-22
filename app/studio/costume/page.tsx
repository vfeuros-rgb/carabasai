"use client";

import Image from "next/image";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import StudioSidebar from "../../components/StudioSidebar";
import WorkflowNav from "../../components/WorkflowNav";
import { authenticatedFetch } from "../../../lib/authenticated-fetch";
import { getCachedProjectsIncludingLibrary, saveProject, syncProjects, type StoredProject } from "../../../lib/project-store";
import { platformConfirm } from "../../../lib/platform-dialog";
import { locationSpecialists } from "../../../lib/location-design";

type CastMember = { id: string; name: string; role: string; actorName?: string; image?: string; storagePath?: string; isVisual?: boolean };
type CostumeVariant = { id: string; image: string; storagePath: string; prompt: string; createdAt: number };
type CharacterCostumeState = { prompt?: string; variants?: CostumeVariant[]; approvedIds?: string[] };
type CostumeImageProvider = "banana" | "openai";
type CostumeSession = StoredProject & {
  characterCasting?: { characters?: CastMember[] };
  costumeDesign?: { characters?: Record<string, CharacterCostumeState> };
  locationDesign?: { specialistId?: string; aspectRatio?: string; units?: unknown[] };
};

export default function CostumePage() {
  const router = useRouter();
  const [session, setSession] = useState<CostumeSession | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [variantIndexes, setVariantIndexes] = useState<Record<string, number>>({});
  const [approvedIndexes, setApprovedIndexes] = useState<Record<string, number>>({});
  const [busyCharacters, setBusyCharacters] = useState<Record<string, boolean>>({});
  const [error, setError] = useState("");
  const [previewImage, setPreviewImage] = useState<{ image: string; alt: string } | null>(null);
  const [locationStageOpen, setLocationStageOpen] = useState(false);
  const [locationRosterOpen, setLocationRosterOpen] = useState(false);
  const [imageProvider, setImageProvider] = useState<CostumeImageProvider>("banana");
  const sessionRef = useRef<CostumeSession | null>(null);
  const busyCharactersRef = useRef(new Set<string>());

  const draftStorageKey = (projectId: string) => `carabasaiCostumeDrafts:${projectId}`;

  const readLocalDrafts = (projectId: string) => {
    try {
      return JSON.parse(sessionStorage.getItem(draftStorageKey(projectId)) ?? "{}") as Record<string, string>;
    } catch {
      return {};
    }
  };

  const applyRestored = useCallback((restored: CostumeSession) => {
    const isSameProject = sessionRef.current?.id === restored.id;
    sessionStorage.setItem("carabasaiCreativeSession", JSON.stringify(restored));
    sessionRef.current = restored;
    setSession(restored);
    const saved = restored.costumeDesign?.characters ?? {};
    const locallySaved = restored.id ? readLocalDrafts(restored.id) : {};
    setDrafts((current) => {
      const restoredDrafts = Object.fromEntries(Object.entries(saved).map(([id, value]) => [id, value.prompt ?? ""]));
      return isSameProject
        ? { ...restoredDrafts, ...locallySaved, ...current }
        : { ...restoredDrafts, ...locallySaved };
    });
  }, []);

  function updateDraft(memberId: string, value: string) {
    setDrafts((current) => {
      const next = { ...current, [memberId]: value };
      const projectId = sessionRef.current?.id;
      if (projectId) sessionStorage.setItem(draftStorageKey(projectId), JSON.stringify(next));
      return next;
    });
  }

  const load = useCallback(() => {
    const raw = sessionStorage.getItem("carabasaiCreativeSession");
    if (!raw) return;
    const restored = JSON.parse(raw) as CostumeSession;
    const cached = getCachedProjectsIncludingLibrary<CostumeSession>().find((project) => project.id === restored.id);
    const restoredRoles = restored.characterCasting?.characters?.length ?? 0;
    const cachedRoles = cached?.characterCasting?.characters?.length ?? 0;
    applyRestored(cached && cachedRoles > restoredRoles ? cached : restored);
    if (restoredRoles === 0) {
      void syncProjects<CostumeSession>({ includeLibrary: true }).then((projects) => {
        const cloud = projects.find((project) => project.id === restored.id);
        const current = sessionRef.current ?? restored;
        if ((cloud?.characterCasting?.characters?.length ?? 0) > (current.characterCasting?.characters?.length ?? 0)) applyRestored(cloud!);
      }).catch(() => undefined);
    }
  }, [applyRestored]);

  useEffect(() => {
    load();
    setImageProvider(localStorage.getItem("carabasaiCastingImageProvider") === "openai" ? "openai" : "banana");
    window.addEventListener("carabasai-active-project-change", load);
    return () => window.removeEventListener("carabasai-active-project-change", load);
  }, [load]);

  function chooseImageProvider(next: CostumeImageProvider) {
    setImageProvider(next);
    localStorage.setItem("carabasaiCastingImageProvider", next);
    localStorage.setItem("carabasaiCastingImageModel", next === "openai" ? "gpt-image-2" : "gemini-3.1-flash-image");
  }

  const visualRoles = useMemo(() => (session?.characterCasting?.characters ?? []).filter((member) => member.isVisual !== false), [session]);
  const characters = useMemo(() => visualRoles.filter((member) => Boolean(member.image)), [visualRoles]);
  const allRolesCast = visualRoles.length > 0 && visualRoles.every((member) => Boolean(member.image));
  const costumeStates = session?.costumeDesign?.characters ?? {};
  const allCostumesReady = characters.length > 0 && allRolesCast && characters.every((member) => (costumeStates[member.id]?.approvedIds?.length ?? 0) > 0);

  function persist(next: CostumeSession) {
    saveProject(next);
    sessionStorage.setItem("carabasaiCreativeSession", JSON.stringify(next));
    sessionRef.current = next;
    setSession(next);
  }

  async function generateCostume(member: CastMember) {
    const startingSession = sessionRef.current;
    const costumeBrief = drafts[member.id]?.trim();
    if (!startingSession?.id || !member.image || !costumeBrief || busyCharactersRef.current.has(member.id)) return;
    busyCharactersRef.current.add(member.id);
    setBusyCharacters((current) => ({ ...current, [member.id]: true }));
    setError("");
    try {
      const response = await authenticatedFetch("/api/costume-generation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId: startingSession.id,
          characterId: member.id,
          characterName: member.actorName ?? member.role ?? member.name,
          costumeBrief,
          storagePath: member.storagePath,
          characterImage: member.image,
          imageProvider,
          imageModel: imageProvider === "openai" ? "gpt-image-2" : "gemini-3.1-flash-image",
        }),
      });
      const data = await response.json() as { generationId?: string; storagePath?: string; imageUrl?: string; prompt?: string; error?: string };
      if (!response.ok || !data.generationId || !data.storagePath || !data.imageUrl) throw new Error(data.error ?? "COSTUME COULD NOT BE GENERATED.");
      const latestSession = sessionRef.current;
      if (!latestSession || latestSession.id !== startingSession.id) throw new Error("THE ACTIVE PROJECT CHANGED DURING GENERATION.");
      const previous = latestSession.costumeDesign?.characters?.[member.id] ?? {};
      const variant: CostumeVariant = { id: data.generationId, image: data.imageUrl, storagePath: data.storagePath, prompt: costumeBrief, createdAt: Date.now() };
      const variants = [...(previous.variants ?? []), variant];
      const updated: CostumeSession = {
        ...latestSession,
        stage: "costume",
        costumeDesign: { ...latestSession.costumeDesign, characters: { ...(latestSession.costumeDesign?.characters ?? {}), [member.id]: { ...previous, prompt: costumeBrief, variants } } },
      };
      persist(updated);
      setVariantIndexes((current) => ({ ...current, [member.id]: variants.length - 1 }));
    } catch (generationError) {
      setError(generationError instanceof Error ? generationError.message : "COSTUME GENERATION FAILED.");
    } finally {
      busyCharactersRef.current.delete(member.id);
      setBusyCharacters((current) => ({ ...current, [member.id]: false }));
    }
  }

  function acceptVariant(member: CastMember, variant: CostumeVariant) {
    const current = sessionRef.current;
    if (!current) return;
    const previous = current.costumeDesign?.characters?.[member.id] ?? {};
    const approvedIds = previous.approvedIds?.includes(variant.id) ? previous.approvedIds : [...(previous.approvedIds ?? []), variant.id];
    persist({ ...current, stage: "costume", costumeDesign: { ...current.costumeDesign, characters: { ...(current.costumeDesign?.characters ?? {}), [member.id]: { ...previous, approvedIds } } } });
    setApprovedIndexes((current) => ({ ...current, [member.id]: approvedIds.length - 1 }));
  }

  function removeVariantFromUse(member: CastMember, variant: CostumeVariant) {
    const current = sessionRef.current;
    if (!current) return;
    const previous = current.costumeDesign?.characters?.[member.id] ?? {};
    const approvedIds = (previous.approvedIds ?? []).filter((id) => id !== variant.id);
    persist({ ...current, stage: "costume", costumeDesign: { ...current.costumeDesign, characters: { ...(current.costumeDesign?.characters ?? {}), [member.id]: { ...previous, approvedIds } } } });
    setApprovedIndexes((current) => ({ ...current, [member.id]: Math.max(0, Math.min(current[member.id] ?? 0, approvedIds.length - 1)) }));
  }

  async function deleteVariant(member: CastMember, variant: CostumeVariant) {
    if (!session?.id) return;
    const confirmed = await platformConfirm({ eyebrow: "COSTUME DESIGN", title: "DELETE THIS COSTUME?", message: "This costume will be permanently removed from the project and cannot be restored.", confirmLabel: "DELETE COSTUME", cancelLabel: "KEEP IT", tone: "danger" });
    if (!confirmed) return;
    setError("");
    const response = await authenticatedFetch("/api/costume-generation", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ projectId: session.id, storagePath: variant.storagePath }) });
    const data = await response.json() as { deleted?: boolean; error?: string };
    if (!response.ok || !data.deleted) { setError(data.error ?? "COSTUME COULD NOT BE DELETED."); return; }
    const previous = session.costumeDesign?.characters?.[member.id] ?? {};
    const variants = (previous.variants ?? []).filter((item) => item.id !== variant.id);
    const approvedIds = (previous.approvedIds ?? []).filter((id) => id !== variant.id);
    persist({ ...session, stage: "costume", costumeDesign: { ...session.costumeDesign, characters: { ...(session.costumeDesign?.characters ?? {}), [member.id]: { ...previous, variants, approvedIds } } } });
    setVariantIndexes((current) => ({ ...current, [member.id]: Math.max(0, Math.min(current[member.id] ?? 0, variants.length - 1)) }));
    setApprovedIndexes((current) => ({ ...current, [member.id]: Math.max(0, Math.min(current[member.id] ?? 0, approvedIds.length - 1)) }));
  }

  function openLocationStage() {
    if (!session || !allCostumesReady) return;
    setLocationStageOpen(true);
  }

  function selectLocationSpecialist(specialistId: string) {
    if (!session) return;
    persist({
      ...session,
      locationDesign: { aspectRatio: "16:9", ...session.locationDesign, specialistId },
    });
    setLocationRosterOpen(false);
  }

  function enterLocations() {
    if (!session?.locationDesign?.specialistId) return;
    persist({ ...session, stage: "locations" });
    router.push("/studio/locations");
  }

  if (!session) return <main className="min-h-screen bg-black text-white"><StudioSidebar /><div className="flex min-h-screen items-center justify-center text-xs font-black text-[#FFDF00]">OPENING COSTUME DEPARTMENT...</div></main>;

  const locationSpecialist = locationSpecialists.find((item) => item.id === session.locationDesign?.specialistId);

  return <main className="min-h-screen bg-fixed px-4 pb-8 pt-20 text-white md:pl-[calc(var(--studio-sidebar-width,260px)+28px)] md:pt-5">
    <StudioSidebar />
    <WorkflowNav />
    <section className="mx-auto max-w-7xl overflow-hidden rounded-[24px] border border-white/12 bg-[#0B0B0B] shadow-2xl">
      <header className="border-b border-white/10 bg-[#1B1B1B] px-5 py-5 sm:px-7">
        <div className="flex flex-wrap items-end justify-between gap-5">
          <div><p className="text-[9px] font-black tracking-[.16em] text-[#FFDF00]">COSTUME DEPARTMENT</p><h1 className="mt-2 text-2xl font-black">Dress every character for the story.</h1><p className="mt-2 max-w-3xl text-sm leading-6 text-white/40">The assigned actor is attached automatically as the identity reference. Describe clothing only. Every result remains available.</p></div>
          <div><p className="mb-2 text-[8px] font-black tracking-[.15em] text-white/35">IMAGE GENERATOR</p><div className="flex border border-white/12 bg-black/35 p-1"><button type="button" onClick={() => chooseImageProvider("banana")} className={`h-9 px-4 text-[8px] font-black ${imageProvider === "banana" ? "bg-[#FFDF00] text-black" : "text-white/45"}`}>NANO BANANA</button><button type="button" onClick={() => chooseImageProvider("openai")} className={`h-9 px-4 text-[8px] font-black ${imageProvider === "openai" ? "bg-[#FFDF00] text-black" : "text-white/45"}`}>GPT IMAGE</button></div></div>
        </div>
      </header>

      {!allRolesCast && <div className="m-5 border border-red-400/25 bg-red-500/5 p-4 text-xs text-red-200">Assign an actor to every visual role before opening the costume department.</div>}
      {error && <div className="mx-5 mt-5 border border-red-400/25 bg-red-500/5 p-3 text-xs text-red-200">{error}</div>}

      <div className="overflow-x-auto p-5 [scrollbar-color:rgba(255,223,0,.45)_rgba(255,255,255,.05)] sm:p-7">
        <div className="flex min-w-max items-start gap-5">
          {characters.map((member) => {
            const state = costumeStates[member.id] ?? {};
            const variants = state.variants ?? [];
            const variantIndex = Math.min(variantIndexes[member.id] ?? Math.max(0, variants.length - 1), Math.max(0, variants.length - 1));
            const currentVariant = variants[variantIndex];
            const approved = variants.filter((variant) => state.approvedIds?.includes(variant.id));
            const approvedIndex = Math.min(approvedIndexes[member.id] ?? Math.max(0, approved.length - 1), Math.max(0, approved.length - 1));
            const currentApproved = approved[approvedIndex];
            return <article key={member.id} className="w-[390px] shrink-0 overflow-hidden rounded-[20px] border border-white/12 bg-[#141414]">
              <div className="border-b border-white/10 bg-[#202020] p-4">
                <p className="truncate text-sm font-black">{member.actorName ?? member.role ?? member.name}</p>
                <p className="mt-1 truncate text-[9px] text-[#FFDF00]">{member.role || member.name}</p>
              </div>
              <div className="p-4">
                <button type="button" onClick={() => setPreviewImage({ image: member.image!, alt: member.actorName ?? member.name })} className="relative block h-[330px] w-full overflow-hidden rounded-[14px] bg-[#242424]">
                  <Image src={member.image!} alt={member.actorName ?? member.name} fill unoptimized={member.image!.startsWith("http")} className="object-contain object-center transition hover:scale-[1.02]" />
                  <span className="absolute left-2 top-2 bg-black/75 px-2 py-1 text-[7px] font-black text-white/55">ACTOR REFERENCE</span>
                </button>

                <div className="mt-4 h-[472px] overflow-hidden rounded-[14px] border border-white/10 bg-[#8a8a8a]/15 p-3">
                  {currentVariant ? <>
                    <button type="button" onClick={() => setPreviewImage({ image: currentVariant.image, alt: `Costume for ${member.actorName ?? member.name}` })} className="relative block h-[330px] w-full overflow-hidden rounded-[10px] bg-[#777]">
                      <img src={currentVariant.image} alt="Generated costume" className="h-full w-full object-contain" />
                    </button>
                    <div className="mt-3 flex items-center justify-between">
                      <button type="button" onClick={() => setVariantIndexes((current) => ({ ...current, [member.id]: Math.max(0, variantIndex - 1) }))} disabled={variantIndex === 0} className="h-11 w-11 border border-white/15 text-lg text-white/70 disabled:opacity-20">←</button>
                      <span className="text-xs font-black text-white/45">{variantIndex + 1} / {variants.length}</span>
                      <button type="button" onClick={() => setVariantIndexes((current) => ({ ...current, [member.id]: Math.min(variants.length - 1, variantIndex + 1) }))} disabled={variantIndex >= variants.length - 1} className="h-11 w-11 border border-white/15 text-lg text-white/70 disabled:opacity-20">→</button>
                    </div>
                    <div className="mt-3 grid grid-cols-[minmax(0,1fr)_auto] gap-2"><button type="button" onClick={() => acceptVariant(member, currentVariant)} className="h-11 bg-[#FFDF00] px-3 text-[10px] font-black text-black">{state.approvedIds?.includes(currentVariant.id) ? "ACCEPTED ✓" : "ACCEPT COSTUME"}</button><button type="button" onClick={() => void deleteVariant(member, currentVariant)} aria-label="Delete costume" title="Delete costume forever" className="h-11 w-12 border border-red-400/35 text-lg text-red-300 hover:bg-red-500/10">×</button></div>
                  </> : <div className="flex h-full items-center justify-center px-5 text-center text-[10px] leading-5 text-white/30">The generated costume will appear here without replacing earlier versions.</div>}
                </div>

                <textarea value={drafts[member.id] ?? ""} onChange={(event) => updateDraft(member.id, event.target.value)} placeholder="Describe this character's costume only..." className="mt-4 h-24 w-full resize-none border border-white/12 bg-black p-3 text-xs leading-5 text-white outline-none placeholder:text-white/25 focus:border-[#FFDF00]/45" />
                <button type="button" onClick={() => void generateCostume(member)} disabled={!drafts[member.id]?.trim() || busyCharacters[member.id]} className="mt-2 h-10 w-full border border-[#FFDF00]/45 text-[9px] font-black text-[#FFDF00] disabled:opacity-25">{busyCharacters[member.id] ? "FITTING COSTUME..." : variants.length ? "GENERATE ANOTHER" : "GENERATE"}</button>

                <div className="mt-5 border-t border-white/10 pt-4">
                  <p className="text-[8px] font-black tracking-[.12em] text-[#FFDF00]">APPROVED COSTUMES / {approved.length}</p>
                  {currentApproved ? <>
                    <button type="button" onClick={() => setPreviewImage({ image: currentApproved.image, alt: `Approved costume for ${member.actorName ?? member.name}` })} className="mt-3 block h-[330px] w-full overflow-hidden rounded-[10px] bg-[#777]"><img src={currentApproved.image} alt="Approved costume" className="h-full w-full object-contain" /></button>
                    <div className="mt-2 flex items-center justify-between"><button className="h-10 w-10 text-lg disabled:opacity-20" onClick={() => setApprovedIndexes((current) => ({ ...current, [member.id]: Math.max(0, approvedIndex - 1) }))} disabled={approvedIndex === 0}>←</button><span className="text-[10px] text-white/35">{approvedIndex + 1} / {approved.length}</span><button className="h-10 w-10 text-lg disabled:opacity-20" onClick={() => setApprovedIndexes((current) => ({ ...current, [member.id]: Math.min(approved.length - 1, approvedIndex + 1) }))} disabled={approvedIndex >= approved.length - 1}>→</button></div>
                    <button type="button" onClick={() => removeVariantFromUse(member, currentApproved)} aria-label="Remove costume from use" title="Keep in project, but remove from selected costumes" className="mt-2 h-10 w-full border border-white/20 text-[9px] font-black text-white/55 hover:border-[#FFDF00]/45 hover:text-[#FFDF00]">REMOVE FROM USE</button>
                  </> : <div className="mt-3 flex h-[330px] items-center justify-center rounded-[10px] border border-white/8 bg-white/[.02] px-5 text-center text-[9px] leading-5 text-white/25">Accept at least one costume for this character.</div>}
                </div>
              </div>
            </article>;
          })}
        </div>
      </div>

      <footer className="sticky bottom-0 flex items-center justify-between gap-4 border-t border-white/10 bg-[#1B1B1B] px-5 py-4 sm:px-7">
        <p className="text-[10px] text-white/40">{characters.filter((member) => (costumeStates[member.id]?.approvedIds?.length ?? 0) > 0).length} / {characters.length} characters ready</p>
        <button type="button" onClick={openLocationStage} disabled={!allCostumesReady} className="h-11 rounded-full bg-[#FFDF00] px-7 text-[10px] font-black text-black disabled:opacity-20">LOCATIONS →</button>
      </footer>
    </section>

    {locationStageOpen && <div role="dialog" aria-modal="true" className="fixed inset-0 z-[12000] flex items-center justify-center bg-black/90 p-4 backdrop-blur-sm" onClick={() => setLocationStageOpen(false)}>
      <section className="relative w-full max-w-[590px] rounded-[30px] border border-white/15 bg-[#080808] p-7 shadow-2xl sm:p-10" onClick={(event) => event.stopPropagation()}>
        <button type="button" onClick={() => setLocationStageOpen(false)} aria-label="Close" className="absolute right-5 top-5 h-10 w-10 rounded-full border border-white/15 text-lg text-white/45 hover:text-white">×</button>
        <p className="text-xs font-black tracking-[.18em] text-[#FFDF00]">NEXT CREW STAGE</p>
        <h2 className="mt-4 text-3xl font-black sm:text-4xl">LOCATION DESIGN</h2>
        <p className="mt-5 max-w-md text-sm leading-7 text-white/40">Choose the specialist who will define the architecture, atmosphere and visual continuity of every location.</p>

        <button type="button" onClick={() => setLocationRosterOpen(true)} className="mt-8 w-full rounded-[22px] border border-[#FFDF00]/55 bg-[#17160c] p-5 text-left transition hover:border-[#FFDF00] sm:p-7">
          {locationSpecialist ? <div className="grid grid-cols-[72px_1fr] gap-5">
            <div className="relative h-[72px] w-[72px] overflow-hidden rounded-[18px] border border-white/15"><Image src={locationSpecialist.portrait} alt={locationSpecialist.name} fill className="object-cover" /></div>
            <div>
              <p className="text-lg font-black">{locationSpecialist.name}</p>
              <p className="mt-2 text-xs font-black tracking-[.12em] text-[#FFDF00]">{locationSpecialist.role}</p>
              <p className="mt-4 text-sm leading-6 text-white/42">{locationSpecialist.approach}</p>
            </div>
          </div> : <div>
            <p className="text-lg font-black">CHOOSE LOCATION SPECIALIST</p>
            <p className="mt-2 text-xs font-black tracking-[.12em] text-[#FFDF00]">ARCHITECTURE / ATMOSPHERE / CONTINUITY</p>
            <p className="mt-4 text-sm leading-6 text-white/42">Open the roster and choose the visual method that will shape the project world.</p>
          </div>}
          <span className="mt-6 block text-xs font-black text-[#FFDF00]">{locationSpecialist ? "CHANGE SPECIALIST →" : "OPEN SPECIALIST ROSTER +"}</span>
        </button>

        <div className="mt-8 flex justify-end">
          <button type="button" onClick={enterLocations} disabled={!locationSpecialist} className="h-14 rounded-full bg-[#FFDF00] px-10 text-sm font-black text-black disabled:opacity-20">NEXT →</button>
        </div>
      </section>
    </div>}

    {locationRosterOpen && <div role="dialog" aria-modal="true" className="fixed inset-0 z-[13000] overflow-y-auto bg-black/95 p-4 backdrop-blur-md">
      <section className="mx-auto my-8 w-full max-w-5xl rounded-[28px] border border-white/15 bg-[#0B0B0B] p-6 sm:p-9">
        <div className="flex items-start justify-between gap-5">
          <div><p className="text-xs font-black tracking-[.18em] text-[#FFDF00]">LOCATION DEPARTMENT</p><h2 className="mt-3 text-3xl font-black">CHOOSE LOCATION SPECIALIST</h2></div>
          <button type="button" onClick={() => setLocationRosterOpen(false)} className="h-11 w-11 rounded-full border border-white/15 text-xl text-white/50">×</button>
        </div>
        <div className="mt-8 grid gap-5 md:grid-cols-3">
          {locationSpecialists.map((specialist) => <button key={specialist.id} type="button" onClick={() => selectLocationSpecialist(specialist.id)} className={`overflow-hidden rounded-[22px] border bg-[#151515] text-left transition hover:border-[#FFDF00] ${locationSpecialist?.id === specialist.id ? "border-[#FFDF00]" : "border-white/12"}`}>
            <div className="relative aspect-[4/3] w-full bg-[#222]"><Image src={specialist.portrait} alt={specialist.name} fill className="object-cover" /></div>
            <div className="p-5"><p className="text-lg font-black">{specialist.name}</p><p className="mt-2 text-[10px] font-black tracking-[.12em] text-[#FFDF00]">{specialist.role}</p><p className="mt-4 text-sm leading-6 text-white/42">{specialist.approach}</p><p className="mt-5 text-[10px] font-black text-[#FFDF00]">SELECT SPECIALIST →</p></div>
          </button>)}
        </div>
      </section>
    </div>}
    {previewImage && <div role="dialog" aria-modal="true" className="fixed inset-0 z-[12000] flex items-center justify-center bg-black/90 p-4 backdrop-blur-md" onClick={() => setPreviewImage(null)}><div className="flex max-h-[94dvh] max-w-[94vw] flex-col items-end" onClick={(event) => event.stopPropagation()}><button type="button" onClick={() => setPreviewImage(null)} className="mb-2 h-11 border border-white/20 bg-black/80 px-5 text-xs font-black text-white">← BACK</button><img src={previewImage.image} alt={previewImage.alt} className="min-h-0 max-h-[84dvh] max-w-[94vw] object-contain shadow-2xl" /></div></div>}
  </main>;
}
