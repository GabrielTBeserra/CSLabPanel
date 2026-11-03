import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveMatchInput, vetoSteps } from "../src/app.js";
import type { MatchPlayerRecord, MatchRecord, VetoRecord } from "../src/database.js";
import { applyMatchzyEvent, buildMatchzyConfig } from "../src/live.js";

const match = {
  id: "m1", name: "Mix", mapName: "de_mirage", teamAName: "Alpha", teamBName: "Bravo", maxRounds: 24,
  format: "bo1", mapPool: [], phase: "live", captainAId: null, captainBId: null, sideChoice: "b",
  status: "scheduled", createdBy: null, createdAt: "", updatedAt: "", matchNumber: 42, knifeRound: false,
  serverState: "idle", serverError: null, live: {},
  preset: "custom", overtime: true, overtimeRounds: 6, playout: false,
} as MatchRecord;

const player = (steamId: string, team: "a" | "b"): MatchPlayerRecord => ({
  userId: steamId, steamId, displayName: `P${steamId.slice(-1)}`, avatarUrl: null, team, joinedAt: "",
});

const veto = (seq: number, action: "ban" | "pick", mapName: string, actorName = "x"): VetoRecord => ({
  id: String(seq), matchId: "m1", seq, action, mapName, team: "a", actorSteamId: "1", actorName, createdAt: "",
});

describe("MatchZy integration", () => {
  it("builds a match config with locked rosters, picked map, side and event webhook", () => {
    const config = buildMatchzyConfig(
      match,
      [player("76561198000000001", "a"), player("76561198000000002", "b"), player("76561198000000003", "b")],
      [veto(1, "ban", "de_nuke"), veto(2, "pick", "de_inferno", "Decider")],
      { eventsUrl: "http://api/api/plugin/events", pluginToken: "tok" },
    );
    assert.equal(config.matchid, 42);
    assert.deepEqual(config.maplist, ["de_inferno"]);
    assert.deepEqual(config.map_sides, ["team2_ct"]);
    assert.deepEqual(Object.keys(config.team1.players), ["76561198000000001"]);
    assert.deepEqual(Object.keys(config.team2.players), ["76561198000000002", "76561198000000003"]);
    assert.equal(config.players_per_team, 2);
    assert.equal(config.cvars.matchzy_remote_log_header_value, "Bearer tok");
    assert.equal(config.cvars.mp_maxrounds, "24");
  });

  it("uses a knife round on every map when enabled", () => {
    const config = buildMatchzyConfig({ ...match, knifeRound: true }, [], [veto(1, "pick", "de_mirage", "Decider")], { eventsUrl: "u", pluginToken: "t" });
    assert.deepEqual(config.map_sides, ["knife"]);
  });

  it("tracks state, score and kill feed from MatchZy events", () => {
    const team = (id: string) => (id === "1" ? "a" : "b");
    let r = applyMatchzyEvent({}, "loading", { event: "series_start", matchid: 42 }, team);
    assert.equal(r.state, "warmup");
    r = applyMatchzyEvent(r.live, r.state, { event: "going_live", matchid: 42, map_number: 0 }, team);
    assert.equal(r.state, "live");
    r = applyMatchzyEvent(r.live, r.state, {
      event: "player_death", round_number: 1, headshot: true, weapon: { name: "ak47" },
      player: { steamid: "2", name: "Vic" }, attacker: { steamid: "1", name: "Atk" },
    }, team);
    assert.deepEqual([r.live.feed?.[0]?.attacker, r.live.feed?.[0]?.attackerTeam, r.live.feed?.[0]?.headshot], ["Atk", "a", true]);
    r = applyMatchzyEvent(r.live, r.state, {
      event: "round_end", round_number: 1,
      team1: { score: 1, series_score: 0, players: [{ steamid: "1", name: "Atk", stats: { kills: 1, deaths: 0, damage: 100 } }] },
      team2: { score: 0, series_score: 0, players: [] },
    }, team);
    assert.deepEqual([r.live.scoreA, r.live.scoreB, r.live.players?.[0]?.kills], [1, 0, 1]);
    r = applyMatchzyEvent(r.live, r.state, { event: "game_paused" }, team);
    assert.equal(r.state, "paused");
    r = applyMatchzyEvent(r.live, r.state, { event: "series_end", team1_series_score: 1, team2_series_score: 0, winner: { team: "team1" } }, team);
    assert.deepEqual([r.state, r.live.winner, r.seriesFinished], ["finished", "a", true]);
  });

  it("enforces preset rules on the server and keeps custom values", () => {
    const base = { name: "x", mapName: "de_mirage", teamAName: "A", teamBName: "B", maxRounds: 30, knifeRound: false };
    const official = resolveMatchInput({ ...base, preset: "official", overtime: false });
    assert.deepEqual(
      [official.maxRounds, official.knifeRound, official.overtime, official.overtimeRounds, official.playout],
      [24, true, true, 6, false],
    );
    assert.equal(resolveMatchInput({ ...base, preset: "quick" }).maxRounds, 16);
    assert.equal(resolveMatchInput({ ...base, preset: "scrim" }).playout, true);
    assert.equal(resolveMatchInput({ ...base, preset: "custom" }).maxRounds, 30);
  });

  it("sends overtime and playout cvars to MatchZy", () => {
    const config = buildMatchzyConfig({ ...match, overtime: false, playout: true }, [], [], { eventsUrl: "u", pluginToken: "t" });
    assert.equal(config.cvars.mp_overtime_enable, "0");
    assert.equal(config.cvars.matchzy_playout_enabled_default, "true");
  });

  it("generates veto steps that always leave exactly one decider", () => {
    for (const size of [3, 4, 7, 10]) {
      assert.equal(vetoSteps("bo1", size).length, size - 1);
      assert.equal(vetoSteps("bo3", size).filter((s) => s.action === "pick").length, 2);
      assert.equal(vetoSteps("bo3", size).length, size - 1);
    }
    assert.deepEqual(vetoSteps("bo3", 7).map((s) => s.action), ["ban", "ban", "pick", "pick", "ban", "ban"]);
  });
});
