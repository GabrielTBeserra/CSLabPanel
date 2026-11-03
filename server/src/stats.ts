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

const bitCount = (mask: number) => {
  let count = 0;
  let x = mask;
  while (x) { count += x & 1; x >>= 1; }
  return count;
};

// Partitions players into "a"/"b" minimizing the ELO gap between teams.
// Exact search for lobbies up to 16 players (random pick among optimal splits,
// random side), greedy snake draft for larger groups.
export const balanceTeams = <T>(players: T[], eloOf: (p: T) => number): Map<T, "a" | "b"> => {
  const result = new Map<T, "a" | "b">();
  const n = players.length;
  if (n === 0) return result;
  if (n < 3) {
    players.forEach((p, i) => result.set(p, i % 2 === 0 ? "a" : "b"));
    return result;
  }
  const half = Math.floor(n / 2);
  const total = players.reduce((sum, p) => sum + eloOf(p), 0);

  let teamA: T[];
  if (n <= 16) {
    let bestDiff = Infinity;
    let best: number[] = [];
    for (let mask = 1; mask < 1 << n; mask += 1) {
      if (bitCount(mask) !== half) continue;
      let sum = 0;
      for (let i = 0; i < n; i += 1) if (mask & (1 << i)) sum += eloOf(players[i]!);
      const diff = Math.abs(total - 2 * sum);
      if (diff < bestDiff) { bestDiff = diff; best = [mask]; }
      else if (diff === bestDiff) best.push(mask);
    }
    const chosen = best[Math.floor(Math.random() * best.length)]!;
    const aIsMask = Math.random() < 0.5;
    teamA = players.filter((_, i) => (chosen & (1 << i)) !== 0 === aIsMask);
  } else {
    const cap = Math.ceil(n / 2);
    const a: T[] = []; const b: T[] = [];
    let sumA = 0; let sumB = 0;
    for (const p of [...players].sort((x, y) => eloOf(y) - eloOf(x))) {
      if ((a.length < cap && sumA <= sumB) || b.length >= cap) { a.push(p); sumA += eloOf(p); }
      else { b.push(p); sumB += eloOf(p); }
    }
    teamA = a;
  }

  const inA = new Set(teamA);
  for (const p of players) result.set(p, inA.has(p) ? "a" : "b");
  return result;
};
