import type { MatchPreset } from "./services/api";

export interface PresetRules {
  maxRounds: number;
  knifeRound: boolean;
  overtime: boolean;
  overtimeRounds: number;
  playout: boolean;
}

export interface PresetInfo {
  id: MatchPreset;
  title: string;
  tag: string;
  description: string;
  rules?: PresetRules;
}

export const PRESETS: PresetInfo[] = [
  {
    id: "official",
    title: "Oficial",
    tag: "PREMIER / FACEIT",
    description: "MR12 com round de faca e overtime MR3 ($12.500).",
    rules: { maxRounds: 24, knifeRound: true, overtime: true, overtimeRounds: 6, playout: false },
  },
  {
    id: "official_noknife",
    title: "Oficial sem faca",
    tag: "LADO NO VETO",
    description: "MR12 com overtime MR3; o capitão B escolhe o lado.",
    rules: { maxRounds: 24, knifeRound: false, overtime: true, overtimeRounds: 6, playout: false },
  },
  {
    id: "quick",
    title: "Rápida",
    tag: "MR8",
    description: "16 rounds, sem faca e sem overtime. Ideal pra uma partida curta.",
    rules: { maxRounds: 16, knifeRound: false, overtime: false, overtimeRounds: 6, playout: false },
  },
  {
    id: "scrim",
    title: "Scrim",
    tag: "TREINO",
    description: "Joga todos os 24 rounds até o fim, sem overtime.",
    rules: { maxRounds: 24, knifeRound: false, overtime: false, overtimeRounds: 6, playout: true },
  },
  {
    id: "custom",
    title: "Personalizado",
    tag: "AVANÇADO",
    description: "Você define rounds, faca, overtime e playout.",
  },
];

export const presetById = (id: MatchPreset) => PRESETS.find((p) => p.id === id) ?? PRESETS[0]!;

export const describeRules = (rules: PresetRules) =>
  [
    `MR${rules.maxRounds / 2}`,
    rules.knifeRound ? "Faca" : "Sem faca",
    rules.overtime ? `OT MR${rules.overtimeRounds / 2}` : "Sem OT",
    rules.playout ? "Joga até o fim" : null,
  ].filter(Boolean).join(" · ");
