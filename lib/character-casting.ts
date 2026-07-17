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
  characterExamples: Array<{ image: string; alt: string; name: string }>;
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
    quote:
      "“Before the costume, there is the bone. I find the face first — everything else is just fabric.”",
    biography:
      "A casting master for gothic and theatrical stories. He does not design costumes: he finds the face, anatomy and physical presence that make a character believable before the costume department arrives.",
    inspiredBy:
      "Alexander McQueen + Guillermo del Toro — the dramatic sharpness of one and the warm obsession with unusual faces of the other.",
    signature: "Every face is chosen for what it hides, not what it shows.",
    tags: [
      "SHARP FEATURES",
      "UNCONVENTIONAL BODY TYPES",
      "RAW PRESENCE",
      "PRE-COSTUME CASTING",
    ],
    bestFor:
      "Gothic drama, theatrical ensembles and character-driven stories where the face carries the story.",
    notFor:
      "Cute or cheerful cartoon looks and casts built around one uniform beauty standard.",
    stats: [
      { label: "EXPRESSIVENESS", value: 8 },
      { label: "COMPLEXITY", value: 6 },
      { label: "VIBRANCY", value: 3 },
      { label: "REALISM", value: 8 },
      { label: "VERSATILITY", value: 6 },
    ],
    portrait: "/crew/character-casting/specialists/elias-marrow.png",
    characterExamples: [
      {
        image: "/crew/character-casting/elias-marrow/R001001.jpeg",
        alt: "Alistair Vane",
        name: "Alistair Vane",
      },
      {
        image: "/crew/character-casting/elias-marrow/R001002.jpeg",
        alt: "Darius Okafor",
        name: "Darius Okafor",
      },
      {
        image: "/crew/character-casting/elias-marrow/R001003.jpeg",
        alt: "Elara Finch",
        name: "Elara Finch",
      },
      {
        image: "/crew/character-casting/elias-marrow/R001004.jpeg",
        alt: "Mirella Costa",
        name: "Mirella Costa",
      },
      {
        image: "/crew/character-casting/elias-marrow/R001005.jpeg",
        alt: "Viktor Drake",
        name: "Viktor Drake",
      },
      {
        image: "/crew/character-casting/elias-marrow/R001006.jpeg",
        alt: "Hana Mori",
        name: "Hana Mori",
      },
      {
        image: "/crew/character-casting/elias-marrow/R001007.jpeg",
        alt: "Isaiah Cole",
        name: "Isaiah Cole",
      },
      {
        image: "/crew/character-casting/elias-marrow/R001008.jpeg",
        alt: "Sabine Krall",
        name: "Sabine Krall",
      },
      {
        image: "/crew/character-casting/elias-marrow/R001009.png",
        alt: "Oswald Pike",
        name: "Oswald Pike",
      },
      {
        image: "/crew/character-casting/elias-marrow/R001010.png",
        alt: "Fergus Rowan",
        name: "Fergus Rowan",
      },
      {
        image: "/crew/character-casting/elias-marrow/R001011.png",
        alt: "Kemal Arslan",
        name: "Kemal Arslan",
      },
      {
        image: "/crew/character-casting/elias-marrow/R001012.png",
        alt: "Mei-Lin Zhao",
        name: "Mei-Lin Zhao",
      },
      {
        image: "/crew/character-casting/elias-marrow/R001013.png",
        alt: "Rory Kavanagh",
        name: "Rory Kavanagh",
      },
      {
        image: "/crew/character-casting/elias-marrow/R001014.png",
        alt: "Silas Wren",
        name: "Silas Wren",
      },
      {
        image: "/crew/character-casting/elias-marrow/R001015.png",
        alt: "Kwame Adebayo",
        name: "Kwame Adebayo",
      },
      {
        image: "/crew/character-casting/elias-marrow/R001016.png",
        alt: "Agnes Bell",
        name: "Agnes Bell",
      },
      {
        image: "/crew/character-casting/elias-marrow/R001017.jpeg",
        alt: "Niko Petrov",
        name: "Niko Petrov",
      },
      {
        image: "/crew/character-casting/elias-marrow/R001018.jpeg",
        alt: "Lucien Vale",
        name: "Lucien Vale",
      },
      {
        image: "/crew/character-casting/elias-marrow/R001019.png",
        alt: "Bernard Holt",
        name: "Bernard Holt",
      },
      {
        image: "/crew/character-casting/elias-marrow/R001020.png",
        alt: "Evelyn Okoye",
        name: "Evelyn Okoye",
      },
    ],
    referenceWorks: [
      { title: "PAN'S LABYRINTH", year: "2006" },
      { title: "SLEEPY HOLLOW", year: "1999" },
    ],
    visualPromptTemplate:
      "Apply the trained R001 gothic character-casting look exactly. This is a stylized, sculptural casting portrait with deliberately exaggerated yet believable facial structure, anatomy, posture and body silhouette. Prefer sharp or irregular features, unconventional body types, lived-in tactile skin, expressive asymmetry and raw physical presence. The result must look like a character maquette from the R001 portfolio, not an ordinary realistic person, fashion photograph or beauty portrait. Dress every subject in the same minimal all-black casting uniform: a plain black turtleneck or plain black long-sleeve top, black trousers and simple black shoes. Place the subject against one clean, seamless, richly colored studio backdrop such as burgundy, mustard yellow, cyan, burnt orange, dusty pink, deep red or blue-grey. Use soft diffused cinematic studio lighting. The face and body carry the character; there is no costume design, jewelry, pattern, prop or location yet.",
    generation: {
      triggerWord: "R001",
      modelEnvironmentVariable: "REPLICATE_R001_MODEL",
      defaultAspectRatio: "9:16",
      defaultLoraStrength: 1,
    },
  },
];

export function buildCharacterCastingPrompt(
  specialist: CharacterCastingSpecialist,
  characterBrief: string,
) {
  return `${specialist.generation.triggerWord}. ${specialist.generation.triggerWord} character casting portrait.

NON-NEGOTIABLE CHARACTER IDENTITY:
${characterBrief.trim()}

Follow every explicit identity attribute exactly. Age, apparent gender, ancestry, skin tone, hair color, hair texture, facial hair, height, build and distinguishing features are hard requirements. Never replace, omit, soften or reinterpret them.

MANDATORY R001 CASTING STYLE:
${specialist.visualPromptTemplate}

PRESENTATION RULES, ALL REQUIRED:
- One single person, full body from head to toe, centered in a vertical 9:16 casting portrait.
- Stylized and sculptural R001 proportions. Do not fall back to ordinary human realism or generic fashion photography.
- Plain all-black casting uniform only: black turtleneck or black long-sleeve top, black trousers and black shoes. No other clothing color.
- One saturated seamless colored studio backdrop in the R001 portfolio language. No real location, scenery, grey background, white background or neutral photographic backdrop.
- Face clearly visible, soft diffused cinematic studio light, tactile skin and a clean floor-to-background sweep.

No text, typography, logos, watermarks, collage, split screen, extra people, elaborate costume, hat, jewelry, accessories, props, patterns, cropped head, cropped feet, beauty-advertising polish, ordinary realistic proportions or generic fashion-model face.`;
}

const generatedActorNames = {
  eastAsian: {
    female: [
      "Hana Mori",
      "Mei-Lin Zhao",
      "Yuna Park",
      "Aiko Tanaka",
      "Linh Tran",
    ],
    male: [
      "Kenji Sato",
      "Min-Jun Park",
      "Wei Chen",
      "Haruto Mori",
      "Daniel Kim",
    ],
  },
  black: {
    female: [
      "Amara Okoye",
      "Nia Adebayo",
      "Imani Cole",
      "Zuri Mensah",
      "Evelyn Okafor",
    ],
    male: [
      "Darius Okafor",
      "Kwame Adebayo",
      "Isaiah Cole",
      "Malik Mensah",
      "Solomon Adeyemi",
    ],
  },
  southAsian: {
    female: [
      "Priya Nair",
      "Anika Mehta",
      "Leela Kapoor",
      "Maya Rao",
      "Sana Qureshi",
    ],
    male: [
      "Arjun Mehta",
      "Dev Kapoor",
      "Rohan Nair",
      "Kabir Rao",
      "Sameer Qureshi",
    ],
  },
  middleEastern: {
    female: [
      "Layla Mansour",
      "Noor Haddad",
      "Samira Khalil",
      "Dalia Rahman",
      "Yasmin Farouk",
    ],
    male: [
      "Omar Haddad",
      "Karim Mansour",
      "Tariq Khalil",
      "Sami Rahman",
      "Nabil Farouk",
    ],
  },
  latino: {
    female: [
      "Sofia Reyes",
      "Camila Alvarez",
      "Ines Navarro",
      "Lucia Morales",
      "Elena Cruz",
    ],
    male: [
      "Mateo Alvarez",
      "Diego Reyes",
      "Rafael Navarro",
      "Tomas Morales",
      "Gabriel Cruz",
    ],
  },
  slavic: {
    female: [
      "Irina Sokolova",
      "Mila Petrova",
      "Anya Volkova",
      "Vera Markovic",
      "Lena Kovacs",
    ],
    male: [
      "Nikolai Volkov",
      "Anton Petrov",
      "Luka Markovic",
      "Viktor Sokolov",
      "Marek Kovacs",
    ],
  },
  international: {
    female: [
      "Elara Finch",
      "Sabine Krall",
      "Mirella Costa",
      "Agnes Bell",
      "Clara Voss",
      "Evelyn Hart",
      "Nora Vale",
    ],
    male: [
      "Alistair Vane",
      "Lucien Vale",
      "Bernard Holt",
      "Silas Wren",
      "Fergus Rowan",
      "Oswald Pike",
      "Niko Arden",
    ],
  },
};

function stableNameIndex(value: string, length: number) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1)
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  return hash % length;
}

type CastingGender = "female" | "male" | "unknown";

const explicitFemaleMarkers = [
  /\b(?:woman|women|girl|female|mother|wife|daughter|actress|lady|sister|grandmother)\b/i,
  /(?:^|[^а-яё])(?:женщина|девушка|девочка|мать|мама|жена|дочь|актриса|героиня|сестра|бабушка|старушка)(?:$|[^а-яё])/iu,
];

const explicitMaleMarkers = [
  /\b(?:man|men|boy|male|father|husband|son|actor|gentleman|brother|grandfather)\b/i,
  /(?:^|[^а-яё])(?:мужчина|парень|мальчик|отец|папа|муж|сын|актёр|актер|герой|брат|дедушка|старик)(?:$|[^а-яё])/iu,
];

const supportingFemaleMarkers = [
  /(?:^|[^а-яё])(?:молодая|высокая|рыжая|кудрявая|стройная|полная)(?:$|[^а-яё])/iu,
];

const supportingMaleMarkers = [
  /\b(?:beard|bearded|moustache|mustache)\b/i,
  /(?:^|[^а-яё])(?:молодой|высокий|рыжий|кудрявый|усы|усами|борода|бородой)(?:$|[^а-яё])/iu,
];

function firstMarkerIndex(value: string, patterns: RegExp[]) {
  let first = Number.POSITIVE_INFINITY;
  for (const pattern of patterns) {
    const match = pattern.exec(value);
    if (match && match.index < first) first = match.index;
  }
  return first;
}

export function detectCastingGender(characterBrief: string): CastingGender {
  const brief = characterBrief.toLowerCase();
  const femaleIndex = firstMarkerIndex(brief, explicitFemaleMarkers);
  const maleIndex = firstMarkerIndex(brief, explicitMaleMarkers);

  if (femaleIndex !== maleIndex)
    return femaleIndex < maleIndex ? "female" : "male";

  const hasFemaleSupport = supportingFemaleMarkers.some((pattern) =>
    pattern.test(brief),
  );
  const hasMaleSupport = supportingMaleMarkers.some((pattern) =>
    pattern.test(brief),
  );

  if (hasFemaleSupport !== hasMaleSupport)
    return hasFemaleSupport ? "female" : "male";
  return "unknown";
}

export function generateCastingActorName(characterBrief: string, seed: string) {
  const brief = characterBrief.toLowerCase();
  const pool =
    /east asian|asian|chinese|japanese|korean|vietnam|азиат|китай|япон|коре/.test(
      brief,
    )
      ? generatedActorNames.eastAsian
      : /black|african|afro|темнокож|африкан/.test(brief)
        ? generatedActorNames.black
        : /south asian|indian|pakistan|bangladesh|индий|пакистан/.test(brief)
          ? generatedActorNames.southAsian
          : /middle eastern|arab|persian|араб|ближневост|перс/.test(brief)
            ? generatedActorNames.middleEastern
            : /latino|latina|hispanic|латино|испан/.test(brief)
              ? generatedActorNames.latino
              : /slavic|russian|ukrain|polish|русск|славян|украин|поляк/.test(
                    brief,
                  )
                ? generatedActorNames.slavic
                : generatedActorNames.international;
  const gender = detectCastingGender(brief);
  const names =
    gender === "female"
      ? pool.female
      : gender === "male"
        ? pool.male
        : [...pool.female, ...pool.male];
  return names[stableNameIndex(`${seed}:${brief}`, names.length)];
}
