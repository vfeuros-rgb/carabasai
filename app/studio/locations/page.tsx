"use client";

import Image from "next/image";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import StudioSidebar from "../../components/StudioSidebar";
import WorkflowNav from "../../components/WorkflowNav";
import { authenticatedFetch } from "../../../lib/authenticated-fetch";
import { getCachedProjectsIncludingLibrary, saveProject, syncProjects, type StoredProject } from "../../../lib/project-store";
import { locationSpecialists } from "../../../lib/location-design";
import { platformConfirm } from "../../../lib/platform-dialog";
import { createMediaUrls } from "../../../lib/supabase/media";

type LocationImageProvider = "banana" | "openai";
type LocationVariant = { id: string; image: string; storagePath: string; prompt: string; createdAt: number; angleOf?: string; imageProvider?: LocationImageProvider; model?: string };
type LocationUnit = { id: string; label: string; scriptText: string; duration: number; prompt: string; briefVersion?: number; variants: LocationVariant[]; approvedIds: string[] };
type LocationSession = StoredProject & { screenplay?: string; locationDesign?: { specialistId?: string; aspectRatio?: string; imageProvider?: LocationImageProvider; segmentationVersion?: number; units?: LocationUnit[] } };
type LocationJob = { id: string; status: "queued" | "running" | "succeeded" | "failed"; input?: { unitId?: string }; output?: { generationId?: string; storagePath?: string; unitId?: string; prompt?: string; createdAt?: number; angleOf?: string; imageProvider?: LocationImageProvider; model?: string } };

const LOCATION_BRIEF_VERSION = 3;
const LOCATION_SEGMENTATION_VERSION = 2;

function cleanText(value: string) { return value.replace(/\*\*/g, "").replace(/\n{3,}/g, "\n\n").trim(); }

const sceneHeadingPattern = /^(?:#{1,6}\s*)?(?:INT\.|EXT\.|INT\/EXT\.|INT-EXT\.|I\/E\.|ИНТ\.|НАТ\.|ИНТ\/НАТ\.|ИНТ-НАТ\.)[^\n]*$/i;

function buildUnits(screenplay: string): LocationUnit[] {
  const normalized = cleanText(screenplay);
  const splitScenes = normalized.split(/(?=^(?:#{1,6}\s*)?(?:INT\.|EXT\.|INT\/EXT\.|INT-EXT\.|I\/E\.|ИНТ\.|НАТ\.|ИНТ\/НАТ\.|ИНТ-НАТ\.)[^\n]*$)/gmi).filter((item) => item.trim());
  const scenes = splitScenes.filter((item) => sceneHeadingPattern.test(item.trim().split("\n")[0] ?? ""));
  const source = scenes.length ? scenes : normalized ? [normalized] : [];
  return source.map((scene, sceneIndex) => {
    const lines = scene.trim().split("\n");
    const slug = sceneHeadingPattern.test(lines[0] ?? "") ? lines.shift()!.replace(/^#{1,6}\s*/, "").trim() : `SCENE ${sceneIndex + 1}`;
    const scriptText = lines.join("\n").trim() || slug;
    return {
      id: `location-${sceneIndex + 1}`,
      label: slug,
      scriptText,
      duration: Math.max(4, Math.min(15, Math.round(scriptText.length / 48))),
      prompt: "",
      variants: [], approvedIds: [],
    };
  }).slice(0, 60);
}

function textTokens(value: string) {
  return new Set(value.toLocaleLowerCase().match(/[\p{L}\p{N}]{4,}/gu) ?? []);
}

function resegmentUnits(screenplay: string, previous: LocationUnit[]) {
  const fresh = buildUnits(screenplay);
  if (!fresh.length) return previous;
  const migrated = fresh.map((unit) => ({ ...unit }));
  for (const [oldIndex, oldUnit] of previous.entries()) {
    const oldTokens = textTokens(oldUnit.scriptText);
    let bestIndex = -1;
    let bestScore = 0;
    migrated.forEach((unit, index) => {
      const score = [...textTokens(unit.scriptText)].filter((token) => oldTokens.has(token)).length;
      if (score > bestScore) { bestScore = score; bestIndex = index; }
    });
    if (bestIndex < 0) bestIndex = Math.min(oldIndex, migrated.length - 1);
    const target = migrated[bestIndex];
    const variants = [...target.variants, ...oldUnit.variants].filter((variant, index, all) => all.findIndex((item) => item.id === variant.id) === index);
    migrated[bestIndex] = {
      ...target,
      prompt: oldUnit.variants.length || !target.prompt ? oldUnit.prompt : target.prompt,
      briefVersion: undefined,
      variants,
      approvedIds: [...new Set([...target.approvedIds, ...oldUnit.approvedIds])],
    };
  }
  return migrated;
}

export default function LocationsPage() {
  const [session, setSession] = useState<LocationSession | null>(null);
  const [rosterOpen, setRosterOpen] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [variantIndexes, setVariantIndexes] = useState<Record<string, number>>({});
  const [approvedIndexes, setApprovedIndexes] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [angleBusy, setAngleBusy] = useState<Record<string, boolean>>({});
  const [preparingBriefs, setPreparingBriefs] = useState(false);
  const [error, setError] = useState("");
  const [mediaUrls, setMediaUrls] = useState<Record<string, string>>({});
  const [mediaErrors, setMediaErrors] = useState<Record<string, string>>({});
  const sessionRef = useRef<LocationSession | null>(null);
  const preparingProjectRef = useRef<string | null>(null);
  const mediaUrlsRef = useRef<Record<string, string>>({});
  const mediaLoadingRef = useRef<Set<string>>(new Set());
  const mediaErrorsRef = useRef<Record<string, string>>({});
  const mediaProjectRef = useRef("");

  const apply = useCallback((project: LocationSession) => {
    const savedUnits = project.locationDesign?.units ?? [];
    const hasEmbeddedSceneHeading = savedUnits.some((unit) => unit.scriptText.split("\n").slice(1).some((line) => sceneHeadingPattern.test(line.trim())));
    const needsResegmentation = hasEmbeddedSceneHeading || project.locationDesign?.segmentationVersion !== LOCATION_SEGMENTATION_VERSION;
    const units = needsResegmentation && savedUnits.length
      ? resegmentUnits(project.screenplay ?? "", savedUnits)
      : savedUnits.length ? savedUnits : buildUnits(project.screenplay ?? "");
    const savedProvider = typeof window !== "undefined" && localStorage.getItem("carabasaiCastingImageProvider") === "openai" ? "openai" : "banana";
    const stableUnits = units.map((unit) => ({
      ...unit,
      variants: unit.variants.map((variant) => ({ ...variant, image: "" })),
    }));
    const restored = { ...project, locationDesign: { aspectRatio: "16:9", imageProvider: savedProvider as LocationImageProvider, ...project.locationDesign, segmentationVersion: LOCATION_SEGMENTATION_VERSION, units: stableUnits } };
    sessionRef.current = restored; setSession(restored);
    setDrafts(Object.fromEntries(units.map((unit) => [unit.id, unit.prompt])));
    sessionStorage.setItem("carabasaiCreativeSession", JSON.stringify(restored));
    if (needsResegmentation) saveProject(restored);
  }, []);

  useEffect(() => {
    const raw = sessionStorage.getItem("carabasaiCreativeSession");
    if (!raw) return;
    const restored = JSON.parse(raw) as LocationSession;
    const cached = getCachedProjectsIncludingLibrary<LocationSession>().find((item) => item.id === restored.id);
    apply(cached ?? restored);
    void syncProjects<LocationSession>({ includeLibrary: true }).then((projects) => {
      const cloud = projects.find((item) => item.id === restored.id);
      if (cloud && Number(cloud.updatedAt ?? 0) > Number((sessionRef.current ?? restored).updatedAt ?? 0)) apply(cloud);
    }).catch(() => undefined);
  }, [apply]);

  function persist(next: LocationSession) { sessionRef.current = next; setSession(next); saveProject(next); sessionStorage.setItem("carabasaiCreativeSession", JSON.stringify(next)); }
  function markMediaBroken(storagePath: string, message = "LOCATION IMAGE FILE IS DAMAGED.") {
    delete mediaUrlsRef.current[storagePath];
    mediaErrorsRef.current[storagePath] = message;
    setMediaUrls((current) => { const next = { ...current }; delete next[storagePath]; return next; });
    setMediaErrors((current) => ({ ...current, [storagePath]: message }));
  }
  const specialist = locationSpecialists.find((item) => item.id === session?.locationDesign?.specialistId);
  const units = useMemo(() => session?.locationDesign?.units ?? [], [session]);
  const storagePaths = useMemo(() => [...new Set(units.flatMap((unit) => unit.variants.map((variant) => variant.storagePath)).filter(Boolean))], [units]);
  const storagePathKey = useMemo(() => storagePaths.join("\n"), [storagePaths]);

  useEffect(() => { mediaErrorsRef.current = mediaErrors; }, [mediaErrors]);

  useEffect(() => {
    const projectId = session?.id;
    if (!projectId || !storagePaths.length) return;
    if (mediaProjectRef.current !== projectId) {
      Object.values(mediaUrlsRef.current).forEach((url) => {
        if (url.startsWith("blob:")) URL.revokeObjectURL(url);
      });
      mediaUrlsRef.current = {};
      mediaLoadingRef.current.clear();
      mediaErrorsRef.current = {};
      mediaProjectRef.current = projectId;
      setMediaUrls({});
      setMediaErrors({});
    }
    const pending = storagePaths.filter((path) => !mediaUrlsRef.current[path] && !mediaErrorsRef.current[path] && !mediaLoadingRef.current.has(path));
    pending.forEach((path) => mediaLoadingRef.current.add(path));
    void createMediaUrls(pending, 60 * 60 * 6, { width: 1280, resize: "contain", quality: 76 }).then((urls) => {
      if (mediaProjectRef.current !== projectId) return;
      Object.assign(mediaUrlsRef.current, urls);
      setMediaUrls((current) => ({ ...current, ...urls }));
    }).catch((mediaError) => {
      if (mediaProjectRef.current !== projectId) return;
      const message = mediaError instanceof Error ? mediaError.message : "LOCATION IMAGES COULD NOT BE LOADED.";
      pending.forEach((storagePath) => { mediaErrorsRef.current[storagePath] = message; });
      setMediaErrors((current) => ({ ...current, ...Object.fromEntries(pending.map((path) => [path, message])) }));
    }).finally(() => pending.forEach((path) => mediaLoadingRef.current.delete(path)));
  }, [session?.id, storagePathKey]);

  useEffect(() => () => {
    Object.values(mediaUrlsRef.current).forEach((url) => {
      if (url.startsWith("blob:")) URL.revokeObjectURL(url);
    });
    mediaUrlsRef.current = {};
  }, []);

  useEffect(() => {
    const current = sessionRef.current;
    const pending = current?.locationDesign?.units?.filter((unit) => unit.briefVersion !== LOCATION_BRIEF_VERSION) ?? [];
    if (!current?.id || !current.locationDesign?.specialistId || !pending.length || preparingProjectRef.current === current.id) return;
    preparingProjectRef.current = current.id;
    setPreparingBriefs(true);
    setError("");
    void (async () => {
      try {
        const prepared = new Map<string, string>();
        for (let offset = 0; offset < pending.length; offset += 8) {
          const batch = pending.slice(offset, offset + 8);
          const response = await authenticatedFetch("/api/location-briefs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ specialist: locationSpecialists.find((item) => item.id === current.locationDesign?.specialistId)?.name, units: batch.map(({ id, label, scriptText }) => ({ id, label, scriptText })) }) });
          const data = await response.json() as { briefs?: Array<{ id: string; prompt: string }>; error?: string };
          if (!response.ok) throw new Error(data.error ?? "LOCATION BRIEFS COULD NOT BE PREPARED.");
          for (const brief of data.briefs ?? []) prepared.set(brief.id, brief.prompt);
        }
        const latest = sessionRef.current;
        if (!latest || latest.id !== current.id) return;
        const nextUnits = (latest.locationDesign?.units ?? []).map((unit) => prepared.has(unit.id) ? { ...unit, prompt: prepared.get(unit.id)!, briefVersion: LOCATION_BRIEF_VERSION } : unit);
        const next = { ...latest, locationDesign: { ...latest.locationDesign, units: nextUnits } };
        persist(next);
        setDrafts(Object.fromEntries(nextUnits.map((unit) => [unit.id, unit.prompt])));
      } catch (briefError) {
        setError(briefError instanceof Error ? briefError.message : "LOCATION BRIEFS COULD NOT BE PREPARED.");
      } finally {
        preparingProjectRef.current = null;
        setPreparingBriefs(false);
      }
    })();
  }, [session?.id, session?.locationDesign?.specialistId, units]);

  useEffect(() => {
    const projectId = session?.id;
    if (!projectId) return;
    let stopped = false;
    async function restoreJobs() {
      try {
        const response = await authenticatedFetch(`/api/location-generation?projectId=${encodeURIComponent(projectId!)}`, { cache: "no-store" });
        const data = await response.json() as { jobs?: LocationJob[] };
        if (!response.ok || stopped) return;
        const jobs = data.jobs ?? [];
        const runningIds = new Set(jobs.filter((job) => job.status === "queued" || job.status === "running").map((job) => job.input?.unitId).filter(Boolean));
        setBusy(Object.fromEntries([...runningIds].map((id) => [id!, true])));
        const latest = sessionRef.current;
        if (!latest || latest.id !== projectId) return;
        let changed = false;
        const nextUnits = (latest.locationDesign?.units ?? []).map((unit) => {
          const completed = jobs.filter((job) => job.status === "succeeded" && job.output?.unitId === unit.id && job.output.generationId && job.output.storagePath);
          const known = new Set(unit.variants.map((variant) => variant.id));
          const recovered = completed.filter((job) => !known.has(job.output!.generationId!)).map((job) => ({
            id: job.output!.generationId!, image: "", storagePath: job.output!.storagePath!, prompt: job.output!.prompt ?? unit.prompt,
            createdAt: job.output!.createdAt ?? Date.now(), angleOf: job.output!.angleOf, imageProvider: job.output!.imageProvider, model: job.output!.model,
          }));
          if (!recovered.length) return unit;
          changed = true;
          return { ...unit, variants: [...unit.variants, ...recovered].sort((a, b) => a.createdAt - b.createdAt) };
        });
        if (changed) persist({ ...latest, locationDesign: { ...latest.locationDesign, units: nextUnits } });
      } catch { /* The next poll retries server restoration. */ }
    }
    void restoreJobs();
    const timer = window.setInterval(() => void restoreJobs(), 4000);
    return () => { stopped = true; window.clearInterval(timer); };
  }, [session?.id]);

  function selectSpecialist(id: string) {
    if (!session) return;
    persist({ ...session, stage: "locations", locationDesign: { ...session.locationDesign, specialistId: id } });
    setRosterOpen(false);
  }

  function updateUnit(unitId: string, mutator: (unit: LocationUnit) => LocationUnit) {
    const current = sessionRef.current; if (!current) return;
    persist({ ...current, stage: "locations", locationDesign: { ...current.locationDesign, units: (current.locationDesign?.units ?? []).map((unit) => unit.id === unitId ? mutator(unit) : unit) } });
  }

  async function generate(unit: LocationUnit, alternateAngle = false) {
    const current = sessionRef.current; const prompt = drafts[unit.id]?.trim();
    if (!current?.id || !prompt || (alternateAngle ? angleBusy[unit.id] : busy[unit.id])) return;
    const currentIndex = Math.min(variantIndexes[unit.id] ?? Math.max(0, unit.variants.length - 1), Math.max(0, unit.variants.length - 1));
    const master = unit.variants[currentIndex];
    const angleNumber = unit.variants.filter((variant) => variant.angleOf === master?.id || variant.angleOf === master?.storagePath).length;
    const cameraAngles = [
      "opposite-side three-quarter view, move at least 90 degrees clockwise around the location and look back toward the master camera position",
      "clear lateral side view, camera moved to the left side of the location on a perpendicular axis",
      "reverse angle, camera placed near the far end of the location and looking back in the opposite direction",
      "wide corner angle from a higher camera position, revealing the same spatial landmarks from a distinctly different axis",
    ];
    const cameraAngle = alternateAngle ? cameraAngles[angleNumber % cameraAngles.length] : undefined;
    updateUnit(unit.id, (value) => ({ ...value, prompt }));
    if (alternateAngle) setAngleBusy((value) => ({ ...value, [unit.id]: true }));
    else setBusy((value) => ({ ...value, [unit.id]: true }));
    setError("");
    try {
      const imageProvider = current.locationDesign?.imageProvider ?? "banana";
      const response = await authenticatedFetch("/api/location-generation", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ projectId: current.id, unitId: unit.id, prompt, aspectRatio: current.locationDesign?.aspectRatio ?? "16:9", specialist: specialist?.name, imageProvider, imageModel: imageProvider === "openai" ? "gpt-image-2" : "gemini-3.1-flash-image", angleReferencePath: alternateAngle ? master?.storagePath : undefined, cameraAngle }) });
      const data = await response.json() as { generationId?: string; storagePath?: string; imageUrl?: string; imageProvider?: LocationImageProvider; model?: string; error?: string };
      if (!response.ok || !data.generationId || !data.storagePath) throw new Error(data.error ?? "LOCATION COULD NOT BE GENERATED.");
      delete mediaUrlsRef.current[data.storagePath];
      delete mediaErrorsRef.current[data.storagePath];
      setMediaUrls((value) => { const next = { ...value }; delete next[data.storagePath!]; return next; });
      setMediaErrors((value) => { const next = { ...value }; delete next[data.storagePath!]; return next; });
      const variant: LocationVariant = { id: data.generationId, storagePath: data.storagePath, image: "", prompt, createdAt: Date.now(), angleOf: alternateAngle ? master?.id : undefined, imageProvider: data.imageProvider, model: data.model };
      const latestUnit = sessionRef.current?.locationDesign?.units?.find((item) => item.id === unit.id) ?? unit;
      const variants = [...latestUnit.variants, variant];
      updateUnit(unit.id, (value) => ({ ...value, prompt, variants }));
      setVariantIndexes((value) => ({ ...value, [unit.id]: variants.length - 1 }));
    } catch (generationError) { setError(generationError instanceof Error ? generationError.message : "LOCATION GENERATION FAILED."); }
    finally {
      if (alternateAngle) setAngleBusy((value) => ({ ...value, [unit.id]: false }));
      else setBusy((value) => ({ ...value, [unit.id]: false }));
    }
  }

  function accept(unit: LocationUnit, variant: LocationVariant) {
    updateUnit(unit.id, (value) => ({ ...value, approvedIds: value.approvedIds.includes(variant.id) ? value.approvedIds : [...value.approvedIds, variant.id] }));
  }

  async function remove(unit: LocationUnit, variant: LocationVariant) {
    if (!session?.id || !(await platformConfirm({ eyebrow: "LOCATION DESIGN", title: "DELETE THIS LOCATION FRAME?", message: "This generated frame will be permanently removed from the project.", confirmLabel: "DELETE FRAME", cancelLabel: "KEEP IT", tone: "danger" }))) return;
    const response = await authenticatedFetch("/api/location-generation", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ projectId: session.id, storagePath: variant.storagePath }) });
    if (!response.ok) { const data = await response.json(); setError(data.error ?? "LOCATION COULD NOT BE DELETED."); return; }
    const objectUrl = mediaUrlsRef.current[variant.storagePath];
    if (objectUrl?.startsWith("blob:")) URL.revokeObjectURL(objectUrl);
    delete mediaUrlsRef.current[variant.storagePath];
    setMediaUrls((value) => { const next = { ...value }; delete next[variant.storagePath]; return next; });
    setMediaErrors((value) => { const next = { ...value }; delete next[variant.storagePath]; return next; });
    updateUnit(unit.id, (value) => ({ ...value, variants: value.variants.filter((item) => item.id !== variant.id), approvedIds: value.approvedIds.filter((id) => id !== variant.id) }));
  }

  if (!session) return <main className="min-h-screen bg-black text-white"><StudioSidebar /><div className="flex min-h-screen items-center justify-center text-xs font-black text-[#FFDF00]">OPENING LOCATION DEPARTMENT...</div></main>;

  return <main className="min-h-screen bg-fixed px-4 pb-8 pt-20 text-white md:pl-[calc(var(--studio-sidebar-width,260px)+28px)] md:pt-5">
    <StudioSidebar /><WorkflowNav />
    <section className="mx-auto max-w-[1500px] overflow-hidden rounded-[24px] border border-white/12 bg-[#0B0B0B] shadow-2xl">
      <header className="border-b border-white/10 bg-[#1B1B1B] px-5 py-5 sm:px-7">
        <div className="flex flex-wrap items-center justify-between gap-5">
          <div><p className="text-[9px] font-black tracking-[.16em] text-[#FFDF00]">LOCATION DEPARTMENT</p><h1 className="mt-2 text-2xl font-black">Build the world around the cast.</h1></div>
          {specialist && <button type="button" onClick={() => setRosterOpen(true)} className="flex items-center gap-3 border border-white/12 bg-black/30 p-3 text-left hover:border-[#FFDF00]/35"><Image src={specialist.portrait} alt={specialist.name} width={44} height={44} className="h-11 w-11 rounded-full object-cover" /><span><b className="block text-[10px]">{specialist.name}</b><span className="mt-1 block text-[8px] text-[#FFDF00]">CHANGE SPECIALIST →</span></span></button>}
        </div>
      </header>

      {!specialist ? <div className="flex min-h-[560px] items-center justify-center p-7"><div className="w-full max-w-xl text-center"><p className="text-[9px] font-black tracking-[.18em] text-[#FFDF00]">NEXT CREW STAGE</p><h2 className="mt-4 text-3xl font-black">CHOOSE A LOCATION SPECIALIST.</h2><p className="mx-auto mt-4 max-w-lg text-sm leading-6 text-white/40">Choose the production designer who will define the architecture, atmosphere and continuity of every location.</p><button type="button" onClick={() => setRosterOpen(true)} className="mt-8 rounded-full bg-[#FFDF00] px-8 py-4 text-[10px] font-black text-black">OPEN SPECIALIST ROSTER +</button></div></div> : <>
        <div className="sticky top-0 z-20 flex flex-wrap items-center justify-between gap-4 border-b border-white/10 bg-[#151515] px-5 py-4 sm:px-7">
          <div><p className="text-[8px] font-black tracking-[.16em] text-white/35">ONE FORMAT FOR EVERY LOCATION</p><p className="mt-1 text-[10px] text-white/55">{preparingBriefs ? `${specialist.name} IS READING THE SCENES AND PREPARING EMPTY LOCATION BRIEFS...` : "Location-only prompts are prepared. Review them or press Generate."}</p></div>
          <div className="flex flex-wrap items-center gap-3"><div className="flex border border-white/12 bg-black/35 p-1"><button type="button" onClick={() => { localStorage.setItem("carabasaiCastingImageProvider", "banana"); persist({ ...session, locationDesign: { ...session.locationDesign, imageProvider: "banana" } }); }} className={`h-8 px-3 text-[8px] font-black ${session.locationDesign?.imageProvider !== "openai" ? "bg-[#FFDF00] text-black" : "text-white/45"}`}>NANO BANANA</button><button type="button" onClick={() => { localStorage.setItem("carabasaiCastingImageProvider", "openai"); persist({ ...session, locationDesign: { ...session.locationDesign, imageProvider: "openai" } }); }} className={`h-8 px-3 text-[8px] font-black ${session.locationDesign?.imageProvider === "openai" ? "bg-[#FFDF00] text-black" : "text-white/45"}`}>GPT IMAGE</button></div><div className="flex gap-2">{["16:9", "9:16", "1:1", "4:3"].map((ratio) => <button key={ratio} type="button" onClick={() => persist({ ...session, locationDesign: { ...session.locationDesign, aspectRatio: ratio } })} className={`h-10 min-w-16 border px-4 text-[9px] font-black ${session.locationDesign?.aspectRatio === ratio ? "border-[#FFDF00] bg-[#FFDF00] text-black" : "border-white/15 text-white/50"}`}>{ratio}</button>)}</div></div>
        </div>
        {error && <div className="m-5 border border-red-400/25 bg-red-500/5 p-3 text-xs text-red-200">{error}</div>}
        <div className="grid grid-cols-1 border-b border-white/10 bg-black/40 text-[8px] font-black tracking-[.16em] text-white/35 lg:grid-cols-[minmax(260px,.9fr)_minmax(360px,1.35fr)_minmax(300px,1fr)]"><div className="p-4">SCREENPLAY GENERATIONS</div><div className="border-white/10 p-4 lg:border-l">LOCATION GENERATION</div><div className="border-white/10 p-4 lg:border-l">APPROVED LOCATIONS</div></div>
        <div>{units.map((unit) => {
          const variantIndex = Math.min(variantIndexes[unit.id] ?? Math.max(0, unit.variants.length - 1), Math.max(0, unit.variants.length - 1));
          const current = unit.variants[variantIndex];
          const approved = unit.variants.filter((item) => unit.approvedIds.includes(item.id));
          const approvedIndex = Math.min(approvedIndexes[unit.id] ?? Math.max(0, approved.length - 1), Math.max(0, approved.length - 1));
          const currentApproved = approved[approvedIndex];
          return <article key={unit.id} className="grid grid-cols-1 border-b border-white/10 lg:grid-cols-[minmax(260px,.9fr)_minmax(360px,1.35fr)_minmax(300px,1fr)]">
            <div className="bg-[#101010] p-5"><div className="flex items-center justify-between gap-3"><p className="text-[9px] font-black text-[#FFDF00]">{unit.label}</p><span className="shrink-0 border border-white/10 px-2 py-1 text-[8px] text-white/45">{unit.duration} SEC</span></div><pre className="mt-4 whitespace-pre-wrap font-sans text-xs leading-6 text-white/55">{unit.scriptText}</pre></div>
            <div className="border-white/10 bg-[#151515] p-5 lg:border-l">
              <div className="flex min-h-[280px] items-center justify-center overflow-hidden bg-black/50">{current ? (mediaUrls[current.storagePath] ? <img src={mediaUrls[current.storagePath]} alt={unit.label} onError={() => markMediaBroken(current.storagePath)} className="max-h-[390px] w-full object-contain" /> : mediaErrors[current.storagePath] ? <p className="px-8 text-center text-[10px] font-black leading-5 text-red-300">THIS FRAME IS DAMAGED.<br />DELETE IT AND GENERATE IT AGAIN.</p> : <p className="px-8 text-center text-[10px] leading-5 text-white/25">LOADING LOCATION FRAME...</p>) : <p className="px-8 text-center text-[10px] leading-5 text-white/25">The generated location will appear here. Earlier versions remain available.</p>}</div>
              {current && <><div className="mt-3 flex items-center justify-between"><button onClick={() => setVariantIndexes((value) => ({ ...value, [unit.id]: Math.max(0, variantIndex - 1) }))} disabled={!variantIndex} className="h-10 w-12 border border-white/15 disabled:opacity-20">←</button><span className="text-[9px] text-white/40">{variantIndex + 1} / {unit.variants.length}</span><button onClick={() => setVariantIndexes((value) => ({ ...value, [unit.id]: Math.min(unit.variants.length - 1, variantIndex + 1) }))} disabled={variantIndex >= unit.variants.length - 1} className="h-10 w-12 border border-white/15 disabled:opacity-20">→</button></div><div className="mt-2 grid grid-cols-[1fr_1fr_auto] gap-2"><button onClick={() => accept(unit, current)} className="h-10 bg-[#FFDF00] text-[9px] font-black text-black">{unit.approvedIds.includes(current.id) ? "ACCEPTED ✓" : "ACCEPT"}</button><button onClick={() => void generate(unit, true)} disabled={angleBusy[unit.id]} className="h-10 border border-[#FFDF00]/35 px-2 text-[8px] font-black text-[#FFDF00] disabled:opacity-55">{angleBusy[unit.id] ? "CREATING NEW ANGLE..." : "ANOTHER ANGLE"}</button><button onClick={() => void remove(unit, current)} className="h-10 w-11 border border-red-400/30 text-red-300">×</button></div></>}
              <textarea value={drafts[unit.id] ?? ""} onChange={(event) => setDrafts((value) => ({ ...value, [unit.id]: event.target.value }))} placeholder={preparingBriefs ? "The location specialist is preparing this brief..." : "Location brief"} disabled={preparingBriefs && !drafts[unit.id]} className="mt-4 h-28 w-full resize-none border border-white/12 bg-black p-3 text-xs leading-5 text-white outline-none focus:border-[#FFDF00]/45 disabled:opacity-40" />
              <button onClick={() => void generate(unit)} disabled={!drafts[unit.id]?.trim() || busy[unit.id]} className="mt-2 h-11 w-full border border-[#FFDF00]/40 text-[9px] font-black text-[#FFDF00] disabled:opacity-25">{preparingBriefs && !drafts[unit.id] ? "PREPARING LOCATION BRIEF..." : busy[unit.id] ? "BUILDING LOCATION..." : unit.variants.length ? "GENERATE ANOTHER" : "GENERATE"}</button>
            </div>
            <div className="border-white/10 bg-[#111] p-5 lg:border-l"><p className="text-[8px] font-black tracking-[.14em] text-[#FFDF00]">APPROVED / {approved.length}</p>{currentApproved ? <><div className="mt-4 flex min-h-[280px] items-center justify-center bg-black/50">{mediaUrls[currentApproved.storagePath] ? <img src={mediaUrls[currentApproved.storagePath]} alt="Approved location" onError={() => markMediaBroken(currentApproved.storagePath)} className="max-h-[390px] w-full object-contain" /> : mediaErrors[currentApproved.storagePath] ? <p className="px-8 text-center text-[10px] font-black leading-5 text-red-300">THIS FRAME IS DAMAGED.<br />DELETE IT AND GENERATE IT AGAIN.</p> : <p className="px-8 text-center text-[10px] leading-5 text-white/25">LOADING LOCATION FRAME...</p>}</div><div className="mt-3 flex items-center justify-between"><button onClick={() => setApprovedIndexes((value) => ({ ...value, [unit.id]: Math.max(0, approvedIndex - 1) }))} disabled={!approvedIndex} className="h-10 w-12 border border-white/15 disabled:opacity-20">←</button><span className="text-[9px] text-white/40">{approvedIndex + 1} / {approved.length}</span><button onClick={() => setApprovedIndexes((value) => ({ ...value, [unit.id]: Math.min(approved.length - 1, approvedIndex + 1) }))} disabled={approvedIndex >= approved.length - 1} className="h-10 w-12 border border-white/15 disabled:opacity-20">→</button></div></> : <div className="mt-4 flex min-h-[280px] items-center justify-center border border-white/8 bg-black/30 px-7 text-center text-[10px] leading-5 text-white/25">Accepted location frames will be stored here.</div>}</div>
          </article>;
        })}</div>
      </>}
    </section>

    {rosterOpen && <div className="fixed inset-0 z-[10000] flex items-end justify-center bg-black/90 p-0 backdrop-blur-md lg:items-center lg:p-8" role="dialog" aria-modal="true"><div className="max-h-[92vh] w-full max-w-6xl overflow-y-auto border border-white/12 bg-[#101010] p-6 sm:p-8"><div className="flex items-start justify-between"><div><p className="text-[9px] font-black tracking-[.18em] text-[#FFDF00]">LOCATION SPECIALIST ROSTER</p><h2 className="mt-3 text-3xl font-black">CHOOSE YOUR WORLD BUILDER.</h2></div><button onClick={() => setRosterOpen(false)} className="h-11 w-11 border border-white/15 text-xl">×</button></div><div className="mt-8 grid gap-4 md:grid-cols-3">{locationSpecialists.map((item) => <button key={item.id} onClick={() => selectSpecialist(item.id)} className={`flex min-h-[340px] flex-col border p-5 text-left transition hover:border-[#FFDF00]/60 ${item.id === specialist?.id ? "border-[#FFDF00] bg-[#FFDF00]/5" : "border-white/12 bg-[#181818]"}`}><Image src={item.portrait} alt={item.name} width={90} height={90} className="h-24 w-24 rounded-full object-cover" /><p className="mt-6 text-lg font-black">{item.name}</p><p className="mt-2 text-[9px] font-black text-[#FFDF00]">{item.role}</p><p className="mt-5 text-xs leading-6 text-white/45">{item.approach}</p><p className="mt-auto pt-7 text-[8px] font-black tracking-[.12em] text-white/30">{item.signature}</p></button>)}</div></div></div>}
  </main>;
}
