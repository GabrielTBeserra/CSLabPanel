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
    },
  };
};

type Json = Record<string, unknown>;

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
    };
  });

const MAX_FEED = 12;

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
      Object.assign(next, { round: 0, scoreA: 0, scoreB: 0, seriesA: 0, seriesB: 0, maps: [], feed: [], players: [], winner: null });
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
