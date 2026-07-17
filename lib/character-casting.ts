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
    ],
    referenceWorks: [
      { title: "PAN'S LABYRINTH", year: "2006" },
      { title: "SLEEPY HOLLOW", year: "1999" },
    ],
    visualPromptTemplate:
      "Cast the character through Elias Marrow's gothic character-casting eye. Begin with the face, skull structure, posture, anatomy and body silhouette before any wardrobe decision. Prefer sharp or irregular features, unconventional but believable body types, lived-in skin, expressive asymmetry and a raw physical presence. The character must feel emotionally legible and personally specific rather than conventionally beautiful. Use cinematic photorealism with tactile skin and restrained, low-saturation color. Keep clothing neutral, simple and pre-costume: no designed outfit, fashion styling, decorative accessories or costume concept yet. Avoid cute cartoon proportions, glossy beauty advertising, generic model faces and a uniform cast.",
  },
];

export function buildCharacterCastingPrompt(
  specialist: CharacterCastingSpecialist,
  characterBrief: string,
) {
  return `${specialist.visualPromptTemplate}\n\nCHARACTER BRIEF:\n${characterBrief.trim()}`;
}
