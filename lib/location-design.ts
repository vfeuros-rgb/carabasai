export type LocationSpecialist = {
  id: string;
  name: string;
  role: string;
  approach: string;
  signature: string;
  portrait: string;
};

export const locationSpecialists: LocationSpecialist[] = [
  {
    id: "mara-voss",
    name: "MARA VOSS",
    role: "PRODUCTION DESIGNER",
    approach: "Grounded architecture, precise spatial continuity and locations that can survive every camera angle.",
    signature: "REAL SPACE / CONTROLLED DETAIL",
    portrait: "/crew/second-directors/GrishaPravdin.png",
  },
  {
    id: "ivo-serin",
    name: "IVO SERIN",
    role: "ATMOSPHERE DESIGNER",
    approach: "Expressive spaces built around light, texture, weather and the emotional pressure of the scene.",
    signature: "MOOD / LIGHT / TEXTURE",
    portrait: "/crew/second-directors/AmbrosePeak.png",
  },
  {
    id: "naomi-vale",
    name: "NAOMI VALE",
    role: "VIRTUAL ART DIRECTOR",
    approach: "Generation-safe environments with clean geometry, repeatable landmarks and production-ready continuity.",
    signature: "AI CONTINUITY / CLEAN GEOMETRY",
    portrait: "/crew/Screenwriters/VeraPlot.png",
  },
];

