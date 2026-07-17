export type CharacterCastingSpecialist = {
  id: string;
  rosterCode: string;
  name: string;
  specialty: string;
  quote: string;
  biography: string;
  inspiredBy: string;
  signature: string;
  tags: string[];
  bestFor: string;
  notFor: string;
  stats: Array<{ label: string; value: number }>;
  portrait: string;
  characterExamples: Array<{ image: string; alt: string }>;
  referenceWorks: Array<{ title: string; year: string }>;
  visualPromptTemplate: string;
  generation: {
    triggerWord: string;
    modelEnvironmentVariable: string;
    defaultAspectRatio: "9:16" | "1:1" | "16:9";
    defaultLoraStrength: number;
  };
};

export const characterCastingSpecialists: CharacterCastingSpecialist[] = [
  {
    id: "elias-marrow",
    rosterCode: "R001",
    name: "ELIAS MARROW",
    specialty: "GOTHIC CHARACTER CASTING",
    quote: '“Before the costume, there is the bone. I find the face first — everything else is just fabric.”',
    biography:
      "A casting master for gothic and theatrical stories. He does not design costumes: he finds the face, anatomy and physical presence that make a character believable before the costume department arrives.",
    inspiredBy:
      "Alexander McQueen + Guillermo del Toro — the dramatic sharpness of one and the warm obsession with unusual faces of the other.",
    signature: "Every face is chosen for what it hides, not what it shows.",
    tags: ["SHARP FEATURES", "UNCONVENTIONAL BODY TYPES", "RAW PRESENCE", "PRE-COSTUME CASTING"],
    bestFor: "Gothic drama, theatrical ensembles and character-driven stories where the face carries the story.",
    notFor: "Cute or cheerful cartoon looks and casts built around one uniform beauty standard.",
    stats: [
      { label: "EXPRESSIVENESS", value: 8 },
      { label: "COMPLEXITY", value: 6 },
      { label: "VIBRANCY", value: 3 },
      { label: "REALISM", value: 8 },
      { label: "VERSATILITY", value: 6 },
    ],
    portrait: "/crew/character-casting/specialists/elias-marrow.png",
    characterExamples: [
      { image: "/crew/character-casting/elias-marrow/R001001.jpeg", alt: "Elias Marrow casting sample 1" },
      { image: "/crew/character-casting/elias-marrow/R001002.jpeg", alt: "Elias Marrow casting sample 2" },
      { image: "/crew/character-casting/elias-marrow/R001003.jpeg", alt: "Elias Marrow casting sample 3" },
      { image: "/crew/character-casting/elias-marrow/R001004.jpeg", alt: "Elias Marrow casting sample 4" },
      { image: "/crew/character-casting/elias-marrow/R001005.jpeg", alt: "Elias Marrow casting sample 5" },
      { image: "/crew/character-casting/elias-marrow/R001006.jpeg", alt: "Elias Marrow casting sample 6" },
      { image: "/crew/character-casting/elias-marrow/R001007.jpeg", alt: "Elias Marrow casting sample 7" },
      { image: "/crew/character-casting/elias-marrow/R001008.jpeg", alt: "Elias Marrow casting sample 8" },
      { image: "/crew/character-casting/elias-marrow/R001009.png", alt: "Elias Marrow casting sample 9" },
      { image: "/crew/character-casting/elias-marrow/R001010.png", alt: "Elias Marrow casting sample 10" },
      { image: "/crew/character-casting/elias-marrow/R001011.png", alt: "Elias Marrow casting sample 11" },
      { image: "/crew/character-casting/elias-marrow/R001012.png", alt: "Elias Marrow casting sample 12" },
      { image: "/crew/character-casting/elias-marrow/R001013.png", alt: "Elias Marrow casting sample 13" },
      { image: "/crew/character-casting/elias-marrow/R001014.png", alt: "Elias Marrow casting sample 14" },
      { image: "/crew/character-casting/elias-marrow/R001015.png", alt: "Elias Marrow casting sample 15" },
      { image: "/crew/character-casting/elias-marrow/R001016.png", alt: "Elias Marrow casting sample 16" },
      { image: "/crew/character-casting/elias-marrow/R001017.jpeg", alt: "Elias Marrow casting sample 17" },
      { image: "/crew/character-casting/elias-marrow/R001018.jpeg", alt: "Elias Marrow casting sample 18" },
      { image: "/crew/character-casting/elias-marrow/R001019.png", alt: "Elias Marrow casting sample 19" },
      { image: "/crew/character-casting/elias-marrow/R001020.png", alt: "Elias Marrow casting sample 20" },
    ],
    referenceWorks: [
      { title: "PAN'S LABYRINTH", year: "2006" },
      { title: "SLEEPY HOLLOW", year: "1999" },
    ],
    visualPromptTemplate:
      "Apply the R001 gothic character-casting style. Begin with the face, skull structure, posture, anatomy and body silhouette before any wardrobe decision. Prefer sharp or irregular features, unconventional but believable body types, lived-in skin, expressive asymmetry and a raw physical presence. The character must feel emotionally legible and personally specific rather than conventionally beautiful. Use cinematic photorealism with tactile skin and restrained, low-saturation color. Keep clothing neutral, simple and pre-costume: no designed outfit, fashion styling, decorative accessories or costume concept yet. Avoid cute cartoon proportions, glossy beauty advertising, generic model faces and a uniform cast.",
    generation: {
      triggerWord: "R001",
      modelEnvironmentVariable: "REPLICATE_R001_MODEL",
      defaultAspectRatio: "9:16",
      defaultLoraStrength: 0.85,
    },
  },
];

export function buildCharacterCastingPrompt(
  specialist: CharacterCastingSpecialist,
  characterBrief: string,
) {
  return `${specialist.generation.triggerWord}, ${specialist.visualPromptTemplate}\n\nCHARACTER BRIEF:\n${characterBrief.trim()}\n\nGenerate one full-body character casting portrait on a simple studio background. No text, typography, logos, watermarks, collage or costume design.`;
}
