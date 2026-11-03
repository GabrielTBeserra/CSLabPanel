import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { addTotals } from "../src/live.js";
import { eloChanges, levelFor, pickMvp } from "../src/stats.js";

const player = (steamId: string, team: "a" | "b", kills: number, deaths: number, damage: number) => ({
  steamId, name: steamId, team, kills, deaths, assists: 0, damage, headshotKills: 0,
});

describe("Stats and ELO", () => {
  it("maps ELO to FACEIT-like levels", () => {
    assert.deepEqual([levelFor(100), levelFor(1000), levelFor(1051), levelFor(2500)], [1, 4, 5, 10]);
  });

  it("gives winners points and losers the opposite, more for upsets", () => {
    const even = eloChanges([{ steamId: "1", team: "a", elo: 1000 }, { steamId: "2", team: "b", elo: 1000 }], "a");
    assert.deepEqual([even.get("1"), even.get("2")], [16, -16]);
    const upset = eloChanges([{ steamId: "1", team: "a", elo: 800 }, { steamId: "2", team: "b", elo: 1200 }], "a");
    assert.ok(upset.get("1")! > 16);
    assert.equal(eloChanges([{ steamId: "1", team: "a", elo: 1000 }], null).size, 0);
  });

  it("picks the MVP by kills, damage and deaths per round", () => {
    assert.equal(pickMvp([player("1", "a", 10, 20, 900), player("2", "b", 25, 10, 2500)], 24), "2");
    assert.equal(pickMvp([], 10), null);
  });

  it("sums per-map stats for series totals", () => {
    const totals = addTotals([player("1", "a", 10, 5, 800)], [player("1", "a", 7, 3, 600), player("2", "b", 4, 9, 300)]);
    assert.deepEqual(totals.map((p) => [p.steamId, p.kills, p.deaths, p.damage]), [["1", 17, 8, 1400], ["2", 4, 9, 300]]);
  });
});
