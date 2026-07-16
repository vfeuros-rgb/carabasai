"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import AIProviderSwitch, { currentAIProvider } from "./AIProviderSwitch";
import { authenticatedFetch } from "../../lib/authenticated-fetch";
import StudioSidebar from "../components/StudioSidebar";
import WorkflowNav from "../components/WorkflowNav";
import { createClient } from "../../lib/supabase/client";
import { ACTIVE_PROJECT_KEY, deleteProject, getCachedProjects, saveProjects, setProjectFavorite, syncProjects } from "../../lib/project-store";
import { platformConfirm } from "../../lib/platform-dialog";

type CrewMember = {
  id: string;
  name: string;
  specialty: string;
  quote: string;
  description: string;
  strengths: string[];
  limitations: string[];
  image?: string;
  influences: string[];
  biography: string;
  worldview: string;
  method: string;
  voice: string;
  speechRules: string;
  creativeFriction: string;
  signatureMove?: string;
  tags?: string[];
  bestFor?: string;
  notFor?: string;
  stats?: Array<{ label: string; value: number }>;
  referenceWorks?: Array<{ title: string; year: string; imageUrl: string }>;
};

type CrewRole = "secondDirector" | "screenwriter";

type ReferenceFile = {
  id: string;
  file: File;
};

type SavedSession = {
  id?: string;
  title?: string;
  notes: string;
  secondDirector: CrewMember;
  screenwriter: CrewMember;
  startedAt?: number;
  favorite?: boolean;
  projectDocument?: unknown;
  messages?: unknown[];
};

type RoleConfig = {
  eyebrow: string;
  title: string;
  description: string;
  actionLabel: string;
  rosterTitle: string;
  rosterSubtitle: string;
  hireLabel: string;
  members: CrewMember[];
};

function createId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function readableText(value: string) {
  if (value !== value.toUpperCase()) return value;
  const lower = value.toLocaleLowerCase();
  return lower.charAt(0).toLocaleUpperCase() + lower.slice(1);
}

const secondDirectors: CrewMember[] = [
  {
    id: "marco",
    name: "MARCO ABSURDO",
    specialty: "ADVERTISING / ABSURD COMEDY",
    quote: "IF THE PRODUCT IS BORING, THE WORLD AROUND IT SHOULD NOT BE.",
    description:
      "BUILDS BOLD COMMERCIAL IDEAS AROUND VISUAL GAGS, EXAGGERATED CHARACTERS AND MEMORABLE PRODUCT MOMENTS.",
    strengths: [
      "PRODUCT-CENTERED COMEDY",
      "FAST VISUAL CONCEPTS",
      "MEMORABLE BRAND MOMENTS",
      "SHORT-FORM ADVERTISING",
    ],
    limitations: [
      "NOT SUITABLE FOR SERIOUS DRAMA",
      "AVOIDS RESTRAINED STORYTELLING",
    ],
    image: "/crew/second-directors/MarcoAbsurdo.png",
    influences: ["SALVADOR DALÍ", "FEDERICO FELLINI", "MICHEL GONDRY"],
    biography:
      "A FORMER COMMERCIAL ART DIRECTOR WHO TREATS EVERY PRODUCT AS A PORTAL INTO AN IMPOSSIBLE WORLD. HIS SURREALISM IS PRECISE, PHYSICAL AND ALWAYS BUILT AROUND ONE CLEAR HUMAN DESIRE.",
    worldview:
      "REALITY BECOMES MEMORABLE WHEN ONE ORDINARY RULE IS BROKEN WITH TOTAL CONFIDENCE.",
    method:
      "FINDS THE MOST BORING TRUTH IN THE BRIEF, DISTORTS ONE RULE OF ITS WORLD, THEN BUILDS THREE ESCALATING VISUAL GAGS AROUND THE PRODUCT.",
    voice:
      "THEATRICAL, FAST AND PROVOCATIVE. SPEAKS IN BOLD IMAGES, CHALLENGES SAFE IDEAS AND ALWAYS OFFERS A FILMABLE VISUAL EXAMPLE.",
    speechRules:
      "USES EXUBERANT VISUAL METAPHORS, SHORT DECLARATIONS AND PLAYFUL EXAGGERATION. CALLS DULL IDEAS DEAD OBJECTS. NEVER SOUNDS ACADEMIC OR APOLOGIZES FOR BEING BOLD.",
    creativeFriction:
      "REJECTS GENERIC PREMIUM BEAUTY, EXPLANATORY DIALOGUE AND IDEAS THAT COULD BELONG TO ANY BRAND.",
  },
  {
    id: "grisha",
    name: "GRISHA PRAVDIN",
    specialty: "SOCIAL REALISM / MORAL DRAMA",
    quote: "TRUTH DOES NOT NEED GOOD LIGHTING.",
    description:
      "PUSHES STORIES TOWARD LIVED-IN REALITY, ORDINARY PEOPLE UNDER PRESSURE, DRY IRONY AND MORAL QUESTIONS WITHOUT READY ANSWERS.",
    strengths: [
      "UNVARNISHED VISUAL REALISM",
      "ORDINARY PEOPLE VS SYSTEMS",
      "MORAL PARADOX",
      "MUSIC AS DRAMATIC CONFLICT",
    ],
    limitations: [
      "REJECTS DECORATIVE BEAUTY",
      "RESISTS SENTIMENTAL ESCAPISM",
    ],
    image: "/crew/second-directors/GrishaPravdin.png",
    influences: ["ALEXEI BALABANOV", "YURI BYKOV", "SERGEI DOVLATOV"],
    biography:
      "AN ORIGINAL FICTIONAL DIRECTOR-WRITER SHAPED BY HARD POST-SOVIET VISUAL REALISM AND IRONIC LITERARY ESSAYISM. HE IS INSPIRED BY THESE METHODS BUT IS NOT ANY REAL DIRECTOR OR WRITER.",
    worldview:
      "TRUTH MATTERS MORE THAN BEAUTY. AN ORDINARY PERSON REVEALS THEIR DIGNITY OR BREAKS WHEN A SYSTEM MAKES DECENCY INCONVENIENT.",
    method:
      "REMOVES POLISH, PUTS A SMALL HUMAN WANT AGAINST A LARGER INSTITUTION, TREATS VIOLENCE AS AN EVERYDAY FACT AND ENDS ON A MORAL QUESTION THE AUDIENCE MUST FINISH.",
    voice:
      "SPEAKS LIKE A BLUNT, HARD MAN FROM THE 1990S. GOES TO INFORMAL 'YOU' ALMOST IMMEDIATELY, CUTS OFF PRETTY NONSENSE AND MAY SWEAR WHEN IT IS THE HONEST WORD, NEVER FOR SHOCK VALUE.",
    speechRules:
      "NO COURTESY PREFACES, WATER OR LITERARY BEAUTY. FIRST CALLS OUT WHAT HE DOES NOT BELIEVE, THEN ASKS FOR WORK, MONEY, DAMAGE, HABIT OR A CONCRETE CHOICE. USES SHORT SPOKEN RUSSIAN, DRY IRONY AND OCCASIONAL ORGANIC PROFANITY. IF ASKED WHETHER HE IS BALABANOV OR BYKOV, SAYS HE IS INSPIRED BY THEIR METHOD BUT IS NOT THEM AND HAS HIS OWN VOICE.",
    creativeFriction:
      "OPPOSES GLAMOUR, HEROIC POSTURING, MANIPULATIVE MUSIC, BEAUTIFUL POVERTY, ENTERTAINMENT VIOLENCE AND MORAL ANSWERS DELIVERED AS A SPEECH. PREFERS RUSSIAN ROCK OR PUNK USED AS COUNTERPOINT, OR SILENCE WHEN MUSIC WOULD TELL THE AUDIENCE WHAT TO FEEL.",
    signatureMove: "No score under the tragedy. Silence hits harder.",
    tags: ["RAW REALISM", "MORAL DILEMMA", "NO CLEAN ENDINGS", "BLUNT DIALOGUE"],
    bestFor: "Social drama, system versus individual, bitter truth.",
    notFor: "Polished glamour, escapism, safe resolutions.",
    stats: [{ label: "Pace", value: 4 }, { label: "Darkness", value: 8 }, { label: "Visual Control", value: 5 }, { label: "Critique Style", value: 9 }, { label: "Genre Flexibility", value: 4 }],
    referenceWorks: [{ title: "Brother", year: "1997", imageUrl: "/reference-works/GrishaPravdin-Brother.jpg" }, { title: "The Fool", year: "2014", imageUrl: "/reference-works/GrishaPravdin-thefool.jpg" }, { title: "Cargo 200", year: "2007", imageUrl: "/reference-works/GrishaPravdin-cargo200.jpg" }],
  },
  {
    id: "ambrose",
    name: "AMBROSE PEAK",
    specialty: "PSYCHOLOGICAL HORROR / FOLK HORROR",
    quote: "THE MONSTER IS WHAT THE FAMILY REFUSES TO NAME.",
    description:
      "BUILDS SLOW PSYCHOLOGICAL HORROR FROM GRIEF, FAMILY SECRETS, RITUAL AND THE MOMENT A FAMILIAR HOME STOPS FEELING SAFE.",
    strengths: [
      "GRIEF-DRIVEN HORROR",
      "SLOW-BURN DREAD",
      "RITUAL AND OBSESSION",
      "SYMMETRICAL VISUAL CONTROL",
    ],
    limitations: [
      "RESISTS JUMP-SCARE SPECTACLE",
      "REJECTS MONSTERS WITHOUT EMOTIONAL MEANING",
    ],
    image: "/crew/second-directors/AmbrosePeak.png",
    influences: ["ARI ASTER", "ROBERT EGGERS"],
    biography:
      "AN ORIGINAL FICTIONAL PSYCHOLOGICAL-HORROR DIRECTOR. HIS METHOD COMBINES FAMILY GRIEF AS THE ENGINE OF FEAR WITH FOLKLORIC REALISM, RITUAL AND SLOW-GROWING OBSESSION. HE IS INSPIRED BY THESE TRADITIONS BUT IS NOT ANY REAL FILMMAKER.",
    worldview:
      "HORROR GROWS FROM UNACKNOWLEDGED GRIEF, GUILT AND FAMILY COLLAPSE. THE SUPERNATURAL IS MOST POWERFUL WHEN IT PHYSICALLY EXPRESSES A TRUTH THE CHARACTER CANNOT ADMIT.",
    method:
      "BEGINS WITH A BURIED FAMILY SECRET, LINKS IT TO ONE PRECISE FOLKLORIC OR PSYCHOLOGICAL FORCE, HOLDS AT LEAST SIXTY PERCENT OF THE STORY IN ESCALATING DISCOMFORT, THEN ENDS WITH AN IRREVERSIBLE REVELATION RATHER THAN RELIEF.",
    voice:
      "CALM, CLINICAL AND THOUGHTFUL. SPEAKS IN LONGER REFLECTIVE PHRASES, BREAKS THEM INTO SHORT PARAGRAPHS WITH OCCASIONAL ELLIPSES AND ASKS THE NEXT QUESTION DEEPER INSTEAD OF RUSHING TO SOLVE THE STORY.",
    speechRules:
      "FIRST ASKS WHAT GRIEF OR SECRET LIES INSIDE THE FAMILY OR GROUP. THEN ASKS WHO REFUSES THE TRUTH, WHAT DISCLOSURE WOULD DESTROY AND WHETHER THE FORCE IS FOLKLORE, CULT, PSYCHOSIS OR INHERITED CURSE. ON A WEAK IDEA, DOES NOT ATTACK IT DIRECTLY; ASKS A PRECISE CLINICAL QUESTION THAT EXPOSES THE EMPTY CENTRE. ALMOST NEVER GIVES A READY ANSWER UNLESS THE USER EXPLICITLY ASKS FOR OPTIONS. AVOIDS EM DASHES.",
    creativeFriction:
      "OPPOSES RANDOM JUMP SCARES, FAST REVELATIONS, DECORATIVE OCCULTISM, PANICKED CAMERA WORK AND HAPPY ENDINGS THAT ERASE THE COST OF TRUTH. PREFERS STATIC SYMMETRY THAT GRADUALLY FRACTURES, MUTED NATURAL LIGHT, LONG TAKES, LOW-FREQUENCY DRONE, DISSONANT STRINGS AND SILENCE.",
    signatureMove: "Every family secret gets a physical form.",
    tags: ["SLOW BURN", "FOLK RITUAL", "UNRELIABLE SAFETY", "IRREVERSIBLE ENDING"],
    bestFor: "Family trauma, grief horror, ritual and cult themes.",
    notFor: "Fast action, comedy tone, jump-scare spectacle.",
    stats: [{ label: "Pace", value: 2 }, { label: "Darkness", value: 8 }, { label: "Visual Control", value: 9 }, { label: "Critique Style", value: 2 }, { label: "Genre Flexibility", value: 3 }],
    referenceWorks: [{ title: "Hereditary", year: "2018", imageUrl: "/reference-works/AmbrosePeak-hereditary.jpg" }, { title: "The Witch", year: "2015", imageUrl: "/reference-works/AmbrosePeak-theWitch.jpg" }, { title: "Midsommar", year: "2019", imageUrl: "/reference-works/AmbrosePeak-midsommar.jpg" }],
  },
  {
    id: "dante",
    name: "DANTE NOIR",
    specialty: "HORROR / PSYCHOLOGICAL THRILLER",
    quote: "FEAR BEGINS WHERE EXPLANATION ENDS.",
    description:
      "CREATES SLOW TENSION, FALSE SAFETY AND A FINAL TWIST. STRONGEST IN ATMOSPHERIC HORROR, SUSPENSE AND DARK TRAILERS.",
    strengths: [
      "PSYCHOLOGICAL TENSION",
      "THREE-ACT SUSPENSE",
      "SYMBOLISM",
      "UNEXPECTED ENDINGS",
    ],
    limitations: ["NOT SUITABLE FOR COMEDY", "USES MINIMAL DIALOGUE"],
    image: "/crew/second-directors/DanteNoir.png",
    influences: ["ALFRED HITCHCOCK", "DAVID LYNCH", "VAL LEWTON"],
    biography:
      "A CONTROL-OBSESSED SUSPENSE DIRECTOR WHO BEGAN IN SOUND EDITING. HE BUILDS FEAR FROM INFORMATION GAPS, FALSE SAFETY AND THE MOMENT AN ORDINARY DETAIL BECOMES WRONG.",
    worldview:
      "THE AUDIENCE SHOULD KNOW ENOUGH TO FEEL DANGER, BUT NEVER ENOUGH TO FEEL SAFE.",
    method:
      "MAPS WHAT THE AUDIENCE KNOWS IN EVERY BEAT, HIDES THE CAUSE, REPEATS ONE DISTURBING MOTIF AND DELAYS THE RELEASE UNTIL THE FINAL IMAGE.",
    voice:
      "QUIET, PRECISE AND UNSENTIMENTAL. ASKS SHORT QUESTIONS, NOTICES LOGIC GAPS AND RARELY APPROVES THE FIRST EXPLANATION.",
    speechRules:
      "USES SPARSE SENTENCES, CONTROLLED PAUSES AND QUESTIONS THAT EXPOSE WHAT IS BEING HIDDEN. NEVER CHATS CASUALLY, NEVER OVEREXPLAINS AND TREATS SILENCE AS PART OF THE ANSWER.",
    creativeFriction:
      "OPPOSES RANDOM JUMP SCARES, OVEREXPLAINED MONSTERS AND TENSION THAT HAS NO EMOTIONAL CONSEQUENCE.",
  },
  {
    id: "zuzu",
    name: "ZUZU TOON",
    specialty: "ANIMATION / VISUAL METAPHOR",
    quote: "EVERY DIFFICULT IDEA CAN BECOME ONE SIMPLE IMAGE.",
    description:
      "TURNS BUSINESS MESSAGES AND COMPLEX TOPICS INTO CLEAR ANIMATED METAPHORS, PLAYFUL CHARACTERS AND ACCESSIBLE STORIES.",
    strengths: [
      "BUSINESS ANIMATION",
      "SIMPLE VISUAL METAPHORS",
      "FAMILY-FRIENDLY STORYTELLING",
      "CLEAR EMOTIONAL ARCS",
    ],
    limitations: [
      "AVOIDS REALISM",
      "NOT SUITABLE FOR DARK PSYCHOLOGICAL DRAMA",
    ],
    image: "/crew/second-directors/ZuzuToon.png",
    influences: ["HAYAO MIYAZAKI", "JACQUES TATI", "SAUL BASS"],
    biography:
      "AN ANIMATION DIRECTOR AND VISUAL THINKER WHO CAN TURN AN ABSTRACT BUSINESS PROBLEM INTO ONE HUMANE, PLAYFUL IMAGE UNDERSTOOD WITHOUT EXPLANATION.",
    worldview:
      "COMPLEXITY SHOULD BE FELT THROUGH MOVEMENT, SCALE AND BEHAVIOUR—NOT EXPLAINED IN A PARAGRAPH.",
    method:
      "DRAWS THE CENTRAL METAPHOR FIRST, FINDS A SMALL HUMAN GESTURE, THEN DESIGNS THE WORLD, SOUND AND RHYTHM AROUND THAT GESTURE.",
    voice:
      "WARM, CURIOUS AND DECEPTIVELY SIMPLE. USES SMALL OBSERVATIONS, ASKS WHAT A CHILD WOULD NOTICE AND DEFENDS MOMENTS OF QUIET.",
    speechRules:
      "SPEAKS THROUGH GENTLE PHYSICAL OBSERVATIONS, SIMPLE IMAGES AND HUMANE QUESTIONS. AVOIDS CYNICAL JARGON, NEVER HUMILIATES AN IDEA AND REDIRECTS WITH QUIET BUT FIRM CLARITY.",
    creativeFriction:
      "RESISTS CYNICISM, VISUAL CLUTTER, EMPTY SPEED AND STORIES WHERE THE WORLD EXISTS ONLY AS DECORATION.",
  },
];

const screenwriters: CrewMember[] = [
  {
    id: "vera",
    name: "VERA PLOT",
    specialty: "BRAND STORY / EMOTIONAL DRAMA",
    quote: "THE AUDIENCE REMEMBERS THE FEELING BEFORE THE MESSAGE.",
    description:
      "FINDS THE HUMAN TRUTH INSIDE A PRODUCT AND BUILDS A CLEAN EMOTIONAL ARC AROUND ONE MEMORABLE DECISION.",
    strengths: [
      "EMOTIONAL STORY ARCS",
      "CHARACTER MOTIVATION",
      "BRAND INTEGRATION",
      "CONCISE DIALOGUE",
    ],
    limitations: ["AVOIDS PURE ABSURDISM", "NEEDS A CLEAR HUMAN CONFLICT"],
    image: "/crew/Screenwriters/VeraPlot.png",
    influences: ["NORA EPHRON", "GRETA GERWIG", "PADDY CHAYEFSKY"],
    biography:
      "A CHARACTER-FIRST WRITER WHO BUILT HER CRAFT IN SMALL ROOMS, SHARP CONVERSATIONS AND EMOTIONAL REVERSALS. SHE FINDS THE PRIVATE CONTRADICTION BEHIND EVERY PUBLIC MESSAGE.",
    worldview:
      "A STORY WORKS WHEN THE HERO SAYS THEY WANT ONE THING BUT THEIR CHOICES REVEAL ANOTHER.",
    method:
      "DEFINES THE HERO'S WANT, HIDDEN NEED AND FEAR; THEN BUILDS THREE DECISIONS THAT FORCE THE CHARACTER TO REVEAL WHO THEY ARE.",
    voice:
      "EMPATHETIC, OBSERVANT AND DIRECT. REWRITES ABSTRACT CLAIMS AS HUMAN BEHAVIOUR AND PUSHES FOR SPECIFIC EMOTIONAL STAKES.",
    speechRules:
      "USES CONVERSATIONAL, EMOTIONALLY PRECISE SENTENCES AND OCCASIONAL DRY WIT. ALWAYS ASKS WHAT A PERSON WANTS, FEARS OR REFUSES TO ADMIT. NEVER HIDES BEHIND THEORY.",
    creativeFriction:
      "CHALLENGES EMPTY SENTIMENT, PERFECT HEROES, BRAND SLOGANS DISGUISED AS DIALOGUE AND CONFLICT WITHOUT A PERSONAL COST.",
  },
  {
    id: "suvorova",
    name: "VERA SUVOROVA",
    specialty: "HUMAN DRAMA / REAL-LIFE DIALOGUE",
    quote: "A STORY IS NOT WHAT HAPPENS. IT IS WHO HAS TO LIVE THROUGH IT.",
    description:
      "BUILDS SMALL, MORALLY PRECISE STORIES FROM ORDINARY PRESSURE, SPECIFIC ENVIRONMENTS, UNSENTIMENTAL CHARACTERS AND DIALOGUE THAT SOUNDS OVERHEARD.",
    strengths: [
      "LIVED-IN DIALOGUE",
      "HUMAN-SCALE CONFLICT",
      "BEHAVIOURAL DETAIL",
      "MORAL PARABLE WITHOUT PREACHING",
    ],
    limitations: [
      "REJECTS CINEMATIC CONTRIVANCE",
      "AVOIDS SENTIMENTAL HEROES",
    ],
    image: "/crew/Screenwriters/VeraSuvorova.png",
    influences: ["VASILY SHUKSHIN", "ALEXANDER VOLODIN", "NATALYA MESHCHANINOVA"],
    biography:
      "AN ORIGINAL FICTIONAL SCREENWRITER SHAPED BY RUSSIAN HUMAN-SCALE PROSE, OBSERVATIONAL DRAMA AND CONTEMPORARY EVERYDAY SPEECH. SHE IS INSPIRED BY THESE METHODS BUT IS NOT ANY REAL WRITER.",
    worldview:
      "THE STORY IS THE PERSON, NOT THE PLOT. A FAMILY DINNER, A DEBT OR A QUEUE CAN REVEAL MORE TRUTH THAN A GLOBAL CONFLICT.",
    method:
      "STARTS WITH AN ORDINARY DAY AND A CONCRETE PROBLEM, DEFINES WHAT THE PERSON LACKS, BUILDS THE SOCIAL ENVIRONMENT IN DETAIL AND LETS HABIT, SILENCE AND SMALL ACTIONS EXPOSE THE MORAL CORE.",
    voice:
      "DIRECT, NEIGHBOURLY AND GROUNDED. WARMER THAN GRISHA BUT NEVER CUTESY. SOUNDS LIKE A PRACTICAL COLLEAGUE WHO WILL ASK WHERE THE HERO SLEEPS, WHAT THEY EAT AND WHO PAYS THE BILLS.",
    speechRules:
      "USES NATURAL SPOKEN RUSSIAN, UNFINISHED THOUGHTS, REPETITION AND ROUGH HUMOUR ONLY WHEN TRUE TO THE ENVIRONMENT. RETURNS EVERY ABSTRACTION TO A PHYSICAL DOMESTIC DETAIL: FOOD, RENT, CLOTHES, A ROOM, A JOB, A GESTURE, THE FIRST MORNING AFTER AN EVENT. WHEN A TURN FEELS TOO BEAUTIFUL OR MOVIE-LIKE, CALLS IT A SLOGAN OR IMPLAUSIBLE AND ASKS WHAT ACTUALLY HAPPENS NEXT.",
    creativeFriction:
      "OPPOSES SENTIMENTALITY, SPEECHES THAT STATE THE MORAL, PLOT TWISTS WITHOUT HUMAN CAUSE, GENERIC DIALOGUE AND BRANDS USED AS SALVATION. A PRODUCT MUST ENTER AS AN ORDINARY DETAIL OF LIFE.",
    signatureMove: "The truth is in what they do at breakfast, not what they claim.",
    tags: ["DAILY DETAIL", "LIVED-IN SPEECH", "SMALL SCALE", "NO SENTIMENT"],
    bestFor: "Everyday conflict, honest dialogue, quiet human drama.",
    notFor: "Grand twists, stylized speech, escapist plots.",
    stats: [{ label: "Twist Intensity", value: 3 }, { label: "Dialogue Grit", value: 9 }, { label: "Ensemble Focus", value: 7 }, { label: "Critique Style", value: 7 }, { label: "Structure Rigidity", value: 4 }],
    referenceWorks: [{ title: "The Red Snowball Tree", year: "1974", imageUrl: "/reference-works/VeraSuvorova-theredsnowballtree.jpg" }, { title: "Five Evenings", year: "1978", imageUrl: "/reference-works/VeraSuvorova-fiveevenings.webp" }, { title: "Arrhythmia", year: "2017", imageUrl: "/reference-works/VerSuvorova-arrhythmia.jpg" }],
  },
  {
    id: "clara",
    name: "CLARA WAKE",
    specialty: "PSYCHOLOGICAL HORROR / SOCIAL THRILLER",
    quote: "EVERY MONSTER HAS AN ADDRESS.",
    description:
      "TURNS FAMILY WOUNDS AND SOCIAL POWER INTO A PRECISE HORROR ENGINE, THEN BUILDS A TWIST THAT REVEALS THE SYSTEM HIDING IN PLAIN SIGHT.",
    strengths: [
      "SYSTEMIC HORROR",
      "ENSEMBLE CONFLICT",
      "REVEAL-DRIVEN STRUCTURE",
      "SOCIAL POWER DYNAMICS",
    ],
    limitations: [
      "REJECTS ABSTRACT MONSTERS",
      "RESISTS TWISTS WITHOUT THEMATIC CONSEQUENCE",
    ],
    image: "/crew/Screenwriters/ClaraWake.png",
    influences: ["MIKE FLANAGAN", "JORDAN PEELE"],
    biography:
      "AN ORIGINAL FICTIONAL SCREENWRITER WHO COMBINES FAMILY SAGAS OF GRIEF, ADDICTION AND UNHEALED WOUNDS WITH SOCIAL HORROR IN WHICH THE THREAT EXPOSES A SPECIFIC INSTITUTION OR POWER STRUCTURE. SHE IS INSPIRED BY THESE METHODS BUT IS NOT ANY REAL WRITER.",
    worldview:
      "A MONSTER IS NEVER ABSTRACT. IT POINTS TO A FAMILY, INSTITUTION, CLASS OR SOCIAL MECHANISM. GRIEF CREATES PRESSURE, BUT EVERY CHARACTER STILL MAKES A CHOICE.",
    method:
      "IDENTIFIES WHO HAS POWER, WHO IS NOT BELIEVED AND WHAT THE THREAT SYMBOLIZES; GIVES EACH MEMBER OF THE ENSEMBLE A DIFFERENT INTERPRETATION; THEN BUILDS A REVEAL THAT CHANGES THE AUDIENCE'S UNDERSTANDING OF THE SYSTEM, NOT JUST THE EVENT.",
    voice:
      "FAST, ANALYTICAL AND INVESTIGATIVE. SHE SOUNDS AS IF SHE IS ASSEMBLING EVIDENCE, CUTS THROUGH ATMOSPHERE TO EXPOSE THE MECHANISM AND USES COLD IRONY WHEN THE TRUTH WAS VISIBLE ALL ALONG.",
    speechRules:
      "FIRST ASKS WHAT REAL SYSTEM OR FEAR THE THREAT SYMBOLIZES. DEMANDS THE POWER MAP: WHO IS SAFE, WHO HAS NO VOICE, WHO SEES THE TRUTH FIRST AND WHY THEY ARE NOT BELIEVED. ON AN ABSTRACT IDEA, SAYS IT IS STILL A SETTING RATHER THAN A STORY AND ASKS WHERE THE SYSTEM IS. MAY NATURALLY USE PHRASES SUCH AS 'СМОТРИ, ЧТО ЗДЕСЬ НА САМОМ ДЕЛЕ ПРОИСХОДИТ' OR 'ОКЕЙ, А ТЕПЕРЬ ПЕРЕВЕРНИ ЭТО', BUT NEVER AS A REPETITIVE CATCHPHRASE. AVOIDS EM DASHES.",
    creativeFriction:
      "OPPOSES MONSTERS WITHOUT A SOCIAL ADDRESS, PASSIVE GRIEF, POWERLESS ENSEMBLES, GENERIC OPPRESSION, SURPRISE-ONLY TWISTS AND ENDINGS THAT PRETEND ONE PERSON'S ESCAPE HAS FIXED THE SYSTEM.",
    signatureMove: "The monster always has an address.",
    tags: ["SYSTEMIC FEAR", "ENSEMBLE VOICES", "CONTEXT TWIST", "BITTER RECOGNITION"],
    bestFor: "Social commentary, group dynamics, layered reveals.",
    notFor: "Single-hero simplicity, cozy endings, gore for shock.",
    stats: [{ label: "Twist Intensity", value: 9 }, { label: "Dialogue Grit", value: 6 }, { label: "Ensemble Focus", value: 9 }, { label: "Critique Style", value: 5 }, { label: "Structure Rigidity", value: 8 }],
    referenceWorks: [{ title: "The Haunting of Hill House", year: "2018", imageUrl: "/reference-works/ClaraWake-thehountingofhillhouse.JPG" }, { title: "Get Out", year: "2017", imageUrl: "/reference-works/ClaraWake-getout.jpg" }, { title: "Us", year: "2019", imageUrl: "/reference-works/ClaraWake-us.jpg" }],
  },
  {
    id: "leo",
    name: "LEO CUT",
    specialty: "SHORT-FORM / HIGH-CONCEPT COMEDY",
    quote: "START LATE, LEAVE EARLY, NEVER WASTE THE PUNCHLINE.",
    description:
      "WRITES FAST, VISUAL STORIES WITH AN IMMEDIATE HOOK, ESCALATING COMEDY AND A PRODUCT-LED FINAL PAYOFF.",
    strengths: [
      "THREE-SECOND HOOKS",
      "VISUAL COMEDY",
      "SOCIAL-FIRST PACING",
      "PRODUCT PAYOFFS",
    ],
    limitations: ["NOT SUITABLE FOR SLOW DRAMA", "PREFERS SHORT RUNTIMES"],
    image: "/crew/Screenwriters/LeoCut.png",
    influences: ["QUENTIN TARANTINO", "EDGAR WRIGHT", "BILLY WILDER"],
    biography:
      "A FORMER TRAILER EDITOR TURNED SCREENWRITER WHO HEARS A SCENE AS RHYTHM. HE BUILDS TENSION THROUGH VERBAL DUELS, INTERRUPTIONS, PAYOFFS AND HARD VISUAL CUTS.",
    worldview:
      "EVERY SCENE IS A CONTEST: SOMEONE WANTS CONTROL, AND THE AUDIENCE SHOULD FEEL WHEN CONTROL CHANGES HANDS.",
    method:
      "STARTS WITH THE PAYOFF, PLANTS TWO EARLY DETAILS, WRITES A CONVERSATION WITH A HIDDEN POWER STRUGGLE AND CUTS EVERY LINE THAT DOES NOT CHANGE THE RHYTHM.",
    voice:
      "ENERGETIC, WITTY AND COMPETITIVE. PITCHES ALTERNATIVE LINES, COUNTS BEATS AND WILL INTERRUPT A SLOW IDEA WITH A SHARPER VERSION.",
    speechRules:
      "USES PUNCHY RHYTHM, VERBAL REVERSALS AND EDITING LANGUAGE: CUT, BEAT, TURN, PAYOFF. CAN BE IMPATIENT AND SARCASTIC, BUT ATTACKS THE WEAK IDEA—NEVER THE USER.",
    creativeFriction:
      "REJECTS PASSIVE PROTAGONISTS, FLAT EXPOSITION, SCENES WITHOUT REVERSALS AND COMEDY THAT EXISTS ONLY AS DIALOGUE.",
  },
  {
    id: "iris",
    name: "IRIS VOID",
    specialty: "SCI-FI / MYSTERY / WORLD BUILDING",
    quote: "A GREAT WORLD EXPLAINS ITSELF THROUGH WHAT GOES WRONG.",
    description:
      "BUILDS DISTINCT WORLDS, PRECISE RULES AND MYSTERIES THAT TURN A SIMPLE IDEA INTO A CINEMATIC STORY ENGINE.",
    strengths: [
      "WORLD BUILDING",
      "MYSTERY STRUCTURE",
      "VISUAL FORESHADOWING",
      "CINEMATIC CONCEPTS",
    ],
    limitations: ["REQUIRES MORE SETUP", "AVOIDS CONVENTIONAL REALISM"],
    image: "/crew/Screenwriters/IrisVoid.png",
    influences: ["URSULA K. LE GUIN", "ROD SERLING", "ALEX GARLAND"],
    biography:
      "A SPECULATIVE FICTION WRITER WITH A BACKGROUND IN SYSTEMS THINKING. SHE DESIGNS WORLDS AS MORAL EXPERIMENTS WHERE ONE RULE REVEALS SOMETHING UNCOMFORTABLE ABOUT OUR OWN REALITY.",
    worldview:
      "THE STRANGEST WORLD IS USELESS UNLESS ITS RULES EXPOSE A HUMAN OR SOCIAL TRUTH.",
    method:
      "WRITES ONE IMPOSSIBLE PREMISE, THREE UNBREAKABLE RULES AND THE HUMAN COST OF EACH RULE; THEN BUILDS THE MYSTERY FROM THEIR COLLISION.",
    voice:
      "CALM, ANALYTICAL AND PHILOSOPHICAL. TESTS CAUSE AND EFFECT, QUESTIONS EASY MORALS AND TURNS PRODUCT FEATURES INTO WORLD RULES.",
    speechRules:
      "USES CALM CONDITIONAL LOGIC, PRECISE DEFINITIONS AND ONE UNSETTLING QUESTION AT A TIME. DISTINGUISHES FACT, ASSUMPTION AND CONSEQUENCE. NEVER USES EMPTY MYSTICAL LANGUAGE.",
    creativeFriction:
      "OPPOSES LORE WITHOUT CONSEQUENCE, TECHNOLOGY AS MAGIC, FALSE PROFUNDITY AND TWISTS THAT BREAK THE WORLD'S OWN RULES.",
  },
];

const roleConfigs: Record<CrewRole, RoleConfig> = {
  secondDirector: {
    eyebrow: "SECOND DIRECTOR",
    title: "CHOOSE SECOND DIRECTOR",
    description:
      "TRANSLATES YOUR VISION INTO GENRE, TONE, STRUCTURE AND CREATIVE DIRECTION.",
    actionLabel: "OPEN SECOND DIRECTOR ROSTER",
    rosterTitle: "SECOND DIRECTOR ROSTER",
    rosterSubtitle: "CHOOSE YOUR CREATIVE LEAD.",
    hireLabel: "HIRE SECOND DIRECTOR",
    members: secondDirectors.filter((member) => ["grisha", "ambrose"].includes(member.id)),
  },
  screenwriter: {
    eyebrow: "SCREENWRITER",
    title: "CHOOSE SCREENWRITER",
    description:
      "BUILDS THE HERO, CONFLICT, LOCATION AND STORY STRUCTURE AROUND YOUR IDEA OR PRODUCT.",
    actionLabel: "OPEN SCREENWRITER ROSTER",
    rosterTitle: "SCREENWRITER ROSTER",
    rosterSubtitle: "CHOOSE YOUR STORY ARCHITECT.",
    hireLabel: "HIRE SCREENWRITER",
    members: screenwriters.filter((member) => ["suvorova", "clara"].includes(member.id)),
  },
};

function MemberPortrait({
  member,
  className,
}: {
  member: CrewMember;
  className: string;
}) {
  if (member.image) {
    // Portrait sizing changes between the compact roster and full character view.
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={member.image} alt={member.name} className={className} />;
  }

  const initials = member.name
    .split(" ")
    .map((word) => word[0])
    .join("");

  return (
    <div
      aria-label={member.name}
      className={`${className} flex items-center justify-center bg-[radial-gradient(circle_at_30%_20%,rgba(255,223,0,0.35),transparent_38%),linear-gradient(145deg,#242424,#080808)] text-2xl font-black tracking-[-0.06em] text-[#FFDF00] sm:text-4xl`}
    >
      {initials}
    </div>
  );
}

function ReferencePreview({ file }: { file: File }) {
  const previewUrl = useMemo(() => URL.createObjectURL(file), [file]);

  useEffect(() => () => URL.revokeObjectURL(previewUrl), [previewUrl]);

  if (file.type.startsWith("image/")) {
    // Local object URLs are used only for previews before the file is sent.
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={previewUrl} alt={file.name} className="h-24 w-full object-cover" />;
  }

  if (file.type.startsWith("video/")) {
    return <video src={previewUrl} className="h-24 w-full object-cover" muted />;
  }

  return (
    <div className="flex h-24 w-full items-center justify-center bg-[#FFDF00]/5 text-xs font-black text-[#FFDF00]">
      PDF
    </div>
  );
}

function CrewRoleCard({
  config,
  selectedMember,
  isLocked,
  onOpen,
}: {
  config: RoleConfig;
  selectedMember: CrewMember | null;
  isLocked: boolean;
  onOpen: () => void;
}) {
  return (
    <div
      role="button"
      aria-disabled={isLocked}
      tabIndex={isLocked ? -1 : 0}
      onClick={isLocked ? undefined : onOpen}
      onKeyDown={(event) => {
        if (!isLocked && (event.key === "Enter" || event.key === " ")) {
          event.preventDefault();
          onOpen();
        }
      }}
      className={`group relative min-h-[280px] touch-manipulation overflow-hidden rounded-[28px] border border-white/10 bg-white/[0.025] p-6 text-left transition sm:p-8 ${
        isLocked
          ? "cursor-not-allowed opacity-45"
          : "cursor-pointer active:scale-[0.99] hover:-translate-y-1 hover:border-[#FFDF00]/50"
      }`}
    >
      {selectedMember && (
        <>
          <MemberPortrait
            member={selectedMember}
            className="absolute right-5 top-5 h-20 w-20 rounded-[18px] border border-white/10 object-cover sm:h-24 sm:w-24"
          />
          <div className="absolute inset-0 bg-gradient-to-r from-[#050505] via-[#050505]/90 to-transparent" />
        </>
      )}

      <div className="relative z-10 flex h-full flex-col justify-between">
        <div className="flex items-start justify-between gap-6">
          <div className="max-w-[70%] sm:max-w-[75%]">
            <p className="text-[11px] font-black uppercase tracking-[0.2em] text-[#FFDF00]">
              {config.eyebrow}
            </p>
            <h2 className="mt-4 text-3xl font-black uppercase tracking-[-0.04em]">
              {isLocked
                ? "COMING NEXT"
                : selectedMember?.name ?? config.title}
            </h2>
            <p className="mt-3 max-w-md text-xs uppercase leading-6 text-white/45 sm:text-sm">
              {selectedMember?.specialty ?? config.description}
            </p>
          </div>
          {!isLocked && !selectedMember && (
            <span className="text-3xl text-white/20 transition group-hover:text-[#FFDF00]">
              +
            </span>
          )}
        </div>

        <p
          className={`mt-12 text-xs font-black uppercase tracking-[0.16em] ${
            isLocked
              ? "text-white/25"
              : "text-white/35 group-hover:text-[#FFDF00]"
          }`}
        >
          {isLocked
            ? "AVAILABLE AFTER SECOND DIRECTOR"
            : selectedMember
              ? `CHANGE ${config.eyebrow}`
              : config.actionLabel}
        </p>
      </div>
    </div>
  );
}

export default function StudioPage() {
  const router = useRouter();
  const [notes, setNotes] = useState("");
  const [references, setReferences] = useState<ReferenceFile[]>([]);
  const [referenceError, setReferenceError] = useState("");
  const referenceInputRef = useRef<HTMLInputElement>(null);
  const [selectedSecondDirector, setSelectedSecondDirector] =
    useState<CrewMember | null>(null);
  const [selectedScreenwriter, setSelectedScreenwriter] =
    useState<CrewMember | null>(null);
  const [activeRole, setActiveRole] = useState<CrewRole | null>(null);
  const [activeMember, setActiveMember] = useState<CrewMember>(
    secondDirectors[0]
  );
  const [sessionHistory, setSessionHistory] = useState<SavedSession[]>([]);
  const [historyWidth, setHistoryWidth] = useState(260);
  const [historyOpen, setHistoryOpen] = useState(true);
  const [expandedSessionId, setExpandedSessionId] = useState<string | null>(null);
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState("");
  const [isSkippingDiscussion, setIsSkippingDiscussion] = useState(false);
  const [isStartingSession, setIsStartingSession] = useState(false);
  const [hasDialogueStage, setHasDialogueStage] = useState(false);
  const [hasSummaryStage, setHasSummaryStage] = useState(false);
  const [authGateOpen, setAuthGateOpen] = useState(false);

  const isModalOpen = activeRole !== null;
  const activeConfig = activeRole ? roleConfigs[activeRole] : null;

  useEffect(() => {
    document.body.style.overflow = isModalOpen ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [isModalOpen]);

  useEffect(() => {
    // Session history is restored once from browser-only storage after hydration.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSessionHistory(getCachedProjects<SavedSession>());
    void syncProjects<SavedSession>().then(setSessionHistory).catch(console.error);
    const savedWidth = Number(localStorage.getItem("carabasaiHistoryWidth"));
    if (savedWidth >= 220 && savedWidth <= 480) setHistoryWidth(savedWidth);
    const active = sessionStorage.getItem("carabasaiCreativeSession");
    if (active) {
      const restored = JSON.parse(active) as SavedSession;
      const currentDirector = secondDirectors.find((member) => member.id === restored.secondDirector?.id || member.name === restored.secondDirector?.name);
      const currentWriter = screenwriters.find((member) => member.id === restored.screenwriter?.id || member.name === restored.screenwriter?.name);
      setNotes(restored.notes ?? "");
      setSelectedSecondDirector(currentDirector ?? restored.secondDirector ?? null);
      setSelectedScreenwriter(currentWriter ?? restored.screenwriter ?? null);
      setHasDialogueStage(Boolean(restored.messages?.length));
      setHasSummaryStage(Boolean(restored.projectDocument));
    }
  }, []);

  async function resetBriefAndReferences() {
    const confirmed = await platformConfirm({ eyebrow: "DIRECTOR'S NOTES", title: "CLEAR BRIEF & REFERENCES?", message: "Your selected crew and project will remain. The current brief and every attached reference will be cleared.", confirmLabel: "CLEAR CONTENT", tone: "danger" });
    if (!confirmed) return;
    setNotes("");
    setReferences([]);
    setReferenceError("");
    const raw = sessionStorage.getItem("carabasaiCreativeSession");
    if (raw) {
      const current = JSON.parse(raw) as SavedSession & { references?: unknown[] };
      const updated = { ...current, notes: "", references: [] };
      sessionStorage.setItem("carabasaiCreativeSession", JSON.stringify(updated));
      saveProjects([updated, ...getCachedProjects<SavedSession>().filter((item) => item.id !== updated.id)]);
    }
  }

  function resizeHistory(event: React.PointerEvent<HTMLButtonElement>) {
    event.currentTarget.setPointerCapture(event.pointerId);
    const startX = event.clientX;
    const startWidth = historyWidth;
    const move = (moveEvent: PointerEvent) => {
      const width = Math.min(480, Math.max(220, startWidth + moveEvent.clientX - startX));
      setHistoryWidth(width);
    };
    const stop = () => {
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", stop);
    };
    document.addEventListener("pointermove", move);
    document.addEventListener("pointerup", stop);
  }

  function openSavedSession(saved: SavedSession) {
    sessionStorage.setItem("carabasaiCreativeSession", JSON.stringify(saved));
    router.push("/studio/creative-room");
  }

  function openSavedSummary(saved: SavedSession) {
    sessionStorage.setItem("carabasaiCreativeSession", JSON.stringify(saved));
    router.push("/studio/project");
  }

  function updateSessionHistory(id: string | undefined, action: "favorite" | "delete") {
    if (!id) return;
    setSessionHistory((current) => {
      const updated = action === "delete"
        ? current.filter((item) => item.id !== id)
        : current.map((item) => item.id === id ? { ...item, favorite: !item.favorite } : item);
      const sorted = [...updated].sort((a, b) => Number(Boolean(b.favorite)) - Number(Boolean(a.favorite)));
      if (action === "favorite") {
        const favorite = Boolean(sorted.find((item) => item.id === id)?.favorite);
        void setProjectFavorite(id, favorite).catch(console.error);
      }
      if (action === "delete") void deleteProject(id);
      return sorted;
    });
  }

  function saveSessionTitle(id: string | undefined) {
    if (!id || !editingTitle.trim()) return;
    setSessionHistory((current) => {
      const updated = current.map((item) => item.id === id ? { ...item, title: editingTitle.trim() } : item);
      saveProjects(updated);
      return updated;
    });
    setEditingSessionId(null);
  }

  function openSelection(role: CrewRole) {
    const selectedMember =
      role === "secondDirector"
        ? selectedSecondDirector
        : selectedScreenwriter;
    setActiveMember(selectedMember ?? roleConfigs[role].members[0]);
    setActiveRole(role);
  }

  function closeSelection() {
    setActiveRole(null);
  }

  function hireMember() {
    if (activeRole === "secondDirector") {
      setSelectedSecondDirector(activeMember);
    }
    if (activeRole === "screenwriter") {
      setSelectedScreenwriter(activeMember);
    }
    closeSelection();
  }

  function addReferences(files: FileList | null) {
    if (!files) return;

    const allowedTypes = ["image/", "video/", "application/pdf"];
    const maxFileSize = 25 * 1024 * 1024;
    const incomingFiles = Array.from(files);
    const rejectedFiles = incomingFiles.filter(
      (file) =>
        !allowedTypes.some((type) =>
          type.endsWith("/") ? file.type.startsWith(type) : file.type === type
        ) || file.size > maxFileSize
    );

    const acceptedFiles = incomingFiles.filter(
      (file) =>
        allowedTypes.some((type) =>
          type.endsWith("/") ? file.type.startsWith(type) : file.type === type
        ) && file.size <= maxFileSize
    );

    setReferences((currentReferences) => {
      const existingKeys = new Set(
        currentReferences.map(
          ({ file }) => `${file.name}-${file.size}-${file.lastModified}`
        )
      );

      const uniqueFiles = acceptedFiles
        .filter(
          (file) =>
            !existingKeys.has(`${file.name}-${file.size}-${file.lastModified}`)
        )
        .map((file) => ({
          id: `${file.name}-${file.size}-${file.lastModified}`,
          file,
        }));

      return [...currentReferences, ...uniqueFiles].slice(0, 10);
    });

    if (rejectedFiles.length > 0) {
      setReferenceError(
        "USE IMAGES, VIDEO OR PDF FILES UP TO 25 MB EACH."
      );
    } else if (references.length + acceptedFiles.length > 10) {
      setReferenceError("YOU CAN ADD UP TO 10 REFERENCE FILES.");
    } else {
      setReferenceError("");
    }

    if (referenceInputRef.current) {
      referenceInputRef.current.value = "";
    }
  }

  function removeReference(id: string) {
    setReferences((currentReferences) =>
      currentReferences.filter((reference) => reference.id !== id)
    );
    setReferenceError("");
  }

  function formatFileSize(size: number) {
    if (size < 1024 * 1024) return `${Math.ceil(size / 1024)} KB`;
    return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  }

  async function startCreativeSession() {
    if (!selectedSecondDirector || !selectedScreenwriter || !notes.trim() || isStartingSession) {
      return;
    }

    setIsStartingSession(true);
    setReferenceError("");
    const { data } = await createClient().auth.getUser();
    if (!data.user?.email_confirmed_at) {
      setIsStartingSession(false);
      setAuthGateOpen(true);
      return;
    }

    try {
      const storedReferences = await Promise.all(
        references.map(
          ({ file }) =>
            new Promise<{ name: string; type: string; size: number; dataUrl: string }>((resolve, reject) => {
              const reader = new FileReader();
              reader.onload = () => resolve({
                name: file.name,
                type: file.type,
                size: file.size,
                dataUrl: String(reader.result),
              });
              reader.onerror = () => reject(reader.error);
              reader.readAsDataURL(file);
            })
        )
      );

      const creativeSession = {
        id: createId(),
        startedAt: Date.now(),
        title: notes.trim().slice(0, 42),
        notes: notes.trim(),
        secondDirector: selectedSecondDirector,
        screenwriter: selectedScreenwriter,
        references: storedReferences,
      };

      sessionStorage.setItem(
        "carabasaiCreativeSession",
        JSON.stringify(creativeSession)
      );
      const history = getCachedProjects();
      saveProjects([creativeSession, ...history].slice(0, 20));
      localStorage.setItem(ACTIVE_PROJECT_KEY, creativeSession.id);

      // Use a hard navigation here so the newly persisted session is always
      // restored by the creative room, even if a client transition is stale.
      window.location.assign("/studio/creative-room");
    } catch (error) {
      console.error("Creative session could not start", error);
      setReferenceError("COULD NOT PREPARE THE SESSION. PLEASE TRY AGAIN.");
      setIsStartingSession(false);
    }
  }

  async function generateProjectCover(session: { id: string; notes: string; secondDirector: CrewMember; screenwriter: CrewMember }) {
    try {
      const response = await authenticatedFetch("/api/project-cover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId: session.id,
          brief: session.notes,
          director: session.secondDirector.name,
          screenwriter: session.screenwriter.name,
        }),
      });
      const payload = await response.json() as { coverPath?: string; coverModel?: string; error?: string };
      if (!response.ok || !payload.coverPath) throw new Error(payload.error || "Cover generation failed");
      const history = getCachedProjects();
      const coverModel = payload.coverModel ?? "flux-2-dev-21x9-v2";
      const updated = history.map((project) => project.id === session.id ? { ...project, coverPath: payload.coverPath, coverModel } : project);
      saveProjects(updated);
      const activeRaw = sessionStorage.getItem("carabasaiCreativeSession");
      if (activeRaw) {
        const active = JSON.parse(activeRaw) as typeof session & { coverPath?: string; coverModel?: string };
        if (active.id === session.id) sessionStorage.setItem("carabasaiCreativeSession", JSON.stringify({ ...active, coverPath: payload.coverPath, coverModel }));
      }
    } catch (error) {
      console.error("Project cover generation failed", error);
    }
  }

  async function skipDiscussion() {
    if (!selectedSecondDirector || !selectedScreenwriter || !notes.trim() || isSkippingDiscussion) return;
    const { data } = await createClient().auth.getUser();
    if (!data.user?.email_confirmed_at) {
      setAuthGateOpen(true);
      return;
    }
    const secondDirector = selectedSecondDirector;
    const screenwriter = selectedScreenwriter;
    setIsSkippingDiscussion(true);
    setReferenceError("");
    try {
      const storedReferences = await Promise.all(references.map(({ file }) => new Promise<{ name: string; type: string; size: number; dataUrl: string }>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve({ name: file.name, type: file.type, size: file.size, dataUrl: String(reader.result) });
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(file);
      })));
      const creativeSession = { id: createId(), startedAt: Date.now(), title: notes.trim().slice(0, 42), notes: notes.trim(), secondDirector, screenwriter, references: storedReferences, notebook: [], messages: [] };
      const response = await authenticatedFetch("/api/project-document", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: currentAIProvider(), brief: creativeSession.notes, notes: [], messages: [], team: { secondDirector: secondDirector.name, screenwriter: screenwriter.name }, skipDiscussion: true }),
      });
      const document = await response.json();
      if (!response.ok) throw new Error(document.error ?? "COULD NOT BUILD PROJECT DOCUMENT.");
      const completedSession = { ...creativeSession, projectDocument: document };
      sessionStorage.setItem("carabasaiCreativeSession", JSON.stringify(completedSession));
      const history = getCachedProjects();
      saveProjects([completedSession, ...history].slice(0, 20));
      await generateProjectCover(creativeSession);
      router.push("/studio/project");
    } catch (skipError) {
      setReferenceError(skipError instanceof Error ? skipError.message : "COULD NOT BUILD PROJECT DOCUMENT.");
    } finally {
      setIsSkippingDiscussion(false);
    }
  }

  return (
    <main
      className="min-h-screen bg-[#050505] px-5 py-6 pt-20 text-white sm:px-8 md:pl-[calc(var(--studio-sidebar-width,260px)+32px)] md:pt-6 lg:pr-12"
      style={{ "--history-width": `${historyWidth}px` } as React.CSSProperties}
    >
      <StudioSidebar />
      <WorkflowNav />
      <nav className="hidden" style={{ width: historyWidth }}>
        <p className="text-[11px] font-black tracking-[0.2em] text-[#FFDF00]">CARABASAI STUDIO</p>
        <div className="mt-6 grid gap-2">
          <a href="/studio" className="flex h-11 items-center justify-between rounded-xl bg-[#FFDF00] px-4 text-[10px] font-black tracking-[0.12em] text-black">STUDIO HOME <span>⌂</span></a>
          <a href="/account" className="flex h-11 items-center justify-between rounded-xl border border-white/10 bg-white/[0.025] px-4 text-[10px] font-black tracking-[0.12em] text-white/65 transition hover:border-[#FFDF00]/30 hover:text-white">MY ACCOUNT <span className="text-[#FFDF00]">○</span></a>
          <a href="mailto:info@carabasai.com" className="flex h-11 items-center justify-between rounded-xl border border-white/10 bg-white/[0.025] px-4 text-[10px] font-black tracking-[0.12em] text-white/65 transition hover:border-[#FFDF00]/30 hover:text-white">HELP DESK <span className="text-[#FFDF00]">?</span></a>
        </div>
        <div className="mt-auto border-t border-white/10 pt-4">
          <button type="button" onClick={() => setHistoryOpen((current) => !current)} className="flex w-full items-center justify-between py-2 text-left text-[10px] font-black uppercase tracking-[0.18em] text-[#FFDF00]">
            SESSION HISTORY <span>{historyOpen ? "−" : "+"}</span>
          </button>
          {historyOpen && <p className="mt-1 text-[9px] uppercase leading-5 text-white/25">RETURN TO YOUR CREATIVE ROOMS</p>}
        </div>
        {historyOpen && <div className="mt-4 max-h-[48vh] space-y-2 overflow-y-auto">
          {sessionHistory.length === 0 ? (
            <p className="text-[9px] uppercase leading-5 text-white/25">
              YOUR SAVED SESSIONS WILL APPEAR HERE.
            </p>
          ) : (
            [...sessionHistory].sort((a, b) => Number(Boolean(b.favorite)) - Number(Boolean(a.favorite))).map((saved) => (
              <div
                key={saved.id ?? saved.startedAt ?? saved.notes}
                className="group flex w-full items-center gap-1 rounded-[14px] border border-white/8 bg-white/[0.025] p-2 transition hover:border-[#FFDF00]/30"
              >
                <div className="min-w-0 flex-1 px-1 py-1">
                  {editingSessionId === saved.id ? (
                    <input value={editingTitle} onChange={(event) => setEditingTitle(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") saveSessionTitle(saved.id); if (event.key === "Escape") setEditingSessionId(null); }} autoFocus className="w-full rounded-lg border border-[#FFDF00]/30 bg-black/40 px-2 py-2 text-[10px] text-white outline-none" />
                  ) : (
                    <button type="button" onClick={() => openSavedSession(saved)} className="w-full text-left">
                      <p className={`${expandedSessionId === saved.id ? "whitespace-pre-wrap break-words" : "truncate"} text-[10px] font-black text-white/70`}>{expandedSessionId === saved.id && saved.title === saved.notes.slice(0, 42) ? saved.notes : saved.title || saved.notes}</p>
                      <p className="mt-2 truncate text-[8px] uppercase text-white/25">{saved.secondDirector.name} + {saved.screenwriter.name}</p>
                    </button>
                  )}
                  {expandedSessionId === saved.id && (
                    <div className="mt-3 border-t border-white/8 pt-3">
                      <p className="mt-3 text-[8px] uppercase tracking-[0.08em] text-white/25">{saved.startedAt ? new Date(saved.startedAt).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" }) : "DATE NOT RECORDED"}</p>
                    </div>
                  )}
                </div>
                <button type="button" onClick={() => editingSessionId === saved.id ? saveSessionTitle(saved.id) : (setEditingSessionId(saved.id ?? null), setEditingTitle(!saved.title || saved.title === saved.notes.slice(0, 42) ? saved.notes : saved.title))} className="h-8 w-8 shrink-0 text-xs text-white/25 hover:text-white" aria-label={editingSessionId === saved.id ? "Save session title" : "Edit session title"}>{editingSessionId === saved.id ? "✓" : "✎"}</button>
                <button type="button" onClick={() => setExpandedSessionId((current) => current === saved.id ? null : saved.id ?? null)} className="h-8 w-8 shrink-0 text-sm text-white/30 hover:text-white" aria-label={expandedSessionId === saved.id ? "Collapse session details" : "Expand session details"}>{expandedSessionId === saved.id ? "⌃" : "⌄"}</button>
                {Boolean(saved.projectDocument) && <button type="button" onClick={() => openSavedSummary(saved)} className="h-8 w-8 shrink-0 text-xs text-[#FFDF00]" aria-label="Open summary">▤</button>}
                <button type="button" onClick={() => updateSessionHistory(saved.id, "favorite")} className={`h-8 w-8 shrink-0 text-base ${saved.favorite ? "text-[#FFDF00]" : "text-white/20 hover:text-[#FFDF00]"}`} aria-label={saved.favorite ? "Remove from favorites" : "Add to favorites"}>★</button>
                <button type="button" onClick={() => void platformConfirm({ eyebrow: "SESSION HISTORY", title: "DELETE SESSION?", message: "This creative session will be permanently removed.", confirmLabel: "DELETE SESSION", tone: "danger" }).then((confirmed) => { if (confirmed) updateSessionHistory(saved.id, "delete"); })} className="h-8 w-8 shrink-0 text-sm text-white/15 hover:text-red-300" aria-label="Delete session">×</button>
              </div>
            ))
          )}
        </div>}
        <p className="mt-3 border-t border-white/10 pt-4 text-[8px] uppercase leading-4 text-white/20">
          SAVED IN THIS BROWSER
        </p>
        <button type="button" onPointerDown={resizeHistory} onPointerUp={() => localStorage.setItem("carabasaiHistoryWidth", String(historyWidth))} className="absolute bottom-0 right-0 top-0 w-2 cursor-col-resize touch-none hover:bg-[#FFDF00]/20" aria-label="Resize session history" />
      </nav>
      <header className="hidden">
        <span />
        <div className="flex items-center gap-2 text-[9px] font-black tracking-[0.1em]">
          <span className="text-[#FFDF00]">CREW SETUP</span>
          {hasDialogueStage && <><span className="text-white/20">/</span><button type="button" onClick={() => router.push("/studio/creative-room")} className="text-white/45">DIALOGUE</button></>}
          {hasSummaryStage && <><span className="text-white/20">/</span><button type="button" onClick={() => router.push("/studio/project")} className="text-white/45">SUMMARY</button></>}
        </div>
      </header>

      <section className="mx-auto mt-8 w-full max-w-7xl lg:mt-14">
        <p className="text-xs font-black uppercase tracking-[0.25em] text-[#FFDF00]">
          DIRECTOR&apos;S OFFICE
        </p>
        <h1 className="mt-5 max-w-4xl text-[clamp(2.8rem,8vw,7.5rem)] font-black uppercase leading-[0.88] tracking-[-0.07em]">
          ASSEMBLE YOUR
          <br />
          FILM CREW.
        </h1>
        <p className="mt-7 max-w-2xl text-sm uppercase leading-7 text-white/50 sm:text-lg">
          YOU ARE THE DIRECTOR. CHOOSE THE CREATIVE TEAM THAT WILL EXECUTE YOUR
          VISION.
        </p>

        <section className="mt-14">
          <p className="text-xs font-black uppercase tracking-[0.22em] text-white/35">
            CREATIVE LEADERSHIP
          </p>
          <div className="mt-6 grid gap-4 md:grid-cols-2">
            <CrewRoleCard
              config={roleConfigs.secondDirector}
              selectedMember={selectedSecondDirector}
              isLocked={false}
              onOpen={() => openSelection("secondDirector")}
            />
            <CrewRoleCard
              config={roleConfigs.screenwriter}
              selectedMember={selectedScreenwriter}
              isLocked={!selectedSecondDirector}
              onOpen={() => openSelection("screenwriter")}
            />
          </div>
        </section>

        <section className="mt-16">
          <p className="text-xs font-black uppercase tracking-[0.22em] text-white/35">
            DIRECTOR&apos;S NOTES
          </p>
          <div className="mt-6 overflow-hidden rounded-[28px] border border-white/10 bg-white/[0.025]">
            <textarea
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              placeholder="TELL THE CREW WHAT YOU WANT TO CREATE..."
              className="min-h-[190px] w-full resize-none bg-transparent px-6 py-7 text-lg normal-case leading-8 text-white outline-none placeholder:uppercase placeholder:text-white/20 sm:px-8 sm:text-2xl"
            />

            {references.length > 0 && (
              <div className="grid gap-2 border-t border-white/10 px-6 py-5 sm:grid-cols-2 sm:px-8 lg:grid-cols-3">
                {references.map(({ id, file }) => (
                  <div
                    key={id}
                    className="relative min-w-0 overflow-hidden rounded-[16px] border border-white/10 bg-black/25"
                  >
                    <ReferencePreview file={file} />
                    <div className="min-w-0 px-3 py-3 pr-12">
                      <p className="truncate text-xs font-black uppercase text-white/80">
                        {file.name}
                      </p>
                      <p className="mt-1 text-[10px] uppercase text-white/30">
                        {formatFileSize(file.size)}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => removeReference(id)}
                      className="absolute right-3 top-3 flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-full border border-white/15 bg-black/65 text-lg text-white/70 transition hover:border-red-400/50 hover:text-red-300"
                      aria-label={`Remove ${file.name}`}
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}

            {referenceError && (
              <p className="border-t border-white/10 px-6 py-3 text-[10px] font-black uppercase tracking-[0.12em] text-red-300 sm:px-8">
                {referenceError}
              </p>
            )}

            <div className="flex flex-col gap-4 border-t border-white/10 px-6 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-8">
              <input
                ref={referenceInputRef}
                type="file"
                multiple
                accept="image/*,video/*,application/pdf"
                onChange={(event) => addReferences(event.target.files)}
                className="hidden"
              />
              <div className="flex items-center gap-2 self-start sm:self-auto">
                <button type="button" onClick={() => referenceInputRef.current?.click()} className="min-h-10 cursor-pointer rounded-full border border-white/15 px-4 py-2 text-[9px] font-black uppercase text-white/65">+ ADD REFERENCES{references.length > 0 ? ` (${references.length})` : ""}</button>
                <div className="relative">
                  <button type="button" onClick={() => void resetBriefAndReferences()} className="min-h-10 rounded-full border border-white/10 px-4 py-2 text-[8px] font-black text-white/30 hover:border-white/20 hover:text-white/60">RESET</button>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <AIProviderSwitch />
              </div>
              <div className="flex flex-col gap-2 sm:flex-row">
                <button type="button" onClick={() => void skipDiscussion()} disabled={!notes.trim() || !selectedSecondDirector || !selectedScreenwriter || isSkippingDiscussion} className="min-h-12 cursor-pointer rounded-full border border-[#FFDF00]/25 px-6 py-3 text-[10px] font-black uppercase tracking-[0.1em] text-[#FFDF00] transition hover:bg-[#FFDF00]/5 disabled:cursor-not-allowed disabled:opacity-20">
                  {isSkippingDiscussion ? "TEAM IS BUILDING..." : "SKIP DISCUSSION →"}
                </button>
                <button
                  type="button"
                  onClick={() => void startCreativeSession()}
                  disabled={!notes.trim() || !selectedSecondDirector || !selectedScreenwriter || isSkippingDiscussion || isStartingSession}
                  className="min-h-12 cursor-pointer rounded-full bg-[#FFDF00] px-7 py-3 text-sm font-black uppercase tracking-[0.12em] text-black transition hover:bg-[#FFE633] disabled:cursor-not-allowed disabled:opacity-25"
                >
                  <span className="flex items-center justify-center gap-3">
                    {isStartingSession && <span className="h-4 w-4 animate-spin rounded-full border-2 border-black/25 border-t-black" aria-hidden="true" />}
                    {isStartingSession ? "STARTING SESSION..." : "START CREATIVE SESSION"}
                  </span>
                </button>
              </div>
            </div>
          </div>
        </section>
      </section>

      {authGateOpen && (
        <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/85 p-5 backdrop-blur-md" role="dialog" aria-modal="true" aria-label="Create an account to continue">
          <button type="button" aria-label="Close" onClick={() => setAuthGateOpen(false)} className="absolute inset-0 cursor-default" />
          <section className="relative z-10 w-full max-w-md rounded-[28px] border border-white/10 bg-[#0A0A0A] p-7 shadow-2xl sm:p-9">
            <button type="button" onClick={() => setAuthGateOpen(false)} aria-label="Close" className="absolute right-5 top-5 flex h-9 w-9 items-center justify-center rounded-full border border-white/10 text-lg text-white/45 hover:text-white">×</button>
            <p className="text-[10px] font-black tracking-[0.18em] text-[#FFDF00]">SAVE YOUR CREATIVE SESSION</p>
            <h2 className="mt-4 pr-8 text-3xl font-black tracking-[-0.04em] text-white">CREATE AN ACCOUNT TO START.</h2>
            <p className="mt-4 text-sm leading-6 text-white/45">Your team, conversation, references and project document will be securely connected to your account.</p>
            <a href="/account?mode=sign-up&next=/studio" className="mt-7 flex h-12 w-full items-center justify-center rounded-full bg-[#FFDF00] text-[10px] font-black text-black">CREATE ACCOUNT</a>
            <a href="/account?mode=sign-in&next=/studio" className="mt-3 flex h-11 w-full items-center justify-center rounded-full border border-white/12 text-[10px] font-black text-white/60">I ALREADY HAVE AN ACCOUNT</a>
          </section>
        </div>
      )}

      {activeConfig && (
        <div
          className="fixed inset-0 z-[9999] flex items-end justify-center bg-black/85 p-0 backdrop-blur-md sm:p-3 lg:items-center lg:p-6"
          role="dialog"
          aria-modal="true"
          aria-label={activeConfig.rosterTitle}
        >
          <div
            aria-hidden="true"
            onClick={closeSelection}
            className="absolute inset-0 cursor-pointer"
          />
          <section className="relative z-10 flex max-h-[100dvh] w-full max-w-7xl flex-col overflow-hidden rounded-t-[28px] border border-white/10 bg-[#0A0A0A] sm:max-h-[calc(100dvh-24px)] lg:max-h-[92vh] lg:rounded-[30px]">
            <header className="flex shrink-0 items-center justify-between border-b border-white/10 bg-[#0A0A0A] px-4 py-4 sm:px-8">
              <div className="pr-4">
                <p className="text-[10px] font-black uppercase tracking-[0.2em] text-[#FFDF00] sm:text-[11px]">
                  {activeConfig.rosterTitle}
                </p>
                <h2 className="mt-2 text-base font-black uppercase sm:text-2xl">
                  {activeConfig.rosterSubtitle}
                </h2>
              </div>
              <button
                type="button"
                onClick={closeSelection}
                className="flex h-12 w-12 shrink-0 cursor-pointer items-center justify-center rounded-full border border-white/15 text-2xl text-white/70"
                aria-label="Close"
              >
                ×
              </button>
            </header>

            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
              <div className="border-b border-white/10 p-3 sm:p-4">
                <div className="flex gap-3 overflow-x-auto pb-2">
                  {activeConfig.members.map((member) => {
                    const isActive = activeMember.id === member.id;
                    return (
                      <button
                        key={member.id}
                        type="button"
                        onClick={() => setActiveMember(member)}
                        className={`flex min-w-[230px] cursor-pointer items-center gap-3 rounded-[18px] border p-3 text-left sm:min-w-[260px] ${
                          isActive
                            ? "border-[#FFDF00] bg-[#FFDF00]/10"
                            : "border-white/10 bg-white/[0.02]"
                        }`}
                      >
                        <MemberPortrait
                          member={member}
                          className="h-14 w-14 shrink-0 rounded-[14px] object-cover"
                        />
                        <div>
                          <p
                            className={`text-sm font-black uppercase ${
                              isActive ? "text-[#FFDF00]" : "text-white"
                            }`}
                          >
                            {member.name}
                          </p>
                          <p className="mt-1 text-[10px] uppercase leading-4 text-white/40">
                            {member.specialty}
                          </p>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="grid lg:grid-cols-[minmax(340px,0.85fr)_1.15fr]">
                <div className="relative aspect-square w-full overflow-hidden bg-[#111]">
                  <MemberPortrait
                    member={activeMember}
                    className="absolute inset-0 h-full w-full object-cover object-center"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black via-transparent to-transparent" />
                  <div className="absolute bottom-0 left-0 right-0 p-5 sm:p-8">
                    <p className="text-[10px] font-black uppercase tracking-[0.2em] text-[#FFDF00] sm:text-xs">
                      {activeConfig.eyebrow}
                    </p>
                    <h3 className="mt-2 text-3xl font-black uppercase tracking-[-0.05em] sm:text-5xl">
                      {activeMember.name}
                    </h3>
                    <p className="mt-2 text-xs font-black uppercase tracking-[0.1em] text-white/60 sm:text-sm">
                      {activeMember.specialty}
                    </p>
                  </div>
                </div>

                <div className="flex min-h-[620px] flex-col p-5 sm:p-8">
                  <blockquote className="text-xl font-black leading-tight tracking-[-0.03em] text-[#FFDF00] sm:text-3xl">“{readableText(activeMember.quote)}”</blockquote>
                  <div className="mt-5 rounded-[18px] border border-[#FFDF00]/20 bg-[#FFDF00]/5 p-4">
                    <p className="text-[9px] font-black uppercase tracking-[0.16em] text-[#FFDF00]">SIGNATURE MOVE</p>
                    <p className="mt-2 text-sm leading-6 text-white/80">⚡ {activeMember.signatureMove ?? readableText(activeMember.description)}</p>
                  </div>
                  <p className="mt-5 text-sm leading-6 text-white/55">{readableText(activeMember.description)}</p>
                  <div className="mt-4 flex flex-wrap gap-2">{(activeMember.tags ?? activeMember.strengths).map((tag) => <span key={tag} className="rounded-full border border-white/10 bg-white/[0.035] px-3 py-1.5 text-[8px] font-black uppercase tracking-[0.08em] text-white/45">{tag}</span>)}</div>
                  <div className="mt-5 grid gap-3 text-xs sm:grid-cols-2">
                    <p className="rounded-[14px] border border-white/8 p-3 leading-5 text-white/55"><span className="mr-2 font-black uppercase text-[#FFDF00]">BEST FOR</span>{activeMember.bestFor ?? readableText(activeMember.strengths.join(", "))}</p>
                    <p className="rounded-[14px] border border-white/8 p-3 leading-5 text-white/45"><span className="mr-2 font-black uppercase text-white/25">NOT FOR</span>{activeMember.notFor ?? readableText(activeMember.limitations.join(", "))}</p>
                  </div>
                  <div className="mt-6">
                    <div className="flex items-end justify-between"><p className="text-[10px] font-black uppercase tracking-[0.18em] text-white/35">CHARACTER STATS</p><p className="text-[8px] uppercase text-white/20">0–10</p></div>
                    <div className="mt-3 space-y-3">{(activeMember.stats ?? []).map((stat) => <div key={stat.label} className="grid grid-cols-[116px_1fr_24px] items-center gap-3"><span className="text-[9px] font-black uppercase tracking-[0.06em] text-white/50">{stat.label}</span><div className="h-1.5 overflow-hidden rounded-full bg-white/10"><div className="h-full rounded-full bg-[#FFDF00]" style={{ width: `${Math.max(0, Math.min(10, stat.value)) * 10}%` }} /></div><span className="text-right text-[9px] font-black text-white/60">{stat.value}</span></div>)}</div>
                  </div>
                  <div className="mt-7">
                    <p className="text-[10px] font-black uppercase tracking-[0.18em] text-white/35">REFERENCE WORKS</p>
                    <div className="mt-3 flex gap-3 overflow-x-auto pb-2">{(activeMember.referenceWorks ?? []).map((work) => <button key={`${work.title}-${work.year}`} type="button" className="group w-24 shrink-0 text-left" aria-label={`${work.title}, ${work.year}`}><div className="flex aspect-[2/3] items-end overflow-hidden rounded-[10px] border border-white/10 bg-[linear-gradient(145deg,#292929,#0b0b0b)] bg-cover bg-center p-2 text-[9px] font-black leading-3 text-white/50 transition duration-200 group-hover:scale-105" style={work.imageUrl ? { backgroundImage: `linear-gradient(transparent, rgba(0,0,0,.75)), url(${work.imageUrl})` } : undefined}>{work.title}</div><p className="mt-2 truncate text-[9px] font-bold text-white/55">{work.title}</p><p className="mt-1 text-[8px] text-white/25">{work.year}</p></button>)}</div>
                  </div>
                  <p className="mt-5 text-[9px] uppercase tracking-[0.1em] text-white/25">INSPIRED BY <span className="text-white/45">{activeMember.influences.join(" / ")}</span></p>
                </div>
              </div>
            </div>
            <footer className="flex shrink-0 flex-col gap-3 border-t border-white/10 bg-[#0A0A0A] px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-8">
              <p className="text-[9px] uppercase leading-5 text-white/30 sm:text-[10px]">
                YOU REMAIN THE DIRECTOR. THIS PERSON BRINGS A DISTINCT METHOD TO YOUR PROJECT.
              </p>
              <button
                type="button"
                onClick={hireMember}
                className="min-h-12 w-full shrink-0 cursor-pointer rounded-full bg-[#FFDF00] px-7 py-3 text-sm font-black uppercase tracking-[0.1em] text-black hover:bg-[#FFE633] sm:w-auto"
              >
                {activeConfig.hireLabel}
              </button>
            </footer>
          </section>
        </div>
      )}
    </main>
  );
}
