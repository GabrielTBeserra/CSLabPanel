import type { LiveKill, LivePlayer, LiveState, MatchPlayerRecord, MatchRecord, ServerState, VetoRecord } from "./database.js";

export interface MatchzyConfigOptions {
  eventsUrl: string;
  pluginToken: string;
}

export const seriesMaps = (match: MatchRecord, vetoes: VetoRecord[]) =>
  vetoes.filter((v) => v.action === "pick" && v.mapName).sort((a, b) => a.seq - b.seq).map((v) => v.mapName!);

export const buildMatchzyConfig = (
  match: MatchRecord,
  players: MatchPlayerRecord[],
  vetoes: VetoRecord[],
  { eventsUrl, pluginToken }: MatchzyConfigOptions,
) => {
  const maps = seriesMaps(match, vetoes);
  const numMaps = match.format === "bo3" ? 3 : 1;
  const roster = (team: "a" | "b") =>
    Object.fromEntries(players.filter((p) => p.team === team).map((p) => [p.steamId, p.displayName]));
  const sizeA = players.filter((p) => p.team === "a").length;
  const sizeB = players.filter((p) => p.team === "b").length;
  const firstSide = match.sideChoice === "b" ? "team2_ct" : "team1_ct";
  const mapSides = maps.map((_, i) =>
    match.knifeRound ? "knife" : i === 0 ? firstSide : i === 1 ? (firstSide === "team1_ct" ? "team2_ct" : "team1_ct") : "knife",
  );

  return {
    matchid: match.matchNumber,
    num_maps: numMaps,
    maplist: maps.slice(0, numMaps),
    map_sides: mapSides.slice(0, numMaps),
    skip_veto: true,
    clinch_series: true,
    players_per_team: Math.max(sizeA, sizeB, 1),
    min_players_to_ready: Math.max(Math.min(sizeA, sizeB), 1),
    team1: { id: "a", name: match.teamAName, players: roster("a") },
    team2: { id: "b", name: match.teamBName, players: roster("b") },
    cvars: {
      matchzy_remote_log_url: eventsUrl,
      matchzy_remote_log_header_key: "Authorization",
      matchzy_remote_log_header_value: `Bearer ${pluginToken}`,
      mp_maxrounds: String(match.maxRounds),
      mp_overtime_enable: match.overtime ? "1" : "0",
      mp_overtime_maxrounds: String(match.overtimeRounds),
      mp_overtime_startmoney: "12500",
      matchzy_playout_enabled_default: match.playout ? "true" : "false",
    },
  };
};

type Json = Record<string, unknown>;

export interface ConnectedPlayer {
  steamId: string;
  name: string;
}

export const parseStatusJson = (text: string): ConnectedPlayer[] | null => {
  const start = text.indexOf("{");
  if (start < 0) return null;
  try {
    const parsed = JSON.parse(text.slice(start)) as { server?: { clients?: unknown[] } };
    const clients = Array.isArray(parsed.server?.clients) ? parsed.server.clients : [];
    const seen = new Set<string>();
    return clients.flatMap((raw) => {
      const c = (raw ?? {}) as Json;
      const steamId = String(c.steamid64 ?? "");
      if (c.bot === true || !/^[0-9]{17}$/.test(steamId) || seen.has(steamId)) return [];
      seen.add(steamId);
      return [{ steamId, name: String(c.name ?? "").slice(0, 64) || `Jogador ${steamId.slice(-4)}` }];
    });
  } catch {
    return null;
  }
};

const teamOf = (value: unknown): "a" | "b" | null => (value === "team1" ? "a" : value === "team2" ? "b" : null);
const num = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : 0);
const obj = (value: unknown): Json => (value && typeof value === "object" ? (value as Json) : {});

const playersFrom = (teamStats: Json, team: "a" | "b"): LivePlayer[] =>
  (Array.isArray(teamStats.players) ? teamStats.players : []).map((raw) => {
    const p = obj(raw);
    const s = obj(p.stats);
    return {
      steamId: String(p.steamid ?? ""), name: String(p.name ?? "?"), team,
      kills: num(s.kills), deaths: num(s.deaths), assists: num(s.assists), damage: num(s.damage), headshotKills: num(s.headshot_kills),
      utilityDamage: num(s.utility_damage), enemiesFlashed: num(s.enemies_flashed), friendliesFlashed: num(s.friendlies_flashed),
      flashAssists: num(s.flash_assists), teamKills: num(s.team_kills), suicides: num(s.suicides), knifeKills: num(s.knife_kills),
      roundsPlayed: num(s.rounds_played), bombPlants: num(s.bomb_plants), bombDefuses: num(s.bomb_defuses),
      kills1: num(s["1k"]), kills2: num(s["2k"]), kills3: num(s["3k"]), kills4: num(s["4k"]), kills5: num(s["5k"]),
      oneV1: num(s["1v1"]), oneV2: num(s["1v2"]), oneV3: num(s["1v3"]), oneV4: num(s["1v4"]), oneV5: num(s["1v5"]),
      firstKills: num(s.first_kills_t) + num(s.first_kills_ct), firstDeaths: num(s.first_deaths_t) + num(s.first_deaths_ct),
      tradeKills: num(s.trade_kills), kast: num(s.kast), score: num(s.score), mvps: num(s.mvp),
    };
  });

const MAX_FEED = 12;

export const addTotals = (totals: LivePlayer[], players: LivePlayer[]): LivePlayer[] => {
  const merged = new Map(totals.map((p) => [p.steamId, { ...p }]));
  for (const p of players) {
    const current = merged.get(p.steamId);
    if (!current) merged.set(p.steamId, { ...p });
    else {
      const rounds = current.roundsPlayed + p.roundsPlayed;
      Object.assign(current, {
        name: p.name, team: p.team, kills: current.kills + p.kills, deaths: current.deaths + p.deaths,
        assists: current.assists + p.assists, damage: current.damage + p.damage, headshotKills: current.headshotKills + p.headshotKills,
        utilityDamage: current.utilityDamage + p.utilityDamage, enemiesFlashed: current.enemiesFlashed + p.enemiesFlashed,
        friendliesFlashed: current.friendliesFlashed + p.friendliesFlashed, flashAssists: current.flashAssists + p.flashAssists,
        teamKills: current.teamKills + p.teamKills, suicides: current.suicides + p.suicides, knifeKills: current.knifeKills + p.knifeKills,
        roundsPlayed: rounds, bombPlants: current.bombPlants + p.bombPlants, bombDefuses: current.bombDefuses + p.bombDefuses,
        kills1: current.kills1 + p.kills1, kills2: current.kills2 + p.kills2, kills3: current.kills3 + p.kills3,
        kills4: current.kills4 + p.kills4, kills5: current.kills5 + p.kills5,
        oneV1: current.oneV1 + p.oneV1, oneV2: current.oneV2 + p.oneV2, oneV3: current.oneV3 + p.oneV3,
        oneV4: current.oneV4 + p.oneV4, oneV5: current.oneV5 + p.oneV5,
        firstKills: current.firstKills + p.firstKills, firstDeaths: current.firstDeaths + p.firstDeaths,
        tradeKills: current.tradeKills + p.tradeKills,
        kast: rounds > 0 ? Math.round((current.kast * current.roundsPlayed + p.kast * p.roundsPlayed) / rounds) : 0,
        score: current.score + p.score, mvps: current.mvps + p.mvps,
      });
    }
  }
  return [...merged.values()];
};

export const applyMatchzyEvent = (
  live: LiveState,
  state: ServerState,
  event: Json,
  rosterTeam: (steamId: string) => "a" | "b" | null,
): { live: LiveState; state: ServerState; seriesFinished: boolean } => {
  const next: LiveState = { ...live, updatedAt: new Date().toISOString() };
  let nextState = state;
  let seriesFinished = false;
  const mapNumber = typeof event.map_number === "number" ? event.map_number : undefined;
  if (mapNumber !== undefined) next.mapNumber = mapNumber;

  switch (event.event) {
    case "series_start":
      nextState = "warmup";
      Object.assign(next, { round: 0, scoreA: 0, scoreB: 0, seriesA: 0, seriesB: 0, maps: [], feed: [], players: [], totals: [], winner: null });
      break;
    case "going_live":
      nextState = "live";
      Object.assign(next, { round: 0, scoreA: 0, scoreB: 0, feed: [], paused: false });
      break;
    case "round_start":
      next.round = num(event.round_number);
      break;
    case "round_end":
    case "map_result": {
      const t1 = obj(event.team1);
      const t2 = obj(event.team2);
      next.scoreA = num(t1.score);
      next.scoreB = num(t2.score);
      next.seriesA = num(t1.series_score);
      next.seriesB = num(t2.series_score);
      const players = [...playersFrom(t1, "a"), ...playersFrom(t2, "b")];
      if (players.length > 0) next.players = players;
      if (event.event === "round_end") {
        next.round = num(event.round_number);
        if (nextState !== "paused") nextState = "live";
      } else {
        const winner = teamOf(obj(event.winner).team);
        next.totals = addTotals(live.totals ?? [], live.players ?? []);
        next.maps = [...(live.maps ?? []), { mapName: next.mapName ?? "", scoreA: next.scoreA, scoreB: next.scoreB, winner }];
        nextState = "map_end";
      }
      break;
    }
    case "player_death": {
      const victim = obj(event.player);
      const attacker = event.attacker ? obj(event.attacker) : null;
      const kill: LiveKill = {
        round: num(event.round_number),
        attacker: attacker ? String(attacker.name ?? "?") : null,
        attackerTeam: attacker ? rosterTeam(String(attacker.steamid ?? "")) : null,
        victim: String(victim.name ?? "?"),
        victimTeam: rosterTeam(String(victim.steamid ?? "")),
        weapon: String(obj(event.weapon).name ?? ""),
        headshot: event.headshot === true,
        at: next.updatedAt!,
      };
      next.feed = [kill, ...(live.feed ?? [])].slice(0, MAX_FEED);
      break;
    }
    case "game_paused":
      next.paused = true;
      nextState = "paused";
      break;
    case "game_unpaused":
      next.paused = false;
      nextState = "live";
      break;
    case "series_end":
      next.seriesA = num(event.team1_series_score);
      next.seriesB = num(event.team2_series_score);
      next.winner = teamOf(obj(event.winner).team);
      nextState = "finished";
      seriesFinished = true;
      break;
    default:
      break;
  }
  return { live: next, state: nextState, seriesFinished };
};
