import { describe, expect, it } from "vitest";
import { execute } from "./commands";
import {
  activeEffects,
  applyDamage,
  crewActions,
  effectiveStats,
  repairDamage,
  rollNotation,
  selectStationEffects,
} from "./rules";
import { crew as sampleCrew, ships as sampleShips } from "./sample-data";
import { commandSchema, librarySchema, validateFleet } from "./schema";
import { assembler, chunks } from "./transport";

const fixture = () => ({
  ships: structuredClone(sampleShips),
  crew: structuredClone(sampleCrew),
});
function state() {
  const { ships, crew } = fixture();
  return {
    shared: {
      version: 1 as const,
      sessionId: "scene",
      ownerId: "gm",
      controllerId: "gm-tab",
      revision: 0,
      ships: ships.filter((s) => s.kind === "Player"),
      crew: crew.filter((c) => c.ship === "kestrel"),
    },
    gm: {
      version: 1 as const,
      ships: ships.filter((s) => s.kind === "NPC"),
      crew: crew.filter((c) => c.ship !== "kestrel"),
      encounters: [],
      activeEncounterId: null,
    },
  };
}
describe("damage levels", () => {
  it("applies an empty level without adding an effect", () => {
    const p = fixture().ships[0].parts[1];
    expect(applyDamage(p)).toBe("applied");
    expect(p.damage).toBe(1);
    expect(p.applied).toEqual({});
  });
  it("selects a single effect automatically", () => {
    const p = fixture().ships[0].parts[2];
    expect(applyDamage(p)).toBe("applied");
    expect(p.applied).toEqual({ 1: "misaligned" });
  });
  it("does not mutate until one of multiple choices is selected", () => {
    const p = fixture().ships[0].parts[0];
    const before = structuredClone(p);
    expect(applyDamage(p)).toBe("choose");
    expect(p).toEqual(before);
    expect(() => applyDamage(p, "missing")).toThrow();
    expect(p).toEqual(before);
    expect(applyDamage(p, "drag")).toBe("applied");
    expect(p.applied[2]).toBe("drag");
  });
  it("repairs only the removed level, including levels without effects", () => {
    const p = fixture().ships[0].parts[0];
    applyDamage(p, "drag");
    applyDamage(p);
    repairDamage(p);
    expect(p.applied[2]).toBe("drag");
    repairDamage(p);
    expect(p.applied).toEqual({ 1: "scorched" });
    repairDamage(p);
    repairDamage(p);
    expect(p.damage).toBe(0);
  });
  it("stops at maximum damage", () => {
    const p = fixture().ships[0].parts[1];
    applyDamage(p);
    applyDamage(p);
    applyDamage(p);
    expect(applyDamage(p)).toBe("max");
    expect(p.damage).toBe(3);
  });
});
describe("station effects and modifiers", () => {
  it("adds stat deltas without mutating base values", () => {
    const { ships, crew } = fixture();
    const s = ships[0];
    selectStationEffects(
      s.stations[0],
      "flight-mode",
      ["evasive", "boost"],
      crew,
    );
    expect(effectiveStats(s)).toEqual({ ac: 14, maxG: 5, speed: 700 });
    expect(s.stats).toEqual({ ac: 15, maxG: 4, speed: 600 });
  });
  it("keeps effects after crew leave or are disabled and rejects changes until usable crew return", () => {
    const { ships, crew } = fixture();
    const s = ships[0],
      st = s.stations[0];
    selectStationEffects(st, "flight-mode", ["boost"], crew);
    st.seats = [null];
    expect(effectiveStats(s).speed).toBe(700);
    expect(() => selectStationEffects(st, "flight-mode", [], crew)).toThrow(
      /enabled/,
    );
    st.seats = ["mara"];
    crew[0].disabled = true;
    expect(() => selectStationEffects(st, "flight-mode", [], crew)).toThrow();
    crew[0].disabled = false;
    selectStationEffects(st, "flight-mode", [], crew);
    expect(effectiveStats(s).speed).toBe(600);
  });
  it("scopes station, roll type and combined rules separately", () => {
    const { ships, crew } = fixture();
    const s = ships[0],
      weapons = s.stations[1],
      gunner = crew[1];
    selectStationEffects(
      weapons,
      "target-mode",
      ["focus", "calibration"],
      crew,
    );
    const attack = { label: "Hit", type: "Attack", notation: "2d6" };
    expect(rollNotation(s, weapons, "Gunnery", attack, gunner)).toBe(
      "3d6kh2+5",
    );
    expect(
      rollNotation(
        s,
        weapons,
        "Gunnery",
        { ...attack, type: "Damage" },
        gunner,
      ),
    ).toBe("2d6+3");
    expect(rollNotation(s, s.stations[0], "Piloting", attack, crew[0])).toBe(
      "2d6+6",
    );
    applyDamage(s.parts[2]);
    expect(
      rollNotation(
        s,
        weapons,
        "Gunnery",
        { ...attack, type: "Damage" },
        gunner,
      ),
    ).toBe("2d6+2");
  });
  it("cancels advantage and disadvantage one-for-one, including multiple sources", () => {
    const { ships, crew } = fixture();
    const s = ships[0],
      w = s.stations[1];
    selectStationEffects(w, "target-mode", ["focus"], crew);
    selectStationEffects(s.stations[0], "flight-mode", ["evasive"], crew);
    const r = { label: "Hit", type: "Attack", notation: "2d6" };
    expect(rollNotation(s, w, "Gunnery", r, crew[1])).toBe("2d6+3");
    selectStationEffects(
      s.stations[0],
      "flight-mode",
      ["evasive", "boost"],
      crew,
    );
    expect(rollNotation(s, w, "Gunnery", r, crew[1])).toBe("3d6kl2+3");
  });
  it("combines damage and station effects and removes the repaired source", () => {
    const { ships, crew } = fixture();
    const s = ships[0];
    applyDamage(s.parts[0], "drag");
    expect(effectiveStats(s).speed).toBe(550);
    selectStationEffects(s.stations[0], "flight-mode", ["boost"], crew);
    expect(effectiveStats(s).speed).toBe(650);
    repairDamage(s.parts[0]);
    expect(effectiveStats(s).speed).toBe(700);
    expect(activeEffects(s).some((e) => e.effect.id === "boost")).toBe(true);
  });
});
describe("shared commands", () => {
  it("rejects NPC mutations and GM commands from players", () => {
    const s = state();
    expect(() =>
      execute(s, { op: "repair", shipId: "shrike", part: 0 }, false),
    ).toThrow(/Players/);
    expect(() => execute(s, { op: "pause" }, false)).toThrow(/GM/);
  });
  it("detects conflicting seat moves against the latest accepted state", () => {
    const s = state();
    const move = {
      op: "move" as const,
      shipId: "kestrel",
      stationId: "weapons",
      seat: 1,
      crewId: "mara",
    };
    const first = execute(s, move, false);
    expect(() =>
      execute(first.state, { ...move, crewId: "sol" }, false),
    ).toThrow(/occupied/);
    expect(s.shared.ships[0].stations[0].seats[0]).toBe("mara");
    expect(first.state.shared.revision).toBe(1);
  });
  it("rejects a damage choice prepared against a stale level", () => {
    const current = state();
    const command = {
      op: "damage" as const,
      shipId: "kestrel",
      part: 0,
      from: 1,
      choice: "drag",
    };
    const first = execute(current, command, false);
    expect(() => execute(first.state, command, false)).toThrow(
      /Damage changed/,
    );
    expect(first.state.shared.ships[0].parts[0].damage).toBe(2);
  });
  it("moves player crew across ships while preserving a single seat and constraining NPC crew", () => {
    const s = state();
    const shuttle = structuredClone(s.shared.ships[0]);
    shuttle.id = "shuttle";
    shuttle.name = "Shuttle";
    for (const station of shuttle.stations)
      station.seats = station.seats.map(() => null);
    const imported = execute(
      s,
      { op: "import", library: { version: 1, ships: [shuttle] } },
      true,
    );
    const moved = execute(
      imported.state,
      {
        op: "move",
        shipId: "shuttle",
        stationId: "helm",
        seat: 0,
        crewId: "mara",
      },
      false,
    );
    expect(moved.state.shared.ships[0].stations[0].seats[0]).toBeNull();
    expect(
      moved.state.shared.ships.find((ship) => ship.id === "shuttle")
        ?.stations[0].seats[0],
    ).toBe("mara");
    expect(() =>
      execute(
        s,
        {
          op: "move",
          shipId: "warden",
          stationId: "helm",
          seat: 0,
          crewId: "raider",
        },
        true,
      ),
    ).toThrow(/NPC crew/);
  });
  it("makes imported crew-specific actions available only at their designated station", () => {
    const { ships, crew } = fixture();
    crew[0].stationActions.helm.push({
      id: "custom",
      kind: "utility",
      name: "Custom maneuver",
      description: "A **custom** action.",
    });
    expect(
      crewActions(ships[0].stations[0], crew[0]).some((a) => a.id === "custom"),
    ).toBe(true);
    expect(
      crewActions(ships[0].stations[1], crew[0]).some((a) => a.id === "custom"),
    ).toBe(false);
  });
  it("keeps NPC state out of the shared payload", () => {
    const result = execute(
      state(),
      { op: "damage", shipId: "shrike", part: 1, from: 0 },
      true,
    );
    expect(result.publicChanged).toBe(false);
    expect(result.gmChanged).toBe(true);
    expect(result.state.shared.ships.map((s) => s.id)).toEqual(["kestrel"]);
  });
  it("prepares private GM and public player rolls with separate multi-roll labels", () => {
    const s = state();
    const cmd = {
      op: "roll" as const,
      shipId: "kestrel",
      stationId: "weapons",
      crewId: "ivo",
      actionId: "fire",
    };
    expect(execute(s, cmd, true).roll).toEqual({
      notation: "2d6+3#Hit, 1d6+3#Damage",
      target: "gm_only",
    });
    expect(execute(s, cmd, false).roll?.target).toBe("everyone");
  });
  it("requires seated enabled crew to roll", () => {
    const cmd = {
      op: "roll" as const,
      shipId: "kestrel",
      stationId: "engineering",
      crewId: "sol",
      actionId: "repair",
    };
    expect(() => execute(state(), cmd, false)).toThrow(/enabled/);
  });
  it("validates imports atomically and preserves the previous state on error", () => {
    const s = state(),
      before = structuredClone(s);
    const ship = structuredClone(s.shared.ships[0]);
    ship.stations[0].seats = ["missing"];
    expect(() =>
      execute(
        s,
        { op: "import", library: { version: 1, ships: [ship] } },
        true,
      ),
    ).toThrow(/assignment/);
    expect(s).toEqual(before);
  });
  it("accepts validated full library round trips", () => {
    const s = state();
    const library = librarySchema.parse({
      version: 1,
      ships: [...s.shared.ships, ...s.gm.ships],
      crew: [...s.shared.crew, ...s.gm.crew],
    });
    expect(() => execute(s, { op: "import", library }, true)).not.toThrow();
    validateFleet(library.ships!, library.crew!);
  });
  it("rejects malformed commands before mutation", () => {
    expect(
      commandSchema.safeParse({
        op: "effects",
        shipId: "kestrel",
        stationId: "helm",
        actionId: "flight-mode",
        choices: "boost",
      }).success,
    ).toBe(false);
  });
});
describe("broadcast transport", () => {
  it("reassembles escaped Unicode out of order under 16 KB per message", () => {
    const payload = { description: '😀\\"'.repeat(7000) };
    const pieces = chunks(crypto.randomUUID(), payload);
    expect(
      pieces.every(
        (p) => new TextEncoder().encode(JSON.stringify(p)).length < 16000,
      ),
    ).toBe(true);
    const assemble = assembler();
    let result: ReturnType<typeof assemble>;
    for (const p of pieces.reverse()) result = assemble("sender", p) ?? result;
    expect(result?.value).toEqual(payload);
  });
  it("does not combine chunks from different players", () => {
    const parts = chunks(crypto.randomUUID(), { data: "a".repeat(2000) });
    const assemble = assembler();
    expect(assemble("one", parts[0])).toBeUndefined();
    expect(assemble("two", parts[1])).toBeUndefined();
    expect(assemble("one", parts[1])?.value).toEqual({
      data: "a".repeat(2000),
    });
  });
});
