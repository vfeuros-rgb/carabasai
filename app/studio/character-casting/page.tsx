"use client";

import Image from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";
import StudioSidebar from "../../components/StudioSidebar";
import WorkflowNav from "../../components/WorkflowNav";
import { authenticatedFetch } from "../../../lib/authenticated-fetch";
import {
  getCachedProjects,
  projectChangeEvent,
  saveProject,
  saveProjects,
  syncProjects,
  type StoredProject,
} from "../../../lib/project-store";
import {
  characterCastingSpecialists,
  type CharacterCastingSpecialist,
} from "../../../lib/character-casting";
import { platformConfirm, platformNotice } from "../../../lib/platform-dialog";

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  image?: string;
  candidate?: Candidate;
};
type CastMember = {
  id: string;
  name: string;
  role: string;
  description: string;
  actorName?: string;
  image?: string;
  storagePath?: string;
  source?: "portfolio" | "generated";
};
type Candidate = {
  image: string;
  actorName?: string;
  storagePath?: string;
  source: "portfolio" | "generated";
  description?: string;
};
type CharacterAttachment = Candidate & { id: string; name: string };
type GenerationFlow = {
  stage:
    | "choose-role"
    | "hire-role"
    | "describe"
    | "ready"
    | "candidate"
    | "rejected";
  roleId?: string;
  roleLabel?: string;
  brief?: string;
  russian?: boolean;
};
type CastingState = {
  specialistId?: string;
  messages?: ChatMessage[];
  generationMessages?: ChatMessage[];
  characters?: CastMember[];
  candidate?: Candidate;
  candidatePool?: Candidate[];
  myCast?: Candidate[];
  pendingRoleMemberId?: string;
  generationFlow?: GenerationFlow;
  initialized?: boolean;
};
type CastingSession = StoredProject & {
  projectDocument?: unknown;
  characterCastingSpecialist?: CharacterCastingSpecialist;
  characterCasting?: CastingState;
};
type BusyMode = "summary" | "reply" | "generation" | null;
type ImageModelId =
  | "gemini-3.1-flash-image"
  | "gemini-3-pro-image"
  | "gemini-2.5-flash-image"
  | "flux-r001-lora";

const imageModels: Array<{
  id: ImageModelId;
  label: string;
  provider: "flux" | "banana";
}> = [
  { id: "gemini-3.1-flash-image", label: "NANO BANANA 2", provider: "banana" },
  { id: "gemini-3-pro-image", label: "NANO BANANA PRO", provider: "banana" },
  { id: "gemini-2.5-flash-image", label: "NANO BANANA", provider: "banana" },
  { id: "flux-r001-lora", label: "FLUX R001 LORA", provider: "flux" },
];

const uid = () => crypto.randomUUID();

function normalizeRoleKey(member: CastMember) {
  return (member.role || member.name)
    .trim()
    .toLocaleLowerCase()
    .replace(/[«»"'`.,:;!?()[\]{}]/g, "")
    .replace(/\s+/g, " ");
}

function normalizeCastNotebook(members: CastMember[]): CastMember[] {
  const uniqueRoles: CastMember[] = [];
  const roleIndexes = new Map<string, number>();

  for (const member of members) {
    const roleKey = normalizeRoleKey(member) || member.id;
    const existingIndex = roleIndexes.get(roleKey);
    if (existingIndex === undefined) {
      roleIndexes.set(roleKey, uniqueRoles.length);
      uniqueRoles.push(member);
      continue;
    }

    const existing = uniqueRoles[existingIndex];
    if (!existing.image && member.image) {
      uniqueRoles[existingIndex] = {
        ...existing,
        actorName: member.actorName,
        image: member.image,
        storagePath: member.storagePath,
        source: member.source,
      };
    }
  }

  const assigned = new Set<string>();
  return uniqueRoles.map((member) => {
    const key = member.storagePath ?? member.image;
    if (!key || !assigned.has(key)) {
      if (key) assigned.add(key);
      return member;
    }
    const {
      actorName: _actorName,
      image: _image,
      storagePath: _storagePath,
      source: _source,
      ...roleOnly
    } = member;
    return roleOnly;
  });
}

export default function CharacterCastingPage() {
  const [session, setSession] = useState<CastingSession | null>(null);
  const [portfolioOpen, setPortfolioOpen] = useState(false);
  const [myCastOpen, setMyCastOpen] = useState(false);
  const [candidatePreviewOpen, setCandidatePreviewOpen] = useState(false);
  const [accountCast, setAccountCast] = useState<Candidate[]>([]);
  const [preview, setPreview] = useState("");
  const [selectedMyCastKey, setSelectedMyCastKey] = useState("");
  const [input, setInput] = useState("");
  const [provider, setProvider] = useState<"anthropic" | "openai">("anthropic");
  const [imageProvider, setImageProvider] = useState<"flux" | "banana">("banana");
  const [imageModel, setImageModel] = useState<ImageModelId>(
    "gemini-3.1-flash-image",
  );
  const [busyMode, setBusyMode] = useState<BusyMode>(null);
  const [error, setError] = useState("");
  const [attachments, setAttachments] = useState<Array<{ name: string }>>([]);
  const [characterAttachments, setCharacterAttachments] = useState<
    CharacterAttachment[]
  >([]);
  const [editingRoleId, setEditingRoleId] = useState("");
  const [roleDraft, setRoleDraft] = useState("");
  const [addingRole, setAddingRole] = useState(false);
  const [newRoleDraft, setNewRoleDraft] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const initialRequestRef = useRef("");
  const busy = busyMode !== null;

  const persist = useCallback((next: CastingSession) => {
    const normalized = { ...next, stage: "casting" as const };
    sessionStorage.setItem(
      "carabasaiCreativeSession",
      JSON.stringify(normalized),
    );
    saveProject(normalized);
    setSession(normalized);
  }, []);

  const loadSession = useCallback(() => {
    const raw = sessionStorage.getItem("carabasaiCreativeSession");
    if (!raw) return;
    const restored = JSON.parse(raw) as CastingSession;
    const restoredCharacters = restored.characterCasting?.characters ?? [];
    const cleanedCharacters = normalizeCastNotebook(restoredCharacters);
    const cleaned = restored.characterCasting
      ? {
          ...restored,
          characterCasting: {
            ...restored.characterCasting,
            characters: cleanedCharacters,
          },
        }
      : restored;
    if (
      JSON.stringify(cleanedCharacters) !== JSON.stringify(restoredCharacters)
    ) {
      sessionStorage.setItem(
        "carabasaiCreativeSession",
        JSON.stringify(cleaned),
      );
      saveProject(cleaned);
    }
    setSession(cleaned);
    setProvider(
      localStorage.getItem("carabasaiAIProvider") === "openai"
        ? "openai"
        : "anthropic",
    );
    const storedImageModel = localStorage.getItem(
      "carabasaiCastingImageModel",
    ) as ImageModelId | null;
    const selectedImageModel =
      imageModels.find((item) => item.id === storedImageModel) ?? imageModels[0];
    setImageModel(selectedImageModel.id);
    setImageProvider(selectedImageModel.provider);
  }, []);

  useEffect(() => {
    loadSession();
    window.addEventListener("carabasai-active-project-change", loadSession);
    return () =>
      window.removeEventListener(
        "carabasai-active-project-change",
        loadSession,
      );
  }, [loadSession]);

  const savedSpecialist = session?.characterCastingSpecialist;
  const savedSpecialistId =
    session?.characterCasting?.specialistId ?? savedSpecialist?.id;
  // Resolve saved selections against the current roster. Older projects contain
  // a serialized Elias profile with only four portfolio images.
  const specialist =
    characterCastingSpecialists.find((item) => item.id === savedSpecialistId) ??
    savedSpecialist ??
    characterCastingSpecialists[0];
  const casting = session?.characterCasting ?? {};
  const messages = casting.messages ?? [];
  const generationMessages = (casting.generationMessages ?? []).filter(
    (message) => message.role === "user" || Boolean(message.image),
  );
  const characters = normalizeCastNotebook(casting.characters ?? []);
  const availableCastingRoles = characters.filter(
    (member) => !member.image && !member.storagePath,
  );
  const candidate = casting.candidate;
  const candidatePool = casting.candidatePool ?? [];
  const projectCast = casting.myCast ?? [];
  const generationFlow = casting.generationFlow;

  const candidateKey = (item: Candidate) => item.storagePath ?? item.image;
  const addToCandidatePool = (pool: Candidate[], item: Candidate) =>
    pool.some((saved) => candidateKey(saved) === candidateKey(item))
      ? pool
      : [item, ...pool];
  const myCast = [...projectCast, ...accountCast].filter(
    (item, index, all) =>
      all.findIndex((saved) => candidateKey(saved) === candidateKey(item)) ===
      index,
  );

  useEffect(() => {
    const collect = (projects: CastingSession[]) => {
      const actors = projects.flatMap(
        (project) => project.characterCasting?.myCast ?? [],
      );
      setAccountCast(
        actors.filter(
          (item, index, all) =>
            all.findIndex(
              (saved) =>
                (saved.storagePath ?? saved.image) ===
                (item.storagePath ?? item.image),
            ) === index,
        ),
      );
    };
    const refresh = () => collect(getCachedProjects<CastingSession>());
    refresh();
    void syncProjects<CastingSession>().then(collect).catch(console.error);
    window.addEventListener(projectChangeEvent, refresh);
    return () => window.removeEventListener(projectChangeEvent, refresh);
  }, []);

  async function addCandidateToMyCast(
    item: Candidate | undefined = candidate,
  ) {
    if (!session || !item) return;
    if (
      myCast.some((saved) => candidateKey(saved) === candidateKey(item))
    ) {
      await platformNotice({
        eyebrow: "MY CAST",
        title: "ALREADY IN YOUR CAST",
        message: `${item.actorName ?? "Этот персонаж"} уже находится в вашем касте.`,
        confirmLabel: "OK",
      });
      return;
    }
    persist({
      ...session,
      characterCasting: {
        ...casting,
        myCast: addToCandidatePool(projectCast, item),
      },
    });
  }

  async function downloadCandidate(item: Candidate | undefined = candidate) {
    if (!item) return;
    const response = await fetch(item.image);
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${item.actorName ?? "casting-candidate"}.png`;
    link.click();
    URL.revokeObjectURL(url);
  }

  async function shareCandidate(item: Candidate | undefined = candidate) {
    if (!item) return;
    if (navigator.share) {
      await navigator.share({
        title: item.actorName ?? "Casting candidate",
        text: "Casting candidate from Carabasai Studio",
        url: item.image,
      });
      return;
    }
    await navigator.clipboard.writeText(item.image);
  }

  function startHiringCandidate(item: Candidate) {
    if (!session) return;
    const russian = /[А-Яа-яЁё]/.test(
      JSON.stringify(session.projectDocument ?? ""),
    );
    persist({
      ...session,
      characterCasting: {
        ...casting,
        candidate: item,
        myCast: addToCandidatePool(projectCast, item),
        generationFlow: { stage: "hire-role", russian },
      },
    });
  }

  function cancelPendingHire() {
    if (!session || generationFlow?.stage !== "hire-role") return;
    persist({
      ...session,
      characterCasting: {
        ...casting,
        candidate: undefined,
        generationFlow: undefined,
      },
    });
  }

  function deleteCandidate() {
    if (!session || !candidate) return;
    persist({
      ...session,
      characterCasting: {
        ...casting,
        candidate: undefined,
      },
    });
    setCandidatePreviewOpen(false);
  }

  function chooseMyCastCharacter(item: Candidate) {
    if (!session) return;
    const russian = /[А-Яа-яЁё]/.test(
      JSON.stringify(session.projectDocument ?? ""),
    );
    const question: ChatMessage = {
      id: uid(),
      role: "assistant",
      content: russian ? "На какую роль берём?" : "Which role are we casting?",
    };
    persist({
      ...session,
      characterCasting: {
        ...casting,
        messages: [...messages, question],
        candidate: item,
        generationFlow: { stage: "hire-role", russian },
      },
    });
    setMyCastOpen(false);
  }

  function fireMyCastCharacter(item: Candidate) {
    if (!session) return;
    const key = candidateKey(item);
    const updatedProjects = getCachedProjects<CastingSession>().map(
      (project) => ({
        ...project,
        characterCasting: project.characterCasting
          ? {
              ...project.characterCasting,
              myCast: (project.characterCasting.myCast ?? []).filter(
                (saved) => candidateKey(saved) !== key,
              ),
            }
          : project.characterCasting,
      }),
    );
    saveProjects(updatedProjects);
    setAccountCast((current) =>
      current.filter((saved) => candidateKey(saved) !== key),
    );
    const updatedSession = updatedProjects.find(
      (project) => project.id === session.id,
    );
    if (updatedSession) persist(updatedSession);
    setSelectedMyCastKey("");
  }

  const askAgent = useCallback(
    async (
      current: CastingSession,
      nextMessages: ChatMessage[],
      initial = false,
      visualAttachments: CharacterAttachment[] = [],
    ) => {
      const response = await authenticatedFetch("/api/casting-room", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: AbortSignal.timeout(65000),
        body: JSON.stringify({
          provider,
          summary: current.projectDocument,
          specialist,
          messages: nextMessages.map(({ role, content }) => ({
            role,
            content,
          })),
          cast: current.characterCasting?.characters ?? [],
          attachments: visualAttachments.map(({ image, name }) => ({
            image,
            label: name,
          })),
          initial,
        }),
      });
      const data = (await response.json()) as {
        reply?: string;
        characters?: Array<{ name: string; role: string; description: string }>;
        error?: string;
      };
      if (!response.ok || !data.reply)
        throw new Error(data.error ?? "CASTING AGENT COULD NOT RESPOND.");
      const existing = normalizeCastNotebook(
        current.characterCasting?.characters ?? [],
      );
      const detected = normalizeCastNotebook(
        (data.characters ?? []).map((item, index) => {
          return {
            id: `story-${index}-${item.name}`,
            ...item,
          } as CastMember;
        }),
      );
      // Once the notebook exists, it is user-owned state. The language model may
      // discuss it, but it must never reorder roles or move actor assignments.
      const merged = existing.length > 0 ? existing : detected;
      const reply: ChatMessage = {
        id: uid(),
        role: "assistant",
        content: data.reply,
      };
      return { reply, characters: merged };
    },
    [provider, specialist],
  );

  useEffect(() => {
    if (!session) return;
    const saved = session.characterCastingSpecialist;
    const portfolioIsCurrent =
      saved?.id === specialist.id &&
      saved.characterExamples.length === specialist.characterExamples.length &&
      saved.characterExamples.every(
        (item, index) =>
          item.image === specialist.characterExamples[index]?.image &&
          item.name === specialist.characterExamples[index]?.name,
      );
    if (portfolioIsCurrent) return;
    persist({ ...session, characterCastingSpecialist: specialist });
  }, [session, specialist, persist]);

  useEffect(() => {
    if (!session || casting.initialized) return;
    const requestKey = `${session.id}:${specialist.id}`;
    if (initialRequestRef.current === requestKey) return;
    initialRequestRef.current = requestKey;
    setBusyMode("summary");
    setError("");
    void askAgent(session, [], true)
      .then(({ reply, characters: found }) => {
        persist({
          ...session,
          characterCastingSpecialist: specialist,
          characterCasting: {
            ...casting,
            specialistId: specialist.id,
            initialized: true,
            messages: [reply],
            characters: found,
          },
        });
      })
      .catch((e: Error) => {
        setError(
          e.name === "TimeoutError"
            ? "THE CASTING AGENT TOOK TOO LONG TO STUDY THE SUMMARY. YOU CAN STILL SEND A MESSAGE."
            : e.message,
        );
        persist({
          ...session,
          characterCastingSpecialist: specialist,
          characterCasting: {
            ...casting,
            specialistId: specialist.id,
            initialized: true,
          },
        });
      })
      .finally(() => setBusyMode(null));
  }, [session, casting, specialist.id, askAgent, persist]);

  function setProviderChoice(value: "anthropic" | "openai") {
    setProvider(value);
    localStorage.setItem("carabasaiAIProvider", value);
  }

  function setImageModelChoice(value: ImageModelId) {
    const model = imageModels.find((item) => item.id === value) ?? imageModels[0];
    setImageModel(model.id);
    setImageProvider(model.provider);
    localStorage.setItem("carabasaiCastingImageModel", model.id);
    localStorage.setItem("carabasaiCastingImageProvider", model.provider);
  }

  function choosePortfolioCharacter(
    character: CharacterCastingSpecialist["characterExamples"][number],
  ) {
    if (!session) return;
    const russian = /[А-Яа-яЁё]/.test(
      JSON.stringify(session.projectDocument ?? ""),
    );
    const question: ChatMessage = {
      id: uid(),
      role: "assistant",
      content: russian ? "На какую роль берём?" : "Which role are we casting?",
    };
    persist({
      ...session,
      characterCasting: {
        ...casting,
        messages: [...messages, question],
        candidate: {
          image: character.image,
          actorName: character.name,
          source: "portfolio",
        },
        generationFlow: { stage: "hire-role", russian },
      },
    });
    setPreview("");
    setPortfolioOpen(false);
  }

  function attachCharacter(member: CastMember) {
    if (!member.image) return;
    const image = member.image;
    setCharacterAttachments((current) =>
      current.some((item) => item.image === image)
        ? current
        : [
            ...current,
            {
              id: uid(),
              name: member.actorName ?? member.name ?? member.role,
              image,
              actorName: member.actorName,
              storagePath: member.storagePath,
              source: member.source ?? "portfolio",
            },
          ],
    );
  }

  function rejectCandidate() {
    if (!session || !candidate) return;
    if (!generationFlow?.brief) {
      persist({
        ...session,
        characterCasting: {
          ...casting,
          candidate: undefined,
          candidatePool: addToCandidatePool(candidatePool, candidate),
        },
      });
      return;
    }
    const russian = generationFlow?.russian ?? true;
    const reply: ChatMessage = {
      id: uid(),
      role: "assistant",
      content: russian
        ? "Этот кандидат нам не подошёл. Меняем критерии или генерируем ещё раз?"
        : "This candidate did not fit. Shall we change the criteria or generate another one?",
    };
    persist({
      ...session,
      characterCasting: {
        ...casting,
        messages: [...messages, reply],
        candidate: undefined,
        candidatePool: addToCandidatePool(candidatePool, candidate),
        generationFlow: { ...generationFlow, stage: "rejected" },
      },
    });
  }

  function hireCandidate() {
    if (!session || !candidate) return;
    const knownRole = characters.find(
      (item) => item.id === generationFlow?.roleId,
    );
    if (knownRole) {
      assignCandidateToRole(knownRole);
      return;
    }
    if (generationFlow?.stage === "hire-role") return;
    const russian =
      generationFlow?.russian ??
      /[А-Яа-яЁё]/.test(JSON.stringify(session.projectDocument ?? ""));
    const question: ChatMessage = {
      id: uid(),
      role: "assistant",
      content: russian ? "На какую роль берём?" : "Which role are we casting?",
    };
    persist({
      ...session,
      characterCasting: {
        ...casting,
        messages: [...messages, question],
        generationFlow: { stage: "hire-role", russian },
      },
    });
  }

  async function assignCandidateToRole(member: CastMember) {
    if (!session || !candidate) return;
    if (member.image || member.storagePath) {
      const replaceActor = await platformConfirm({
        eyebrow: "CHARACTER NOTEBOOK",
        title: "THIS ROLE IS ALREADY CAST",
        message: `Роль «${member.role || member.name}» уже занята${member.actorName ? ` актёром ${member.actorName}` : ""}. Хотите заменить актёра?`,
        confirmLabel: "REPLACE ACTOR",
        cancelLabel: "CANCEL",
        tone: "danger",
      });
      if (!replaceActor) return;
    }
    const russian = generationFlow?.russian ?? true;
    const hired: CastMember = {
      ...member,
      actorName: candidate.actorName,
      image: candidate.image,
      storagePath: candidate.storagePath,
      source: candidate.source,
    };
    const selected: ChatMessage = {
      id: uid(),
      role: "user",
      content: `${russian ? "РОЛЬ" : "ROLE"}: ${member.role || member.name}`,
    };
    const confirmation: ChatMessage = {
      id: uid(),
      role: "assistant",
      content: russian
        ? `Берём ${candidate.actorName ?? "кандидата"} на роль «${member.role || member.name}». Кто следующий?`
        : `Cast ${candidate.actorName ?? "this candidate"} as “${member.role || member.name}”. Who is next?`,
    };
    persist({
      ...session,
      characterCasting: {
        ...casting,
        messages: [...messages, selected, confirmation],
        characters: characters.map((item) =>
          item.id === member.id ? hired : item,
        ),
        candidate: undefined,
        pendingRoleMemberId: undefined,
        generationFlow: undefined,
        candidatePool: candidatePool.filter(
          (item) => candidateKey(item) !== candidateKey(candidate),
        ),
      },
    });
  }

  function unassignActorFromRole(member: CastMember) {
    if (!session || !member.image) return;
    const released: Candidate = {
      image: member.image,
      actorName: member.actorName,
      storagePath: member.storagePath,
      source: member.source ?? "generated",
      description: member.description,
    };
    persist({
      ...session,
      characterCasting: {
        ...casting,
        characters: characters.map((item) =>
          item.id === member.id
            ? {
                ...item,
                actorName: undefined,
                image: undefined,
                storagePath: undefined,
                source: undefined,
              }
            : item,
        ),
        myCast: addToCandidatePool(projectCast, released),
      },
    });
  }

  async function generateCandidate(brief: string, current: CastingSession) {
    const response = await authenticatedFetch("/api/character-generation", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectId: current.id,
        specialistId: specialist.id,
        characterBrief: brief,
        aspectRatio: "9:16",
        imageProvider,
      }),
    });
    const data = (await response.json()) as {
      imageUrl?: string;
      storagePath?: string;
      actorName?: string;
      error?: string;
    };
    if (!response.ok || !data.imageUrl)
      throw new Error(data.error ?? "CHARACTER COULD NOT BE GENERATED.");
    return {
      image: data.imageUrl,
      actorName: data.actorName,
      storagePath: data.storagePath,
      source: "generated" as const,
      description: brief,
    };
  }

  function beginGeneration(content: string) {
    if (!session) return;
    const russian = /[А-Яа-яЁё]/.test(content);
    const userMessage: ChatMessage = { id: uid(), role: "user", content };
    const reply: ChatMessage = {
      id: uid(),
      role: "assistant",
      content: russian
        ? "На какую роль ищем актёра? Выберите роль из блокнота."
        : "Which role are we casting? Choose a role from the notebook.",
    };
    setInput("");
    setError("");
    persist({
      ...session,
      characterCasting: {
        ...casting,
        messages: [...messages, userMessage, reply],
        generationFlow: { stage: "choose-role", russian },
      },
    });
  }

  function roleMentionedIn(text: string) {
    const normalizedText = text
      .trim()
      .toLocaleLowerCase()
      .replace(/[«»"'`.,:;!?()[\]{}]/g, " ")
      .replace(/\s+/g, " ");
    return [...availableCastingRoles]
      .sort(
        (left, right) =>
          normalizeRoleKey(right).length - normalizeRoleKey(left).length,
      )
      .find((member) => {
        const role = normalizeRoleKey(member);
        return role.length > 1 && normalizedText.includes(role);
      });
  }

  function prepareGenerationForRole(
    member: CastMember,
    appearance: string,
    submittedContent: string,
  ) {
    if (!session) return;
    const russian = /[А-Яа-яЁё]/.test(`${appearance} ${submittedContent}`);
    const roleLabel = member.role || member.name;
    const userMessage: ChatMessage = {
      id: uid(),
      role: "user",
      content: submittedContent,
    };
    const reply: ChatMessage = {
      id: uid(),
      role: "assistant",
      content: russian
        ? `Критерии для роли «${roleLabel}» зафиксированы. Запустите настоящую генерацию кнопкой ниже.`
        : `The criteria for “${roleLabel}” are ready. Start the real generation with the button below.`,
    };
    setInput("");
    setError("");
    persist({
      ...session,
      characterCasting: {
        ...casting,
        messages: [...messages, userMessage, reply],
        generationFlow: {
          stage: "ready",
          roleId: member.id,
          roleLabel,
          brief: `ROLE: ${roleLabel}. NON-NEGOTIABLE APPEARANCE: ${appearance}`,
          russian,
        },
      },
    });
  }

  async function selectGenerationRole(member: CastMember) {
    if (!session || busy) return;
    const russian = generationFlow?.russian ?? true;
    const roleLabel = member.role || member.name;
    const selected: ChatMessage = {
      id: uid(),
      role: "user",
      content: `${russian ? "РОЛЬ" : "ROLE"}: ${roleLabel}`,
    };
    const nextMessages = [...messages, selected];
    const knowsRole = Boolean(
      member.description &&
      !/Role added manually|added manually|role to cast/i.test(
        member.description,
      ),
    );
    if (!knowsRole) {
      const reply: ChatMessage = {
        id: uid(),
        role: "assistant",
        content: russian
          ? "Эту роль я пока не знаю. Опишите возраст, внешность, телосложение и важные особенности."
          : "I do not know this role yet. Describe the age, appearance, build and defining features.",
      };
      persist({
        ...session,
        characterCasting: {
          ...casting,
          messages: [...nextMessages, reply],
          generationFlow: {
            stage: "describe",
            roleId: member.id,
            roleLabel,
            russian,
          },
        },
      });
      return;
    }
    setBusyMode("reply");
    setError("");
    try {
      const control: ChatMessage = {
        id: uid(),
        role: "user",
        content: `Casting only: propose a concise physical appearance for the role "${roleLabel}" using this known role description: ${member.description}. End by saying the candidate is ready to generate.`,
      };
      const { reply } = await askAgent(session, [...nextMessages, control]);
      persist({
        ...session,
        characterCasting: {
          ...casting,
          messages: [...nextMessages, reply],
          generationFlow: {
            stage: "ready",
            roleId: member.id,
            roleLabel,
            brief: `ROLE: ${roleLabel}. ROLE CONTEXT: ${member.description}`,
            russian,
          },
        },
      });
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "CASTING AGENT COULD NOT RESPOND.",
      );
    } finally {
      setBusyMode(null);
    }
  }

  async function generateActor() {
    if (!session || busy || !generationFlow?.brief) return;
    setBusyMode("generation");
    setError("");
    try {
      const generated = await generateCandidate(generationFlow.brief, session);
      const reply: ChatMessage = {
        id: uid(),
        role: "assistant",
        content: generationFlow.russian
          ? "Кандидат готов. Он появился в блоке CAST слева. Нанимаем или отказываем?"
          : "The candidate is ready in the CAST tray. Hire or reject?",
      };
      persist({
        ...session,
        characterCasting: {
          ...casting,
          messages: [...messages, reply],
          candidate: generated,
          generationFlow: { ...generationFlow, stage: "candidate" },
        },
      });
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "CHARACTER COULD NOT BE GENERATED.",
      );
    } finally {
      setBusyMode(null);
    }
  }

  async function generateFromMainInput() {
    if (!session || busy) return;
    const brief = input.trim() || generationFlow?.brief?.trim() || "";
    if (!brief) return;
    const russian = /[А-Яа-яЁё]/.test(brief);
    const userMessage: ChatMessage = {
      id: uid(),
      role: "user",
      content: brief,
    };
    const conversation = [...generationMessages, userMessage];
    setInput("");
    setBusyMode("generation");
    setError("");
    persist({
      ...session,
      characterCasting: {
        ...casting,
        generationMessages: conversation,
      },
    });
    try {
      const generated = await generateCandidate(brief, session);
      const generatedMessage: ChatMessage = {
        id: uid(),
        role: "assistant",
        content: russian ? "Новый кандидат готов." : "The new candidate is ready.",
        image: generated.image,
        candidate: generated,
      };
      persist({
        ...session,
        characterCasting: {
          ...casting,
          generationMessages: [...conversation, generatedMessage],
          candidate: generated,
          candidatePool: addToCandidatePool(candidatePool, generated),
          generationFlow: {
            stage: "candidate",
            brief,
            russian,
          },
        },
      });
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "CHARACTER COULD NOT BE GENERATED.",
      );
    } finally {
      setBusyMode(null);
    }
  }

  async function sendMessage(rawContent = input) {
    const content = rawContent.trim();
    if (!session || !content || busy) return;
    const wantsGeneration =
      /сгенер|созда[йт]|сделай.{0,24}(акт[её]р|персонаж|кандидат)|нов(ого|ый) (акт[её]р|персонаж|кандидат)|generate|new (actor|candidate|character)/i.test(
        content,
      );
    const directlyMentionedRole = roleMentionedIn(content);
    if (!generationFlow && directlyMentionedRole) {
      prepareGenerationForRole(directlyMentionedRole, content, content);
      return;
    }
    const confirmsGeneration =
      /^(да|давай|ок|окей|генерируй|запускай|yes|ok|okay|generate|go)[.!\s]*$/i.test(
        content,
      );
    if (!generationFlow && confirmsGeneration) {
      const previousRequest = [...messages]
        .reverse()
        .find(
          (message) =>
            message.role === "user" &&
            Boolean(roleMentionedIn(message.content)),
        );
      const previousRole = previousRequest
        ? roleMentionedIn(previousRequest.content)
        : undefined;
      if (previousRequest && previousRole) {
        prepareGenerationForRole(
          previousRole,
          previousRequest.content,
          content,
        );
        return;
      }
    }
    if (!generationFlow && wantsGeneration) {
      beginGeneration(content);
      return;
    }
    if (generationFlow?.stage === "ready" && confirmsGeneration) {
      const userMessage: ChatMessage = { id: uid(), role: "user", content };
      const reply: ChatMessage = {
        id: uid(),
        role: "assistant",
        content: generationFlow.russian
          ? "Генерация ещё не запускалась. Нажмите кнопку GENERATE CANDIDATE ниже."
          : "Generation has not started yet. Press GENERATE CANDIDATE below.",
      };
      setInput("");
      setError("");
      persist({
        ...session,
        characterCasting: {
          ...casting,
          messages: [...messages, userMessage, reply],
          generationFlow,
        },
      });
      return;
    }
    setInput("");
    setError("");
    setBusyMode("reply");
    const userMessage: ChatMessage = { id: uid(), role: "user", content };
    const nextMessages = [...messages, userMessage];
    let current: CastingSession = {
      ...session,
      characterCasting: { ...casting, messages: nextMessages },
    };
    persist(current);
    try {
      if (generationFlow?.stage === "describe") {
        const control: ChatMessage = {
          id: uid(),
          role: "user",
          content: `Casting only: briefly state what actor is needed for the role "${generationFlow.roleLabel}" from the user's appearance criteria. End by saying the candidate is ready to generate.`,
        };
        const { reply } = await askAgent(current, [...nextMessages, control]);
        persist({
          ...current,
          characterCasting: {
            ...current.characterCasting,
            messages: [...nextMessages, reply],
            generationFlow: {
              ...generationFlow,
              stage: "ready",
              brief: `ROLE: ${generationFlow.roleLabel}. NON-NEGOTIABLE APPEARANCE: ${content}`,
            },
          },
        });
        setCharacterAttachments([]);
        return;
      }
      const activeCandidateAttachment: CharacterAttachment[] = current
        .characterCasting?.candidate
        ? [
            {
              ...current.characterCasting.candidate,
              id: uid(),
              name:
                current.characterCasting.candidate.actorName ??
                "CURRENT CAST CANDIDATE",
            },
          ]
        : [];
      const visuals = [
        ...characterAttachments,
        ...activeCandidateAttachment,
      ].filter(
        (item, index, all) =>
          all.findIndex(
            (candidateItem) => candidateItem.image === item.image,
          ) === index,
      );
      const { reply, characters: found } = await askAgent(
        current,
        nextMessages,
        false,
        visuals,
      );
      let updatedCast = found;
      const pendingRoleId = current.characterCasting?.pendingRoleMemberId;
      if (pendingRoleId) {
        updatedCast = found.map((item) =>
          item.id === pendingRoleId
            ? {
                ...item,
                role: content.slice(0, 80),
                name:
                  item.name === "NEW CAST MEMBER"
                    ? content.slice(0, 80)
                    : item.name,
              }
            : item,
        );
        current = {
          ...current,
          characterCasting: {
            ...current.characterCasting,
            pendingRoleMemberId: undefined,
          },
        };
      }
      persist({
        ...current,
        characterCasting: {
          ...current.characterCasting,
          messages: [...nextMessages, reply],
          characters: updatedCast,
        },
      });
      setCharacterAttachments([]);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "CASTING AGENT COULD NOT RESPOND.",
      );
    } finally {
      setBusyMode(null);
    }
  }

  function removeCharacter(id: string) {
    if (!session) return;
    persist({
      ...session,
      characterCasting: {
        ...casting,
        characters: characters.filter((item) => item.id !== id),
      },
    });
  }

  function normalizedRoleName(value: string) {
    return value
      .trim()
      .replace(/\s*[×x]\s*\d+$/i, "")
      .toLocaleLowerCase()
      .replace(/\s+/g, " ");
  }

  async function resolveDuplicateRole(role: string, excludedId?: string) {
    const duplicates = characters.filter(
      (item) =>
        item.id !== excludedId &&
        normalizedRoleName(item.role || item.name) === normalizedRoleName(role),
    );
    if (duplicates.length === 0) return role;
    const keepBoth = await platformConfirm({
      eyebrow: "CHARACTER NOTEBOOK",
      title: "THIS ROLE ALREADY EXISTS",
      message: `Роль «${role}» уже есть. Измените название или оставьте обе роли.`,
      confirmLabel: "KEEP BOTH",
      cancelLabel: "CHANGE NAME",
    });
    return keepBoth ? `${role} ×${duplicates.length + 1}` : null;
  }

  async function addRole() {
    const enteredRole = newRoleDraft.trim();
    if (!session || !enteredRole) return;
    const role = await resolveDuplicateRole(enteredRole);
    if (!session || !role) return;
    const member: CastMember = {
      id: uid(),
      name: "ROLE TO CAST",
      role,
      description: "Role added manually during casting.",
    };
    persist({
      ...session,
      characterCasting: { ...casting, characters: [...characters, member] },
    });
    setNewRoleDraft("");
    setAddingRole(false);
  }

  async function saveRole(member: CastMember) {
    const enteredRole = roleDraft.trim();
    if (!session || !enteredRole) return;
    const role = await resolveDuplicateRole(enteredRole, member.id);
    if (!role) return;
    persist({
      ...session,
      characterCasting: {
        ...casting,
        characters: characters.map((item) =>
          item.id === member.id ? { ...item, role } : item,
        ),
      },
    });
    setEditingRoleId("");
    setRoleDraft("");
  }

  if (!session)
    return (
      <main className="min-h-screen bg-[#050505] text-white">
        <StudioSidebar />
        <div className="flex min-h-screen items-center justify-center text-xs font-black text-[#FFDF00]">
          OPENING CASTING ROOM...
        </div>
      </main>
    );

  return (
    <main className="min-h-screen bg-[#050505] px-4 pb-5 pt-20 text-white md:pl-[calc(var(--studio-sidebar-width,260px)+28px)] md:pt-5">
      <StudioSidebar />
      <WorkflowNav />
      <div className="mx-auto grid max-w-7xl gap-3 lg:grid-cols-[290px_minmax(0,1fr)] lg:gap-5">
        <aside className="space-y-2 lg:space-y-4">
          <button
            onClick={() => setPortfolioOpen(true)}
            className="w-full rounded-[18px] border border-[#FFDF00]/25 bg-[#FFDF00]/[.035] p-3 text-left lg:rounded-[22px] lg:p-4"
          >
            <div className="flex items-center gap-3">
              <Image
                src={specialist.portrait}
                alt=""
                width={58}
                height={58}
                className="h-11 w-11 rounded-[12px] object-cover object-top lg:h-14 lg:w-14 lg:rounded-[14px]"
              />
              <div>
                <p className="text-[8px] font-black tracking-[.14em] text-[#FFDF00]">
                  CASTING LEAD
                </p>
                <h2 className="mt-1 text-base font-black">{specialist.name}</h2>
                <p className="mt-1 text-[8px] text-white/35">
                  CHANGE SPECIALIST →
                </p>
              </div>
            </div>
          </button>
          <button
            onClick={() => setPortfolioOpen(true)}
            className="w-full rounded-full border border-white/10 px-4 py-2 text-[8px] font-black hover:border-[#FFDF00]/40 lg:px-5 lg:py-3 lg:text-[9px]"
          >
            OPEN PORTFOLIO / 20
          </button>
          <button
            onClick={() => {
              setSelectedMyCastKey("");
              setMyCastOpen(true);
            }}
            className="w-full rounded-full border border-[#FFDF00]/25 bg-[#FFDF00]/[.035] px-4 py-2 text-[8px] font-black text-[#FFDF00] hover:border-[#FFDF00]/55 lg:px-5 lg:py-3 lg:text-[9px]"
          >
            OPEN MY CAST / {myCast.length}
          </button>
          <section className="max-h-[280px] overflow-x-hidden overflow-y-auto rounded-[18px] border border-white/10 p-3 lg:max-h-[520px] lg:rounded-[22px] lg:p-4">
            <div className="sticky -top-3 z-20 -mx-3 -mt-3 border-b border-white/5 bg-[#050505] px-3 pb-3 pt-3 lg:-top-4 lg:-mx-4 lg:-mt-4 lg:px-4 lg:pt-4">
              <div className="flex items-center justify-between">
                <p className="text-[9px] font-black tracking-[.14em] text-[#FFDF00]">
                  CHARACTER NOTEBOOK
                </p>
                <button
                  title="Add a new role"
                  onClick={() => setAddingRole((value) => !value)}
                  className="text-lg text-[#FFDF00]"
                >
                  ＋
                </button>
              </div>
              {addingRole && (
                <div className="mt-3 flex gap-2 rounded-xl border border-[#FFDF00]/25 bg-black p-2">
                  <input
                    autoFocus
                    value={newRoleDraft}
                    onChange={(event) => setNewRoleDraft(event.target.value)}
                    onKeyDown={(event) => event.key === "Enter" && addRole()}
                    placeholder="NEW ROLE"
                    className="min-w-0 flex-1 bg-transparent px-2 text-[9px] outline-none placeholder:text-white/25"
                  />
                  <button
                    onClick={addRole}
                    disabled={!newRoleDraft.trim()}
                    className="rounded-full bg-[#FFDF00] px-3 py-2 text-[8px] font-black text-black disabled:opacity-25"
                  >
                    ADD
                  </button>
                </div>
              )}
            </div>
            {characters.length ? (
              <div className="space-y-2">
                {characters.map((member) => (
                  <article
                    key={member.id}
                    className="flex items-center gap-2 rounded-xl border border-white/8 p-2"
                  >
                    {member.image ? (
                      <button
                        title={generationFlow?.stage === "hire-role" && candidate ? "Assign candidate to this role" : "Attach this character to the next message"}
                        onClick={() => generationFlow?.stage === "hire-role" && candidate ? assignCandidateToRole(member) : attachCharacter(member)}
                        className={`relative shrink-0 rounded-full transition hover:ring-2 hover:ring-[#FFDF00] ${generationFlow?.stage === "hire-role" && candidate ? "ring-2 ring-[#FFDF00]" : ""}`}
                      >
                        <Image
                          src={member.image}
                          alt={member.actorName ?? member.name}
                          width={40}
                          height={40}
                          unoptimized={member.image.startsWith("http")}
                          className="h-10 w-10 rounded-full object-cover object-top"
                        />
                        <span className="absolute -bottom-1 -right-1 rounded-full bg-[#FFDF00] px-1 text-[8px] font-black text-black">
                          ＋
                        </span>
                      </button>
                    ) : (
                      <button
                        type="button"
                        disabled={generationFlow?.stage !== "hire-role" || !candidate}
                        onClick={() => assignCandidateToRole(member)}
                        title={candidate ? "Assign candidate to this role" : "No actor assigned"}
                        className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-xs transition ${generationFlow?.stage === "hire-role" && candidate ? "bg-[#FFDF00]/10 text-[#FFDF00] ring-2 ring-[#FFDF00] hover:bg-[#FFDF00] hover:text-black" : "bg-white/5 text-white/45"}`}
                      >
                        ?
                      </button>
                    )}
                    <div className="min-w-0 flex-1">
                      {editingRoleId === member.id ? (
                        <div className="flex gap-1">
                          <input
                            autoFocus
                            value={roleDraft}
                            onChange={(event) =>
                              setRoleDraft(event.target.value)
                            }
                            onKeyDown={(event) =>
                              event.key === "Enter" && saveRole(member)
                            }
                            className="min-w-0 flex-1 rounded-md border border-[#FFDF00]/35 bg-black px-2 py-1 text-[8px] outline-none"
                          />
                          <button
                            onClick={() => saveRole(member)}
                            className="text-[8px] font-black text-[#FFDF00]"
                          >
                            OK
                          </button>
                        </div>
                      ) : (
                        <>
                          <button
                            onClick={() => {
                              setEditingRoleId(member.id);
                              setRoleDraft(member.role || member.name);
                            }}
                            className="flex max-w-full items-center gap-1 text-left text-[9px] font-black text-white/90 hover:text-[#FFDF00]"
                          >
                            <span className="truncate">
                              {member.role || member.name}
                            </span>
                            <span>✎</span>
                          </button>
                          <p className="mt-1 truncate text-[8px] text-white/35">
                            {member.actorName ?? "NO ACTOR"}
                          </p>
                        </>
                      )}
                    </div>
                    {member.image && (
                      <button
                        title="Unassign actor from role"
                        onClick={() => unassignActorFromRole(member)}
                        className="rounded-full border border-white/10 px-2 py-1 text-[7px] font-black text-white/35 hover:border-red-300/40 hover:text-red-200"
                      >
                        UNLINK
                      </button>
                    )}
                    <button
                      title="Delete character"
                      onClick={() => removeCharacter(member.id)}
                      className="px-1 text-white/25 hover:text-red-300"
                    >
                      ×
                    </button>
                  </article>
                ))}
                {generationFlow?.stage === "hire-role" && candidate && (
                  <div className="relative mt-4 rounded-[18px] border border-[#FFDF00]/30 bg-[#FFDF00]/[.035] p-4">
                    <button
                      type="button"
                      onClick={cancelPendingHire}
                      aria-label="Reject pending actor"
                      title="Reject pending actor"
                      className="absolute right-3 top-3 flex h-6 w-6 items-center justify-center rounded-full border border-red-400/35 bg-red-500/10 text-sm font-black leading-none text-red-300 transition hover:bg-red-500/25 hover:text-red-100"
                    >
                      ×
                    </button>
                    <p className="text-[8px] font-black tracking-[.12em] text-[#FFDF00]">READY TO HIRE</p>
                    <div className="mt-3 flex items-center gap-4">
                      <img src={candidate.image} alt={candidate.actorName ?? "Candidate to hire"} className="h-32 w-24 shrink-0 rounded-xl object-cover object-top" />
                      <div className="min-w-0">
                        <p className="truncate text-[10px] font-black text-white/80">{candidate.actorName ?? "NEW CANDIDATE"}</p>
                        <p className="mt-2 text-[9px] leading-5 text-white/35">CLICK A ROLE CIRCLE TO ASSIGN THIS ACTOR.</p>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <p className="text-[10px] leading-5 text-white/30">
                The specialist is reading the project document.
              </p>
            )}
          </section>
        </aside>
        <section className="flex h-[calc(100dvh-5.25rem)] min-h-0 flex-col overflow-hidden rounded-[22px] border border-white/10 bg-[#0A0A0A] lg:h-[calc(100dvh-105px)] lg:min-h-[620px] lg:rounded-[28px]">
          <header className="shrink-0 border-b border-white/10 p-3 sm:p-5">
            <p className="text-[9px] font-black tracking-[.18em] text-[#FFDF00]">
              CHARACTER GENERATION
            </p>
            <h1 className="mt-1 text-lg font-black sm:mt-2 sm:text-xl">
              BUILD THE FACE THAT CARRIES THE STORY.
            </h1>
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto p-3 sm:p-7">
            <div className="mx-auto max-w-5xl space-y-4">
              <section className="overflow-hidden rounded-[24px] border border-white/10 bg-black">
                <header className="flex items-center justify-between gap-4 border-b border-white/10 px-5 py-4">
                  <div>
                    <p className="text-[8px] font-black tracking-[.16em] text-[#FFDF00]">
                      GENERATION STAGE
                    </p>
                    <p className="mt-1 text-sm font-black text-white/85">
                      {candidate?.actorName ?? "NO CANDIDATE YET"}
                    </p>
                  </div>
                  <span className="rounded-full border border-white/10 px-3 py-2 text-[8px] font-black text-white/35">
                    9:16 PORTRAIT
                  </span>
                </header>
                <div className={`min-h-[280px] p-3 sm:min-h-[460px] sm:p-5 ${generationMessages.length > 0 ? "space-y-5" : "flex items-center justify-center"}`}>
                  {generationMessages.length > 0 ? (
                    generationMessages.map((message) => (
                      <article key={message.id} className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}>
                        <div className={`max-w-[82%] rounded-[20px] border p-4 ${message.role === "user" ? "border-[#FFDF00] bg-[#FFDF00] text-black" : "border-[#FFDF00]/20 bg-[#17150b] text-white/70"}`}>
                          <p className="text-[8px] font-black tracking-[.12em] opacity-55">
                            {message.role === "user" ? "YOU / DIRECTOR" : specialist.name}
                          </p>
                          <p className="mt-2 text-sm leading-6">{message.content}</p>
                          {message.image && message.candidate && (
                            <div className="mt-3 max-w-full">
                              <button
                                type="button"
                                onClick={() => {
                                  persist({ ...session, characterCasting: { ...casting, candidate: message.candidate } });
                                  setCandidatePreviewOpen(true);
                                }}
                                className="block overflow-hidden rounded-[16px] border border-white/10"
                              >
                                <img src={message.image} alt={message.candidate.actorName ?? "Generated candidate"} className="max-h-[620px] w-full object-contain" />
                              </button>
                              <div className="mt-2 grid max-w-full grid-cols-2 gap-1.5 sm:grid-cols-4">
                                <button onClick={() => addCandidateToMyCast(message.candidate)} className="rounded-full border border-[#FFDF00]/35 px-2 py-2 text-[7px] font-black text-[#FFDF00]">ADD TO CAST</button>
                                <button onClick={() => void downloadCandidate(message.candidate)} className="rounded-full border border-white/12 px-2 py-2 text-[7px] font-black text-white/55">DOWNLOAD</button>
                                <button onClick={() => void shareCandidate(message.candidate)} className="rounded-full border border-white/12 px-2 py-2 text-[7px] font-black text-white/55">SHARE</button>
                                <button onClick={() => startHiringCandidate(message.candidate!)} className="rounded-full bg-[#FFDF00] px-2 py-2 text-[7px] font-black text-black">HIRE</button>
                              </div>
                            </div>
                          )}
                        </div>
                      </article>
                    ))
                  ) : (
                    <div className="max-w-lg text-center">
                      <div className="mx-auto h-20 w-20 overflow-hidden rounded-full border border-[#FFDF00]/35 bg-[#111] p-1 shadow-[0_0_40px_rgba(255,223,0,.12)]">
                        <Image
                          src={specialist.portrait}
                          alt={specialist.name}
                          width={80}
                          height={80}
                          className="h-full w-full rounded-full object-cover object-top"
                        />
                      </div>
                      <h2 className="mt-5 text-lg font-black">
                        ОПИШИТЕ НУЖНОГО АКТЁРА.
                      </h2>
                      <p className="mt-3 text-[11px] leading-6 text-white/35">
                        Добавьте описание внешности, и наш специалист подберёт
                        подходящих актёров для кастинга. Или выберите кандидата
                        из его портфолио.
                      </p>
                    </div>
                  )}
                </div>
              </section>
              {busyMode === "generation" && (
                <div className="flex items-center gap-3 text-[9px] text-white/35">
                  <span className="h-3 w-3 animate-spin rounded-full border-2 border-[#FFDF00]/25 border-t-[#FFDF00]" />
                  GENERATING ACTOR...
                </div>
              )}
            </div>
          </div>
          {error && (
            <div className="mx-4 mb-2 rounded-xl border border-red-400/20 bg-red-500/5 p-3 text-[9px] text-red-200">
              {error}
            </div>
          )}
          <footer className="shrink-0 border-t border-white/10 p-2.5 sm:p-4">
            <div className="mb-2 flex flex-nowrap items-end justify-between gap-2 overflow-x-auto sm:flex-wrap sm:gap-3">
              <div className="flex shrink-0 gap-2">
                <button
                  onClick={() => fileRef.current?.click()}
                  className="rounded-full border border-white/10 px-4 py-2 text-[8px] font-black"
                >
                  ＋ ADD REFERENCES
                </button>
                <button
                  onClick={() => {
                    setInput("");
                    setAttachments([]);
                    setCharacterAttachments([]);
                  }}
                  className="rounded-full border border-white/10 px-4 py-2 text-[8px] font-black text-white/45"
                >
                  RESET
                </button>
              </div>
              <div className="flex shrink-0 flex-nowrap items-end gap-2 sm:flex-wrap sm:gap-3">
                <div>
                  <div className="mb-1 pl-2 text-[7px] font-black tracking-[0.18em] text-white/25">
                    DIALOGUE
                  </div>
                  <div className="flex rounded-full border border-white/10 p-1">
                    <button
                      onClick={() => setProviderChoice("anthropic")}
                      className={`rounded-full px-4 py-2 text-[8px] font-black ${provider === "anthropic" ? "bg-[#FFDF00] text-black" : "text-white/35"}`}
                    >
                      CLAUDE
                    </button>
                    <button
                      onClick={() => setProviderChoice("openai")}
                      className={`rounded-full px-4 py-2 text-[8px] font-black ${provider === "openai" ? "bg-[#FFDF00] text-black" : "text-white/35"}`}
                    >
                      GPT
                    </button>
                  </div>
                </div>
                <div>
                  <div className="mb-1 pl-2 text-[7px] font-black tracking-[0.18em] text-white/25">
                    IMAGE MODEL
                  </div>
                  <select
                    value={imageModel}
                    onChange={(event) =>
                      setImageModelChoice(event.target.value as ImageModelId)
                    }
                    className="h-9 min-w-[165px] rounded-full border border-white/10 bg-black px-3 text-[8px] font-black text-[#FFDF00] outline-none sm:h-[42px] sm:min-w-[190px] sm:px-4"
                  >
                    {imageModels.map((model) => (
                      <option key={model.id} value={model.id}>
                        {model.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>
            <input
              ref={fileRef}
              type="file"
              multiple
              className="hidden"
              onChange={(event) =>
                setAttachments(
                  Array.from(event.target.files ?? []).map((file) => ({
                    name: file.name,
                  })),
                )
              }
            />
            {(attachments.length > 0 || characterAttachments.length > 0) && (
              <div className="mb-2 flex flex-wrap gap-2">
                {characterAttachments.map((item) => (
                  <button
                    key={item.id}
                    onClick={() =>
                      setCharacterAttachments((current) =>
                        current.filter((saved) => saved.id !== item.id),
                      )
                    }
                    className="flex items-center gap-2 rounded-full border border-[#FFDF00]/35 bg-[#FFDF00]/5 py-1 pl-1 pr-3 text-[8px] font-black text-[#FFDF00]"
                  >
                    <Image
                      src={item.image}
                      alt=""
                      width={28}
                      height={28}
                      unoptimized={item.image.startsWith("http")}
                      className="h-7 w-7 rounded-full object-cover object-top"
                    />
                    <span>{item.name}</span>
                    <span>×</span>
                  </button>
                ))}
                {attachments.map((item) => (
                  <span
                    key={item.name}
                    className="rounded-full border border-white/10 px-3 py-2 text-[8px] text-white/35"
                  >
                    {item.name}
                  </span>
                ))}
              </div>
            )}
            <div className="flex items-end gap-2 rounded-[18px] border border-white/10 bg-black p-2 sm:gap-3 sm:rounded-[20px] sm:p-3">
              <textarea
                value={input}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    void generateFromMainInput();
                  }
                }}
                placeholder="DESCRIBE THE ACTOR..."
                rows={1}
                className="min-h-10 max-h-24 flex-1 resize-none bg-transparent p-2 text-sm outline-none sm:min-h-12 sm:p-3"
              />
              <button
                onClick={() => void generateFromMainInput()}
                disabled={busy || (!generationFlow?.brief && !input.trim())}
                className="rounded-full border border-[#FFDF00]/45 px-4 py-3 text-[8px] font-black text-[#FFDF00] disabled:opacity-25 sm:px-5 sm:py-4 sm:text-[9px]"
              >
                GENERATE
              </button>
            </div>
          </footer>
        </section>
      </div>
      {portfolioOpen && (
        <div className="fixed inset-0 z-[10000] bg-black/90 p-3 backdrop-blur-md">
          <section className="mx-auto flex h-full max-w-6xl flex-col overflow-hidden rounded-[26px] border border-white/10 bg-[#090909]">
            <header className="flex shrink-0 items-center justify-between p-5">
              <div>
                <p className="text-[9px] font-black text-[#FFDF00]">
                  {specialist.name} / COMPANY
                </p>
                <h2 className="mt-2 text-xl font-black">
                  CHOOSE FROM {specialist.characterExamples.length} CASTING
                  PORTRAITS.
                </h2>
              </div>
              <button
                onClick={() => {
                  setPortfolioOpen(false);
                  setPreview("");
                }}
                className="text-3xl text-white/45"
              >
                ×
              </button>
            </header>
            <div className="min-h-0 flex-1 overflow-y-auto bg-black">
              <div className="grid grid-cols-3 gap-0 sm:grid-cols-5">
                {specialist.characterExamples.map((character) => {
                  const selected = preview === character.image;
                  return (
                    <button
                      key={character.image}
                      onClick={() => setPreview(character.image)}
                      className={`group relative aspect-[9/16] min-h-0 overflow-hidden border-0 bg-black transition hover:z-10 hover:shadow-[0_0_34px_8px_rgba(255,223,0,.38)] hover:ring-2 hover:ring-inset hover:ring-[#FFDF00] ${selected ? "z-10 shadow-[0_0_34px_8px_rgba(255,223,0,.5)] ring-2 ring-inset ring-[#FFDF00]" : ""}`}
                    >
                      <Image
                        src={character.image}
                        alt={character.alt}
                        fill
                        sizes="20vw"
                        className="object-cover object-top"
                      />
                      <span className="absolute inset-x-0 top-0 z-10 bg-gradient-to-b from-black/90 via-black/55 to-transparent px-2 pb-5 pt-2 text-left text-[8px] font-black uppercase tracking-[.08em] text-white">
                        {character.name}
                      </span>
                      <span
                        className={`absolute inset-x-0 bottom-0 z-10 bg-[#FFDF00] py-3 text-[9px] font-black text-black transition-transform duration-200 ${selected ? "translate-y-0" : "translate-y-full"}`}
                        onClick={(event) => {
                          event.stopPropagation();
                          choosePortfolioCharacter(character);
                        }}
                      >
                        SELECT
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          </section>
        </div>
      )}
      {myCastOpen && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-[10000] bg-black/90 p-3 backdrop-blur-md"
        >
          <section className="mx-auto flex h-full max-w-6xl flex-col overflow-hidden rounded-[26px] border border-white/10 bg-[#090909]">
            <header className="flex shrink-0 items-center justify-between p-5">
              <div>
                <p className="text-[9px] font-black text-[#FFDF00]">MY CAST</p>
                <h2 className="mt-2 text-xl font-black">
                  CHOOSE FROM YOUR SAVED ACTORS.
                </h2>
              </div>
              <button
                onClick={() => setMyCastOpen(false)}
                className="text-3xl text-white/45"
              >
                ×
              </button>
            </header>
            <div className="min-h-0 flex-1 overflow-y-auto bg-black">
              {myCast.length ? (
                <div className="grid grid-cols-3 gap-0 sm:grid-cols-5">
                  {myCast.map((item) => {
                    const itemKey = candidateKey(item);
                    const selected = selectedMyCastKey === itemKey;
                    return (
                    <div
                      key={itemKey}
                      role="button"
                      tabIndex={0}
                      onClick={() => setSelectedMyCastKey(itemKey)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          setSelectedMyCastKey(itemKey);
                        }
                      }}
                      className={`group relative aspect-[9/16] overflow-hidden bg-black transition hover:z-10 hover:shadow-[0_0_34px_8px_rgba(255,223,0,.38)] hover:ring-2 hover:ring-inset hover:ring-[#FFDF00] ${selected ? "z-10 shadow-[0_0_34px_8px_rgba(255,223,0,.5)] ring-2 ring-inset ring-[#FFDF00]" : ""}`}
                    >
                      <Image
                        src={item.image}
                        alt={item.actorName ?? "My cast actor"}
                        fill
                        sizes="20vw"
                        unoptimized={item.image.startsWith("http")}
                        className="object-cover object-top"
                      />
                      <span className="absolute inset-x-0 top-0 bg-gradient-to-b from-black/90 to-transparent px-2 pb-6 pt-2 text-left text-[8px] font-black uppercase text-white">
                        {item.actorName ?? "CASTING ACTOR"}
                      </span>
                      <div className={`absolute inset-x-0 bottom-0 grid grid-cols-2 transition-transform ${selected ? "translate-y-0" : "translate-y-full"}`}>
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            chooseMyCastCharacter(item);
                          }}
                          className="bg-[#FFDF00] py-3 text-[9px] font-black text-black"
                        >
                          SELECT
                        </button>
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            fireMyCastCharacter(item);
                          }}
                          className="bg-red-600 py-3 text-[9px] font-black text-white hover:bg-red-500"
                        >
                          FIRE
                        </button>
                      </div>
                    </div>
                    );
                  })}
                </div>
              ) : (
                <div className="flex h-full items-center justify-center p-8 text-center text-sm text-white/35">
                  Open a generated candidate and choose ADD TO MY CAST.
                </div>
              )}
            </div>
          </section>
        </div>
      )}
      {candidatePreviewOpen && candidate && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-[11000] flex items-center justify-center overflow-y-auto p-4 sm:p-8"
        >
          <Image
            src={candidate.image}
            alt=""
            fill
            unoptimized={candidate.image.startsWith("http")}
            className="-z-20 scale-110 object-cover blur-3xl"
          />
          <div className="absolute inset-0 -z-10 bg-black/75 backdrop-blur-xl" />
          <button
            aria-label="Close candidate preview"
            onClick={() => setCandidatePreviewOpen(false)}
            className="fixed right-5 top-5 z-20 flex h-11 w-11 items-center justify-center rounded-full border border-white/15 bg-black/55 text-2xl text-white/60"
          >
            ×
          </button>
          <section className="w-full max-w-[430px]">
            <div className="relative mx-auto aspect-[9/16] max-h-[72dvh] overflow-hidden rounded-[24px] border border-white/15 bg-black shadow-2xl">
              <Image
                src={candidate.image}
                alt={candidate.actorName ?? "Casting candidate"}
                fill
                sizes="430px"
                unoptimized={candidate.image.startsWith("http")}
                className="object-cover object-top"
              />
              <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black via-black/35 to-transparent px-5 pb-5 pt-20">
                <p className="text-lg font-black text-white">
                  {candidate.actorName ?? "CASTING CANDIDATE"}
                </p>
              </div>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-2">
              <button
                onClick={() => void downloadCandidate()}
                className="rounded-full border border-white/15 bg-black/55 px-3 py-3 text-[8px] font-black text-white"
              >
                DOWNLOAD
              </button>
              <button
                onClick={() => void shareCandidate()}
                className="rounded-full border border-white/15 bg-black/55 px-3 py-3 text-[8px] font-black text-white"
              >
                SHARE
              </button>
            </div>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <button
                onClick={() => {
                  rejectCandidate();
                  setCandidatePreviewOpen(false);
                }}
                className="rounded-full border border-white/15 bg-black/55 px-3 py-3 text-[8px] font-black text-white"
              >
                REJECT
              </button>
              <button
                onClick={() => {
                  void hireCandidate();
                  setCandidatePreviewOpen(false);
                }}
                className="rounded-full bg-[#FFDF00] px-3 py-3 text-[8px] font-black text-black"
              >
                HIRE
              </button>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}
