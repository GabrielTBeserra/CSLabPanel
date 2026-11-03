import type { LivePlayer } from "./database.js";

export const STARTING_ELO = 1000;
const K_FACTOR = 32;

const LEVEL_FLOORS = [0, 501, 751, 901, 1051, 1201, 1351, 1531, 1751, 2001];

export const levelFor = (elo: number) => {
  let level = 1;
  LEVEL_FLOORS.forEach((floor, i) => { if (elo >= floor) level = i + 1; });
  return level;
};

export interface EloInput {
  steamId: string;
  team: "a" | "b";
  elo: number;
}

export const eloChanges = (players: EloInput[], winner: "a" | "b" | null): Map<string, number> => {
  const changes = new Map<string, number>();
  if (!winner) return changes;
  const avg = (team: "a" | "b") => {
    const list = players.filter((p) => p.team === team);
    return list.length ? list.reduce((sum, p) => sum + p.elo, 0) / list.length : STARTING_ELO;
  };
  const ratingA = avg("a");
  const ratingB = avg("b");
  for (const player of players) {
    const own = player.team === "a" ? ratingA : ratingB;
    const other = player.team === "a" ? ratingB : ratingA;
    const expected = 1 / (1 + 10 ** ((other - own) / 400));
    const score = player.team === winner ? 1 : 0;
    changes.set(player.steamId, Math.round(K_FACTOR * (score - expected)) || (score ? 1 : -1));
  }
  return changes;
};

export const rating = (p: Pick<LivePlayer, "kills" | "deaths" | "assists" | "damage">, rounds: number) => {
  const r = Math.max(rounds, 1);
  return (p.kills / r) * 0.6 + (p.damage / r / 100) * 0.3 + (p.assists / r) * 0.15 - (p.deaths / r) * 0.25;
};

export const pickMvp = (players: LivePlayer[], rounds: number): string | null => {
  if (players.length === 0) return null;
  return [...players].sort((x, y) => rating(y, rounds) - rating(x, rounds))[0]!.steamId;
};

export const pickWorst = (players: LivePlayer[], rounds: number): string | null => {
  if (players.length < 2) return null;
  return [...players].sort((x, y) => rating(x, rounds) - rating(y, rounds))[0]!.steamId;
};
