import { describe, expect, it } from "vitest";
import { execute, type State } from "./commands";
import {
  actionRolls,
  activeEffects,
  ammunitionAvailable,
  applyDamage,
  baseCategory,
  categoryDie,
  cooldownBlocked,
  cooldownDurations,
  cooldownSlots,
  crewActions,
  damageCategory,
  effectiveStats,
  effectTone,
  initiativeActors,
  missingEffects,
  randomInitiative,
  repairDamage,
  rollBlockers,
  rollNotation,
  selectStationEffects,
  startCooldown,
  tickCooldowns,
} from "./rules";
import { crew as sampleCrew, ships as sampleShips } from "./sample-data";
import {
  commandSchema,
  librarySchema,
  publicSchema,
  validateFleet,
} from "./schema";
import { assembler, chunks } from "./transport";

const fixture = () => {
  const ships = structuredClone(sampleShips);
  ships[0].stations[1].actions[0].cooldown = 2;
  return { ships, crew: structuredClone(sampleCrew) };
};
function state(): State {
  const { ships, crew } = fixture();
  return {
    shared: {
      version: 1 as const,
      sessionId: "scene",
      ownerId: "gm",
      controllerId: "gm-tab",
      revision: 0,
      round: 1,
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
      notation: "2d6+3#Hit, 1d6#Damage",
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

const fire = {
  op: "roll" as const,
  shipId: "kestrel",
  stationId: "weapons",
  crewId: "ivo",
  actionId: "fire",
  rollIndex: 0,
};
function encounterState() {
  const s = state();
  s.gm.encounters = [
    {
      id: "test",
      name: "Test",
      shipIds: ["kestrel", "shrike", "warden"],
      round: 1,
      turn: 0,
      currentCrewId: null,
      running: true,
    },
  ];
  s.gm.activeEncounterId = "test";
  return s;
}
describe("cooldowns and split rolls", () => {
  it("previews without charging and shares an action cooldown between seats", () => {
    const s = state();
    s.shared.ships[0].stations[1].seats.push("mara");
    s.shared.ships[0].stations[0].seats = [null];
    expect(
      execute(s, { ...fire, op: "roll-preview" }, false).publicChanged,
    ).toBe(false);
    const charged = execute(s, fire, false).state;
    expect(charged.shared.ships[0].stations[1].cooldowns?.fire).toEqual([2]);
    expect(() => execute(charged, { ...fire, crewId: "mara" }, false)).toThrow(
      /cooldown/,
    );
    const effect = execute(
      charged,
      { ...fire, crewId: "mara", rollIndex: 1 },
      false,
    );
    expect(effect.roll?.notation).toBe("1d6#Damage");
    expect(effect.publicChanged).toBe(false);
    expect(s.shared.ships[0].stations[1].cooldowns?.fire).toBeUndefined();
  });
  it("ignores automatic advantage and crew modifiers on effect rolls but retains effect numerical modifiers", () => {
    const { ships, crew } = fixture();
    const s = ships[0],
      st = s.stations[1];
    applyDamage(s.parts[2]);
    selectStationEffects(s.stations[0], "flight-mode", ["boost"], crew);
    const action = st.actions.find((a) => a.id === "fire")!;
    const [hit, effect] = actionRolls(action);
    expect(rollNotation(s, st, "Gunnery", hit, crew[1])).toBe("3d6kl2+2");
    expect(rollNotation(s, st, "Gunnery", effect, crew[1])).toBe("1d6-1");
    expect(rollNotation(s, st, "Gunnery", hit, crew[1], "normal")).toBe(
      "2d6+2",
    );
    expect(rollNotation(s, st, "Gunnery", hit, crew[1], "advantage")).toBe(
      "3d6kh2+2",
    );
    expect(rollNotation(s, st, "Gunnery", hit, crew[1], "disadvantage")).toBe(
      "3d6kl2+2",
    );
  });
  it("combines scoped cooldown adjustments, clamps to zero, and fixes duration at activation", () => {
    const s = state(),
      ship = s.shared.ships[0],
      st = ship.stations[1];
    selectStationEffects(
      ship.stations[0],
      "flight-mode",
      ["boost"],
      s.shared.crew,
    );
    selectStationEffects(st, "target-mode", ["calibration"], s.shared.crew);
    expect(cooldownDurations(ship, st, st.actions[0])).toEqual([2]);
    expect(
      cooldownDurations(ship, ship.stations[0], ship.stations[0].actions[0]),
    ).toEqual([]);
    const next = execute(s, fire, false).state;
    selectStationEffects(
      next.shared.ships[0].stations[0],
      "flight-mode",
      [],
      next.shared.crew,
    );
    expect(next.shared.ships[0].stations[1].cooldowns?.fire).toEqual([2]);
    st.actions[0].cooldown = 0;
    selectStationEffects(ship.stations[0], "flight-mode", [], s.shared.crew);
    expect(cooldownDurations(ship, st, st.actions[0])).toEqual([0]);
  });
  it("forces disabled rolls while preserving seating and private/public audiences", () => {
    const s = execute(state(), fire, false).state;
    s.shared.crew.find((c) => c.id === "ivo")!.disabled = true;
    expect(() => execute(s, fire, false)).toThrow(/enabled/);
    expect(execute(s, { ...fire, override: "advantage" }, true).roll).toEqual({
      notation: "3d6kh2+3#Hit",
      target: "gm_only",
    });
    expect(
      execute(s, { ...fire, override: "normal" }, false).roll?.target,
    ).toBe("everyone");
    expect(() =>
      execute(s, { ...fire, crewId: "mara", override: "normal" }, false),
    ).toThrow(/occupy/);
    expect(() =>
      execute(s, { ...fire, shipId: "shrike", override: "normal" }, false),
    ).toThrow(/player ships/);
  });
  it("rejects stale validated notations before starting cooldown", () => {
    const s = state();
    expect(() =>
      execute(s, { ...fire, expectedNotation: "old" }, false),
    ).toThrow(/Effects changed/);
    expect(s.shared.ships[0].stations[1].cooldowns).toBeUndefined();
  });
});
describe("crew initiative and rounds", () => {
  it("rolls only encounter NPC crew with RNG and leaves player initiative unchanged", () => {
    const s = encounterState();
    let count = 0;
    const result = execute(
      s,
      { op: "roll-all-initiatives" },
      true,
      () => ++count,
    );
    expect(count).toBe(2);
    expect(result.state.shared.crew.every((c) => c.initiative == null)).toBe(
      true,
    );
    s.shared.crew[0].initiative = 77;
    s.shared.crew[0].initiativeToken = "pending-player";
    const rerolled = execute(
      s,
      { op: "roll-all-initiatives" },
      true,
      () => 8,
    ).state;
    expect(rerolled.shared.crew[0].initiative).toBe(77);
    expect(rerolled.shared.crew[0].initiativeToken).toBe("pending-player");
    expect(result.roll).toBeUndefined();
    const actors = initiativeActors(
      [...result.state.shared.ships, ...result.state.gm.ships],
      [...result.state.shared.crew, ...result.state.gm.crew],
      s.gm.encounters[0].shipIds,
    );
    expect(actors.map((a) => a.crew.initiative)).toEqual([2, 1]);
    expect(result.state.gm.encounters[0].currentCrewId).toBe(actors[0].crew.id);
    expect(() => execute(s, { op: "roll-all-initiatives" }, false)).toThrow(
      /Only the GM/,
    );
  });
  it("populates initiative only from the latest individual result", () => {
    const s = encounterState();
    expect(
      initiativeActors(s.shared.ships, s.shared.crew, ["kestrel"]),
    ).toHaveLength(0);
    const pending = execute(
      s,
      { op: "initiative-roll", crewId: "mara" },
      false,
    );
    expect(pending.roll?.target).toBe("everyone");
    const newer = execute(
      pending.state,
      { op: "initiative-roll", crewId: "mara" },
      true,
    );
    expect(newer.roll?.target).toBe("gm_only");
    expect(() =>
      execute(
        newer.state,
        {
          op: "initiative-result",
          crewId: "mara",
          token: pending.roll!.initiativeToken!,
          value: 12,
        },
        false,
      ),
    ).toThrow(/newer/);
    const result = execute(
      newer.state,
      {
        op: "initiative-result",
        crewId: "mara",
        token: newer.roll!.initiativeToken!,
        value: 12,
      },
      true,
    ).state;
    expect(
      initiativeActors(result.shared.ships, result.shared.crew, ["kestrel"])[0]
        .crew.initiative,
    ).toBe(12);
  });
  it("ticks all encounter stations once at the start of a round, including empty stations", () => {
    const started = encounterState();
    started.shared.crew.forEach((c) => {
      c.initiative = 12;
    });
    let s = execute(
      started,
      { op: "roll-all-initiatives" },
      true,
      () => 12,
    ).state;
    s = execute(s, fire, false).state;
    s.shared.ships[0].stations[1].seats = [null, null];
    for (let i = 0; i < 4; i++) s = execute(s, { op: "next" }, true).state;
    expect(s.shared.round).toBe(1);
    expect(s.shared.ships[0].stations[1].cooldowns?.fire).toEqual([2]);
    s = execute(s, { op: "next" }, true).state;
    expect(s.shared.round).toBe(2);
    expect(s.shared.ships[0].stations[1].cooldowns?.fire).toEqual([1]);
    s = execute(s, { op: "next-round" }, true).state;
    expect(s.shared.round).toBe(3);
    expect(s.shared.ships[0].stations[1].cooldowns?.fire).toBeUndefined();
    s = execute(s, { op: "pause" }, true).state;
    expect(() => execute(s, { op: "next-round" }, true)).toThrow(/Resume/);
  });
  it("tracks player crew on their current ship after moving, including unseated crew by home ship", () => {
    const { ships, crew } = fixture();
    const extra = structuredClone(ships[0]);
    extra.id = "extra";
    extra.stations.forEach((st) => {
      st.seats.fill(null);
    });
    ships[0].stations[0].seats = [null];
    extra.stations[0].seats = ["mara"];
    expect(
      initiativeActors([...ships, extra], crew, ["extra"], false).map(
        (a) => a.crew.id,
      ),
    ).toEqual(["mara"]);
    extra.stations[0].seats = [null];
    expect(
      initiativeActors([...ships, extra], crew, ["kestrel"], false).map(
        (a) => a.crew.id,
      ),
    ).toContain("mara");
  });
  it("evaluates bounded initiative pools with additive modifiers", () => {
    expect(randomInitiative("2d6+3", () => 4)).toBe(11);
    expect(randomInitiative("1d20-2", () => 1)).toBe(-1);
    expect(() => randomInitiative("1d20kh1")).toThrow();
  });
  it("migrates old scene data without resetting damage, seats or effects", () => {
    const old = state().shared;
    delete (old as Partial<typeof old>).round;
    old.crew.forEach((c) => {
      delete c.initiativeRoll;
      delete c.initiative;
    });
    const restored = publicSchema.parse(old);
    expect(restored.round).toBe(1);
    expect(restored.crew[0].initiativeRoll).toBe("1d20");
    expect(restored.crew[0].initiative).toBeNull();
    expect(restored.ships[0].parts).toEqual(
      old.ships[0].parts.map((part) => ({
        ...part,
        levels: part.levels.map((options) =>
          options.map((effect) => ({
            ...effect,
            type: effect.type ?? "General",
          })),
        ),
      })),
    );
    expect(restored.ships[0].stations[1].seats).toEqual(
      old.ships[0].stations[1].seats,
    );
    expect(restored.ships[0].stations[1].cooldowns).toEqual({});
    expect(
      actionRolls(restored.ships[0].stations[1].actions[0]).map((r) => r.kind),
    ).toEqual(["hitRoll", "effectRoll"]);
  });
});

describe("independent cooldown slots", () => {
  it("uses the shortest ready duration, blocks only when every slot is busy and ticks both", () => {
    let s = encounterState();
    s.shared.ships[0].stations[1].actions[0].cooldown = [3, 2];
    s = execute(s, fire, false).state;
    const ship = s.shared.ships[0],
      st = ship.stations[1];
    expect(st.cooldowns?.fire).toEqual([0, 2]);
    expect(cooldownBlocked(ship, st, st.actions[0])).toBe(false);
    s = execute(s, fire, false).state;
    expect(s.shared.ships[0].stations[1].cooldowns?.fire).toEqual([3, 2]);
    expect(() => execute(s, fire, false)).toThrow(/cooldown/);
    expect(execute(s, { ...fire, rollIndex: 1 }, false).publicChanged).toBe(
      false,
    );
    s = execute(s, { op: "next-round" }, true).state;
    expect(s.shared.ships[0].stations[1].cooldowns?.fire).toEqual([2, 1]);
    s = execute(s, { op: "next-round" }, true).state;
    expect(s.shared.ships[0].stations[1].cooldowns?.fire).toEqual([1, 0]);
    s = execute(s, fire, false).state;
    expect(s.shared.ships[0].stations[1].cooldowns?.fire).toEqual([1, 2]);
  });
  it("modifies each duration independently and spends only one slot on a forced hit", () => {
    let s = state(),
      ship = s.shared.ships[0],
      st = ship.stations[1];
    st.actions[0].cooldown = [2, 3];
    selectStationEffects(
      ship.stations[0],
      "flight-mode",
      ["boost"],
      s.shared.crew,
    );
    expect(cooldownDurations(ship, st, st.actions[0])).toEqual([3, 4]);
    s = execute(execute(s, fire, false).state, fire, false).state;
    expect(s.shared.ships[0].stations[1].cooldowns?.fire).toEqual([3, 4]);
    s.shared.ships[0].stations[1].cooldowns!.fire = [1, 3];
    s = execute(s, { ...fire, override: "normal" }, false).state;
    expect(s.shared.ships[0].stations[1].cooldowns?.fire).toEqual([3, 3]);
    st.actions[0].cooldown = [0, 1];
    selectStationEffects(ship.stations[0], "flight-mode", [], s.shared.crew);
    selectStationEffects(st, "target-mode", ["calibration"], s.shared.crew);
    expect(cooldownDurations(ship, st, st.actions[0])).toEqual([0, 0]);
  });
  it("migrates scalar running cooldowns and accepts scalar action definitions", () => {
    const old = JSON.parse(JSON.stringify(state().shared));
    old.ships[0].stations[1].cooldowns = { fire: 2 };
    const migrated = publicSchema.parse(old);
    expect(migrated.ships[0].stations[1].cooldowns?.fire).toEqual([2]);
    expect(migrated.ships[0].stations[1].actions[0].cooldown).toBe(2);
    expect(() =>
      librarySchema.parse({
        version: 1,
        ships: [
          {
            ...sampleShips[0],
            stations: sampleShips[0].stations.map((st, index) =>
              index === 1
                ? {
                    ...st,
                    actions: st.actions.map((a, i) =>
                      i === 0 ? { ...a, cooldown: [] } : a,
                    ),
                  }
                : st,
            ),
          },
        ],
      }),
    ).toThrow();
  });
  it("moves back across a round without restoring or double-ticking cooldowns", () => {
    let s = execute(
      encounterState(),
      { op: "roll-all-initiatives" },
      true,
      () => 12,
    ).state;
    const first = s.gm.encounters[0].currentCrewId;
    expect(() => execute(s, { op: "previous" }, true)).toThrow(/first turn/);
    s = execute(s, fire, false).state;
    s = execute(s, { op: "next-round" }, true).state;
    expect(s.shared.ships[0].stations[1].cooldowns?.fire).toEqual([1]);
    s = execute(s, { op: "previous" }, true).state;
    expect(s.shared.round).toBe(1);
    expect(s.gm.encounters[0].currentCrewId).not.toBe(first);
    s = execute(s, { op: "next" }, true).state;
    expect(s.shared.round).toBe(2);
    expect(s.gm.encounters[0].currentCrewId).toBe(first);
    expect(s.shared.ships[0].stations[1].cooldowns?.fire).toEqual([1]);
    s = execute(s, { op: "next" }, true).state;
    s = execute(s, { op: "previous" }, true).state;
    expect(s.gm.encounters[0].currentCrewId).toBe(first);
    s = execute(s, { op: "next-round" }, true).state;
    expect(s.shared.ships[0].stations[1].cooldowns?.fire).toBeUndefined();
    expect(() => execute(s, { op: "previous" }, false)).toThrow(/Only the GM/);
  });
  it("shows mixed benefits and penalties honestly, including cooldown effects", () => {
    expect(effectTone({ id: "a", name: "a", stats: { ac: 1 } })).toBe(
      "positive",
    );
    expect(
      effectTone({ id: "a", name: "a", cooldowns: [{ modifier: 1 }] }),
    ).toBe("negative");
    expect(
      effectTone({
        id: "a",
        name: "a",
        stats: { speed: 100 },
        rolls: [{ disadvantage: 1 }],
      }),
    ).toBe("mixed");
    expect(effectTone({ id: "a", name: "a" })).toBe("neutral");
  });
});

function ammoState() {
  return encounterState();
}
const useTorpedo = {
  op: "use" as const,
  shipId: "kestrel",
  stationId: "weapons",
  crewId: "ivo",
  actionId: "torpedo",
};
const torpedoRoll = { ...fire, actionId: "torpedo" };
describe("ammunition", () => {
  it("shares a named pool across actions and stations, but keeps each ship independent", () => {
    let s = ammoState();
    const original = s.gm.ships[0].ammunition!.find(
      (p) => p.name === "Cannon rounds",
    )!.current;
    s.shared.ships[0].stations[0].actions.push({
      id: "backup",
      kind: "utility",
      name: "Backup cannon",
      ammunition: { name: "Cannon rounds" },
    });
    const preview = execute(s, { ...fire, op: "roll-preview" }, false);
    expect(preview.publicChanged).toBe(false);
    s = execute(s, fire, false).state;
    s = execute(
      s,
      {
        op: "use",
        shipId: "kestrel",
        stationId: "helm",
        crewId: "mara",
        actionId: "backup",
      },
      false,
    ).state;
    s = execute(s, { ...fire, actionId: "crew-ability" }, false).state;
    expect(
      s.shared.ships[0].ammunition!.find((p) => p.name === "Cannon rounds")!
        .current,
    ).toBe(37);
    expect(
      s.gm.ships[0].ammunition!.find((p) => p.name === "Cannon rounds")!
        .current,
    ).toBe(original);
  });
  it("spends no ammunition on effect rolls and rejects unaffordable hits without starting cooldown", () => {
    const s = ammoState(),
      ship = s.shared.ships[0],
      action = ship.stations[1].actions[0];
    ship.ammunition!.find((p) => p.name === "Cannon rounds")!.current = 0;
    expect(ammunitionAvailable(ship, action)).toBe(false);
    expect(() => execute(s, fire, false)).toThrow(/Not enough/);
    expect(() => execute(s, { ...fire, override: "normal" }, false)).toThrow(
      /Not enough/,
    );
    expect(execute(s, { ...fire, rollIndex: 1 }, false).publicChanged).toBe(
      false,
    );
    expect(ship.stations[1].cooldowns).toBeUndefined();
    ship.ammunition!.find((p) => p.name === "Cannon rounds")!.current = 1;
    expect(() =>
      execute(s, { ...fire, expectedNotation: "outdated" }, false),
    ).toThrow(/Effects changed/);
    expect(
      ship.ammunition!.find((p) => p.name === "Cannon rounds")!.current,
    ).toBe(1);
    const used = execute(s, fire, false).state;
    expect(
      used.shared.ships[0].ammunition!.find((p) => p.name === "Cannon rounds")!
        .current,
    ).toBe(0);
  });
  it("separates Use from later hit and damage rolls, including the last shot", () => {
    let s = ammoState();
    s.shared.ships[0].ammunition!.find((p) => p.name === "Torpedoes")!.current =
      1;
    const used = execute(s, useTorpedo, false);
    expect(used.roll).toBeUndefined();
    s = used.state;
    expect(
      s.shared.ships[0].ammunition!.find((p) => p.name === "Torpedoes")!
        .current,
    ).toBe(0);
    expect(
      s.shared.ships[0].stations[1].cooldowns?.["named:launchers"],
    ).toEqual([2]);
    s = execute(s, { op: "next-round" }, true).state;
    selectStationEffects(
      s.shared.ships[0].stations[1],
      "target-mode",
      ["focus"],
      s.shared.crew,
    );
    const hit = execute(s, torpedoRoll, false);
    expect(hit.roll).toEqual({ notation: "3d6kh2+3#Hit", target: "everyone" });
    expect(hit.publicChanged).toBe(false);
    expect(
      hit.state.shared.ships[0].stations[1].cooldowns?.["named:launchers"],
    ).toEqual([1]);
    const damage = execute(s, { ...torpedoRoll, rollIndex: 1 }, true);
    expect(damage.roll).toEqual({ notation: "3d6#Damage", target: "gm_only" });
    expect(damage.publicChanged).toBe(false);
    expect(() => execute(s, useTorpedo, false)).toThrow(/cooldown/);
    s = execute(s, { op: "next-round" }, true).state;
    expect(() => execute(s, useTorpedo, false)).toThrow(/Not enough/);
  });
  it("supports use-only actions without dice and refuses insufficient multi-point costs", () => {
    const s = ammoState();
    const cmd = {
      op: "use" as const,
      shipId: "kestrel",
      stationId: "helm",
      crewId: "mara",
      actionId: "travel",
    };
    const result = execute(s, cmd, false);
    expect(result.roll).toBeUndefined();
    expect(
      result.state.shared.ships[0].ammunition!.find(
        (p) => p.name === "Autonomy",
      )!.current,
    ).toBe(53);
    s.shared.ships[0].ammunition!.find((p) => p.name === "Autonomy")!.current =
      6;
    expect(() => execute(s, cmd, false)).toThrow(/Not enough/);
    expect(
      s.shared.ships[0].ammunition!.find((p) => p.name === "Autonomy")!.current,
    ).toBe(6);
    expect(() => execute(s, { ...cmd, crewId: "ivo" }, false)).toThrow(
      /occupy/,
    );
  });
  it("adjusts Autonomy by 1 or 7, clamps limits, and keeps NPC changes private", () => {
    let s = ammoState();
    const change = {
      op: "ammunition" as const,
      shipId: "kestrel",
      name: "Autonomy",
    };
    s = execute(s, { ...change, delta: -7 }, false).state;
    s = execute(s, { ...change, delta: 1 }, false).state;
    expect(s.shared.ships[0].ammunition![0].current).toBe(54);
    s.shared.ships[0].ammunition![0].current = 3;
    s = execute(s, { ...change, delta: -7 }, false).state;
    expect(s.shared.ships[0].ammunition![0].current).toBe(0);
    s.shared.ships[0].ammunition![0].current = 79;
    s = execute(s, { ...change, delta: 7 }, false).state;
    expect(s.shared.ships[0].ammunition![0].current).toBe(80);
    const npc = execute(s, { ...change, shipId: "shrike", delta: -1 }, true);
    expect(npc.publicChanged).toBe(false);
    expect(npc.gmChanged).toBe(true);
    expect(() =>
      execute(s, { ...change, shipId: "shrike", delta: -1 }, false),
    ).toThrow(/player ships/);
    expect(() =>
      execute(s, { ...change, name: "Cannon rounds", delta: 7 }, false),
    ).toThrow(/Only Autonomy/);
  });
  it("validates pool references, capacities, uniqueness and old saves", () => {
    const s = ammoState(),
      ship = s.shared.ships[0];
    expect(() =>
      librarySchema.parse({
        version: 1,
        ships: [
          {
            ...ship,
            ammunition: [{ name: "Autonomy", current: 81, capacity: 80 }],
          },
        ],
      }),
    ).toThrow(/exceed capacity/);
    expect(() =>
      librarySchema.parse({
        version: 1,
        ships: [
          {
            ...ship,
            ammunition: [{ name: "Autonomy", current: 0, capacity: 121 }],
          },
        ],
      }),
    ).toThrow(/40–120/);
    const invalid = structuredClone(ship);
    invalid.ammunition = [];
    expect(() => validateFleet([invalid], s.shared.crew)).toThrow(
      /unknown ammunition/,
    );
    ship.ammunition!.push({ ...ship.ammunition![0] });
    expect(() => validateFleet([ship], s.shared.crew)).toThrow(
      /Duplicate ammunition/,
    );
    const old = structuredClone(s.shared);
    old.ships[0].ammunition = undefined;
    expect(publicSchema.parse(old).ships[0].ammunition).toEqual([]);
  });
});

function timedEncounter() {
  const s = encounterState();
  for (const c of [...s.shared.crew, ...s.gm.crew])
    c.initiative =
      ({ mara: 20, raider: 15, ivo: 10, captain: 5 } as Record<string, number>)[
        c.id
      ] ?? null;
  s.gm.encounters[0].currentCrewId = "mara";
  return s;
}
const flight = (choices: string[]) => ({
  op: "effects" as const,
  shipId: "kestrel",
  stationId: "helm",
  actionId: "flight-mode",
  crewId: "mara",
  choices,
});
const save = {
  op: "roll" as const,
  shipId: "kestrel",
  stationId: "helm",
  crewId: "mara",
  actionId: "g-save",
  rollIndex: 0,
};
describe("effect lifecycle, station blocks and requirements", () => {
  it("blocks every station roll, including saves and damage, while preserving explicit forcing and non-roll actions", () => {
    const s = execute(timedEncounter(), flight(["ion-lock"]), false).state;
    expect(
      rollBlockers(s.shared.ships[0], s.shared.ships[0].stations[1]),
    ).toEqual(["Ionised controls"]);
    expect(() => execute(s, fire, false)).toThrow(/Rolls disabled/);
    expect(() => execute(s, { ...fire, rollIndex: 1 }, false)).toThrow(
      /Rolls disabled/,
    );
    expect(() => execute(s, save, false)).toThrow(/Rolls disabled/);
    expect(execute(s, { ...save, override: "normal" }, false).roll).toEqual({
      notation: "1d6+4#Save",
      target: "everyone",
    });
    const adjusted = execute(
      s,
      {
        op: "use",
        shipId: "kestrel",
        stationId: "helm",
        crewId: "mara",
        actionId: "accelerate",
      },
      false,
    );
    expect(adjusted.state.shared.ships[0].gs).toBe(1);
    expect(adjusted.roll).toBeUndefined();
  });
  it("expires round effects once and does not double-tick on backward/forward navigation", () => {
    let s = execute(timedEncounter(), flight(["ion-lock"]), false).state;
    const key = "station:helm:flight-mode:ion-lock";
    expect(s.shared.ships[0].effectStates?.[key].remaining).toBe(2);
    s = execute(s, { op: "next-round" }, true).state;
    expect(s.shared.ships[0].effectStates?.[key].remaining).toBe(1);
    s = execute(s, { op: "previous" }, true).state;
    s = execute(s, { op: "next" }, true).state;
    expect(s.shared.ships[0].effectStates?.[key].remaining).toBe(1);
    s = execute(s, { op: "next-round" }, true).state;
    expect(
      activeEffects(s.shared.ships[0]).some(
        (entry) => entry.effect.id === "ion-lock",
      ),
    ).toBe(false);
    expect(
      s.shared.ships[0].stations[0].selectedEffects["flight-mode"],
    ).toEqual([]);
  });
  it("expires on the triggering crew's Xth upcoming turn and does not reset retained selections", () => {
    let s = execute(timedEncounter(), flight(["steady"]), false).state;
    const key = "station:helm:flight-mode:steady";
    for (let i = 0; i < 3; i++) s = execute(s, { op: "next" }, true).state;
    expect(s.shared.ships[0].effectStates?.[key].remaining).toBe(2);
    s = execute(s, { op: "next" }, true).state;
    expect(s.gm.encounters[0].currentCrewId).toBe("mara");
    expect(s.shared.ships[0].effectStates?.[key].remaining).toBe(1);
    s = execute(s, flight(["steady"]), false).state;
    expect(s.shared.ships[0].effectStates?.[key].remaining).toBe(1);
    s = execute(s, { op: "previous" }, true).state;
    s = execute(s, { op: "next" }, true).state;
    expect(s.shared.ships[0].effectStates?.[key].remaining).toBe(1);
    for (let i = 0; i < 4; i++) s = execute(s, { op: "next" }, true).state;
    expect(
      activeEffects(s.shared.ships[0]).some(
        (entry) => entry.effect.id === "steady",
      ),
    ).toBe(false);
  });
  it("removes an effect without repairing damage, and restores a fresh instance after repair and new damage", () => {
    let s = timedEncounter();
    s.shared.ships[0].parts[1].levels[0] = [
      {
        id: "temporary",
        name: "Temporary fault",
        type: "Malfunction",
        duration: { unit: "rounds", count: 1 },
        stats: { ac: -2 },
      },
    ];
    s = execute(
      s,
      { op: "damage", shipId: "kestrel", part: 1, from: 0 },
      false,
    ).state;
    s = execute(s, { op: "next-round" }, true).state;
    expect(s.shared.ships[0].parts[1].damage).toBe(1);
    expect(s.shared.ships[0].parts[1].applied[1]).toBe("temporary");
    expect(
      activeEffects(s.shared.ships[0]).some(
        (entry) => entry.effect.id === "temporary",
      ),
    ).toBe(false);
    expect(() =>
      validateFleet(
        [...s.shared.ships, ...s.gm.ships],
        [...s.shared.crew, ...s.gm.crew],
      ),
    ).not.toThrow();
    s = execute(s, { op: "repair", shipId: "kestrel", part: 1 }, false).state;
    s = execute(
      s,
      { op: "damage", shipId: "kestrel", part: 1, from: 0 },
      false,
    ).state;
    expect(s.shared.ships[0].effectStates?.["damage:1:1"].remaining).toBe(1);
    expect(
      activeEffects(s.shared.ships[0]).some(
        (entry) => entry.effect.id === "temporary",
      ),
    ).toBe(true);
  });
  it("lets only the GM dismiss directly, and type-limits action removal without charging stale selections", () => {
    let s = execute(
      timedEncounter(),
      { op: "damage", shipId: "kestrel", part: 2, from: 0 },
      false,
    ).state;
    expect(() =>
      execute(
        s,
        { op: "dismiss-effect", shipId: "kestrel", key: "damage:2:1" },
        false,
      ),
    ).toThrow(/Only the GM/);
    const remove = {
      op: "remove-effect" as const,
      shipId: "kestrel",
      stationId: "helm",
      crewId: "mara",
      actionId: "clear-fault",
      key: "damage:2:1",
    };
    expect(() =>
      finishSelection(s, { ...remove, key: "damage:0:1" }, false),
    ).toThrow(/Malfunction/);
    s = finishSelection(s, remove, false).state;
    expect(s.shared.ships[0].parts[2].damage).toBe(1);
    expect(
      activeEffects(s.shared.ships[0]).some(
        (entry) => entry.effect.id === "misaligned",
      ),
    ).toBe(false);
    expect(() => finishSelection(s, remove, false)).toThrow(/cooldown/);
    const before = effectiveStats(s.shared.ships[0]).ac;
    s = execute(
      s,
      { op: "dismiss-effect", shipId: "kestrel", key: "damage:0:1" },
      true,
    ).state;
    expect(effectiveStats(s.shared.ships[0]).ac).toBe(before + 1);
    expect(s.shared.ships[0].parts[0].damage).toBe(1);
  });
  it("requires exact active effects and reports their names without allowing forced bypass", () => {
    let s = timedEncounter();
    const action = s.shared.ships[0].stations[1].actions.find(
      (a) => a.id === "focused-burst",
    )!;
    const cmd = { ...fire, actionId: "focused-burst" };
    expect(missingEffects(s.shared.ships[0], action)).toEqual([
      "Focused targeting",
    ]);
    expect(() => execute(s, cmd, false)).toThrow(
      /Missing effects: Focused targeting/,
    );
    expect(() => execute(s, { ...cmd, override: "normal" }, false)).toThrow(
      /Missing effects/,
    );
    s = execute(
      s,
      {
        op: "effects",
        shipId: "kestrel",
        stationId: "weapons",
        actionId: "target-mode",
        choices: ["focus"],
        crewId: "ivo",
      },
      false,
    ).state;
    expect(execute(s, cmd, false).roll?.notation).toBe("3d6kh2+3#Hit");
    s = execute(
      s,
      {
        op: "dismiss-effect",
        shipId: "kestrel",
        key: "station:weapons:target-mode:focus",
      },
      true,
    ).state;
    expect(missingEffects(s.shared.ships[0], action)).toEqual([
      "Focused targeting",
    ]);
  });
  it("anchors NPC-triggered public effects without exposing NPC identifiers and preserves the anchor through export/import", () => {
    let s = timedEncounter();
    s.shared.ships[0].parts[1].levels[0] = [
      {
        id: "tether",
        name: "Tether",
        type: "Malfunction",
        duration: { unit: "crewTurns", count: 1 },
      },
    ];
    s = execute(
      s,
      { op: "damage", shipId: "kestrel", part: 1, from: 0, crewId: "raider" },
      true,
    ).state;
    expect(s.shared.ships[0].effectStates?.["damage:1:1"].trigger).toMatch(
      /^npc:/,
    );
    expect(JSON.stringify(s.shared)).not.toContain("raider");
    const library = librarySchema.parse({
      version: 1,
      ships: [...s.shared.ships, ...s.gm.ships],
      crew: [...s.shared.crew, ...s.gm.crew],
      encounters: s.gm.encounters,
    });
    s = execute(s, { op: "import", library }, true).state;
    expect(s.gm.crew.find((c) => c.id === "raider")?.effectTrigger).toBe(
      s.shared.ships[0].effectStates?.["damage:1:1"].trigger,
    );
    s = execute(s, { op: "next" }, true).state;
    expect(
      activeEffects(s.shared.ships[0]).some(
        (entry) => entry.effect.id === "tether",
      ),
    ).toBe(false);
  });
  it("validates new definitions and migrates old ships without changing damage", () => {
    const s = timedEncounter(),
      ship = s.shared.ships[0];
    expect(publicSchema.parse(s.shared).ships[0].gs).toBe(0);
    expect(publicSchema.parse(s.shared).ships[0].effectStates).toEqual({});
    ship.stations[0].actions.push({
      id: "invalid",
      kind: "utility",
      name: "Invalid",
      requiresEffects: ["missing"],
    });
    expect(() => validateFleet([ship], s.shared.crew)).toThrow(
      /unknown effect/,
    );
    expect(() =>
      librarySchema.parse({
        version: 1,
        ships: [
          {
            ...ship,
            effectStates: { invalid: { unit: "crewTurns", remaining: 1 } },
          },
        ],
      }),
    ).toThrow(/trigger/);
  });
});
describe("Gs actions", () => {
  it("changes current Gs on activation, never on preview, and allows exceeding the separate maxG", () => {
    let s = timedEncounter();
    const course = {
      op: "roll" as const,
      shipId: "kestrel",
      stationId: "helm",
      crewId: "mara",
      actionId: "course",
      rollIndex: 0,
    };
    expect(
      execute(s, { ...course, op: "roll-preview" }, false).publicChanged,
    ).toBe(false);
    for (let i = 0; i < 5; i++) s = execute(s, course, false).state;
    expect(s.shared.ships[0].gs).toBe(5);
    expect(effectiveStats(s.shared.ships[0]).maxG).toBe(4);
    const trim = {
      op: "action-gs" as const,
      shipId: "kestrel",
      stationId: "helm",
      crewId: "mara",
      actionId: "trim-gs",
    };
    s = execute(s, trim, false).state;
    expect(s.shared.ships[0].gs).toBe(4);
    for (let i = 0; i < 5; i++) s = execute(s, trim, false).state;
    expect(s.shared.ships[0].gs).toBe(0);
  });
  it("applies activation Gs only on separate Use, not later hit/damage resolution", () => {
    let s = timedEncounter();
    s.shared.ships[0].stations[1].actions.find((a) => a.id === "torpedo")!.gs =
      { amount: 2 };
    s = execute(s, useTorpedo, false).state;
    expect(s.shared.ships[0].gs).toBe(2);
    s = execute(s, torpedoRoll, false).state;
    s = execute(s, { ...torpedoRoll, rollIndex: 1 }, false).state;
    expect(s.shared.ships[0].gs).toBe(2);
  });
});

describe("named cooldowns and action values", () => {
  it("shares independent slots across actions and crew, ticking a pool only once", () => {
    const { ships, crew } = fixture(),
      ship = ships[0],
      st = ship.stations[1];
    const first = st.actions[0];
    first.cooldownName = "battery";
    first.cooldown = [2, 3];
    const second = { ...first, id: "second-mode", name: "Second mode" };
    st.actions.push(second);
    const crewAction = { ...first, id: "crew-mode" };
    crew.find((c) => c.id === "ivo")!.stationActions.weapons.push(crewAction);
    validateFleet(ships, crew);
    startCooldown(ship, st, first);
    expect(cooldownSlots(ship, st, second).map((s) => s.remaining)).toEqual([
      2, 0,
    ]);
    startCooldown(ship, st, crewAction);
    expect(cooldownBlocked(ship, st, first)).toBe(true);
    expect(cooldownBlocked(ship, st, second)).toBe(true);
    expect(st.cooldowns?.fire).toBeUndefined();
    tickCooldowns([ship]);
    expect(st.cooldowns?.["named:battery"]).toEqual([1, 2]);
    tickCooldowns([ship]);
    expect(cooldownBlocked(ship, st, second)).toBe(false);
    startCooldown(ship, st, second);
    expect(st.cooldowns?.["named:battery"]).toEqual([2, 1]);
    const restored = publicSchema.parse({
      ...state().shared,
      ships: [ship],
      crew: crew.filter((c) => c.ship === ship.id),
    });
    expect(restored.ships[0].stations[1].cooldowns?.["named:battery"]).toEqual([
      2, 1,
    ]);
  });
  it("keeps identical pool names separate between stations and ships, and unnamed actions independent", () => {
    const { ships } = fixture(),
      ship = ships[0],
      st = ship.stations[1],
      a = st.actions[0];
    a.cooldownName = "shared";
    const unnamed = { ...a, id: "independent", cooldownName: undefined };
    const otherStation = ship.stations[0],
      otherShip = ships[1];
    startCooldown(ship, st, a);
    expect(cooldownBlocked(ship, st, unnamed)).toBe(false);
    expect(cooldownBlocked(ship, otherStation, a)).toBe(false);
    expect(cooldownBlocked(otherShip, otherShip.stations[1], a)).toBe(false);
    startCooldown(ship, st, unnamed);
    tickCooldowns([ship]);
    tickCooldowns([ship]);
    expect(st.cooldowns).toEqual({});
  });
  it("uses the activating action's effect-adjusted duration and supports forced shared rolls", () => {
    let s = state();
    const ship = s.shared.ships[0],
      st = ship.stations[1];
    st.actions[0].cooldownName = "battery";
    const second = { ...st.actions[0], id: "alternate", type: "Other" };
    st.actions.push(second);
    selectStationEffects(st, "target-mode", ["calibration"], s.shared.crew);
    s = execute(s, fire, false).state;
    expect(s.shared.ships[0].stations[1].cooldowns?.["named:battery"]).toEqual([
      1,
    ]);
    expect(() => execute(s, { ...fire, actionId: "alternate" }, false)).toThrow(
      /cooldown/,
    );
    const forced = execute(
      s,
      { ...fire, actionId: "alternate", override: "normal" },
      false,
    );
    expect(
      forced.state.shared.ships[0].stations[1].cooldowns?.["named:battery"],
    ).toEqual([2]);
  });
  it("validates pool consistency including eligible crew actions and requires durations", () => {
    const { ships, crew } = fixture(),
      st = ships[0].stations[1];
    st.actions[0].cooldownName = "battery";
    st.actions.push({ ...st.actions[0], id: "conflict", cooldown: [2, 3] });
    expect(() => validateFleet(ships, crew)).toThrow(/same base durations/);
    st.actions.pop();
    crew
      .find((c) => c.id === "ivo")!
      .stationActions.weapons.push({
        ...st.actions[0],
        id: "conflict",
        cooldown: 3,
      });
    expect(() => validateFleet(ships, crew)).toThrow(/same base durations/);
    st.actions[0].cooldown = undefined;
    expect(() => librarySchema.parse({ version: 1, ships, crew })).toThrow(
      /Named cooldowns require durations/,
    );
  });
  it("round-trips named values including numeric zero and rejects invalid values", () => {
    const { ships, crew } = fixture();
    ships[0].stations[1].actions[0].values = [
      { name: "Range", value: "30 km" },
      { name: "Recoil", value: 0 },
    ];
    const parsed = librarySchema.parse({ version: 1, ships, crew });
    expect(parsed.ships![0].stations[1].actions[0].values).toEqual([
      { name: "Range", value: "30 km" },
      { name: "Recoil", value: 0 },
    ]);
    ships[0].stations[1].actions[0].values![0].value = Infinity;
    expect(() => librarySchema.parse({ version: 1, ships, crew })).toThrow();
  });
});

describe("targeted action effects", () => {
  const support = {
    op: "use" as const,
    shipId: "kestrel",
    stationId: "helm",
    crewId: "mara",
    actionId: "support",
    targetShipId: "shrike",
  };
  it("applies effects only to the chosen target, spends the origin cooldown and persists them", () => {
    const before = timedEncounter();
    const result = finishSelection(before, support, true);
    const target = result.state.gm.ships[0];
    expect(
      activeEffects(target).some((e) => e.effect.id === "guided-fire"),
    ).toBe(true);
    expect(
      activeEffects(result.state.shared.ships[0]).some(
        (e) => e.effect.id === "guided-fire",
      ),
    ).toBe(false);
    expect(result.state.shared.ships[0].stations[0].cooldowns?.support).toEqual(
      [2],
    );
    expect(before.gm.ships[0].receivedEffects).toBeUndefined();
    const exported = librarySchema.parse({
      version: 1,
      ...allDataForTest(result.state),
      encounters: result.state.gm.encounters,
    });
    validateFleet(exported.ships!, exported.crew!);
    expect(
      exported.ships!.find((s) => s.id === "shrike")!.receivedEffects,
    ).toEqual(target.receivedEffects);
    let s = execute(result.state, { op: "next-round" }, true).state;
    expect(
      activeEffects(s.gm.ships[0]).find((e) => e.effect.id === "guided-fire")!
        .key,
    ).toMatch(/^received:/);
    s = execute(s, { op: "next-round" }, true).state;
    expect(s.gm.ships[0].receivedEffects).toEqual([]);
    expect(Object.keys(s.gm.ships[0].effectStates ?? {})).toEqual([]);
  });
  it("blocks private NPC targets for players, missing targets and invalid scopes before spending resources", () => {
    const s = timedEncounter();
    expect(() => finishSelection(s, support, false)).toThrow(
      /Players can only/,
    );
    expect(() =>
      finishSelection(s, { ...support, targetShipId: undefined }, true),
    ).toThrow(/Choose a target/);
    const a = s.shared.ships[0].stations[0].actions.find(
      (a) => a.id === "support",
    )!;
    a.grantsEffects![0].disableStations = ["unknown"];
    expect(() => finishSelection(s, support, true)).toThrow(/unknown station/);
    expect(s.shared.ships[0].stations[0].cooldowns).toBeUndefined();
    expect(s.gm.ships[0].receivedEffects).toBeUndefined();
  });
  it("anchors turn durations to the triggering NPC without publishing its identity", () => {
    let s = timedEncounter();
    const a = s.gm.ships[0].stations[0].actions.find(
      (a) => a.id === "support",
    )!;
    a.grantsEffects![0].duration = { unit: "crewTurns", count: 1 };
    s = finishSelection(
      s,
      {
        ...support,
        shipId: "shrike",
        crewId: "raider",
        targetShipId: "kestrel",
      },
      true,
    ).state;
    const entry = activeEffects(s.shared.ships[0]).find(
      (e) => e.effect.id === "guided-fire",
    )!;
    expect(s.shared.ships[0].effectStates![entry.key].trigger).toMatch(/^npc:/);
    expect(JSON.stringify(s.shared)).not.toContain("raider");
    s = execute(s, { op: "next" }, true).state;
    expect(
      activeEffects(s.shared.ships[0]).some(
        (e) => e.effect.id === "guided-fire",
      ),
    ).toBe(false);
  });
  it("lets players target another shared ship and lets matching actions and the GM remove received effects", () => {
    let s = timedEncounter();
    const other = structuredClone(s.shared.ships[0]);
    other.id = "ally";
    for (const st of other.stations) st.seats = st.seats.map(() => null);
    s.shared.ships.push(other);
    s = finishSelection(s, { ...support, targetShipId: "ally" }, false).state;
    const entry = activeEffects(s.shared.ships[1]).find(
      (e) => e.effect.id === "guided-fire",
    )!;
    s = execute(
      s,
      { op: "dismiss-effect", shipId: "ally", key: entry.key },
      true,
    ).state;
    expect(s.shared.ships[1].receivedEffects).toEqual([]);
    s.shared.ships[0].stations[0].cooldowns = {};
    s = finishSelection(
      s,
      { ...support, targetShipId: "kestrel" },
      false,
    ).state;
    const clear = s.shared.ships[0].stations[0].actions.find(
      (a) => a.id === "clear-fault",
    )!;
    if (clear.kind === "remove-effect") clear.effectType = "Support";
    const own = activeEffects(s.shared.ships[0]).find(
      (e) => e.effect.id === "guided-fire",
    )!;
    s = finishSelection(
      s,
      {
        op: "remove-effect",
        shipId: "kestrel",
        stationId: "helm",
        crewId: "mara",
        actionId: "clear-fault",
        key: own.key,
      },
      false,
    ).state;
    expect(s.shared.ships[0].receivedEffects).toEqual([]);
  });
  it("uses grants once on separate Use, never on previews or later hit/damage rolls", () => {
    let s = state();
    const action = s.shared.ships[0].stations[1].actions.find(
      (a) => a.id === "torpedo",
    )!;
    action.grantsEffects = [{ id: "marked", name: "Marked", type: "Target" }];
    action.shipSelector = true;
    s = finishSelection(
      s,
      { ...useTorpedo, targetShipId: "shrike" },
      true,
    ).state;
    expect(s.gm.ships[0].receivedEffects).toHaveLength(1);
    expect(() =>
      execute(s, { ...torpedoRoll, op: "roll-preview" }, true),
    ).toThrow(/Use activation/);
    s = execute(s, { ...torpedoRoll, rollIndex: 1 }, true).state;
    expect(s.gm.ships[0].receivedEffects).toHaveLength(1);
  });
  it("accepts received effects as action requirements and rejects malformed grant definitions", () => {
    const { ships, crew } = fixture();
    ships[0].stations[1].actions[0].requiresEffects = ["guided-fire"];
    validateFleet(ships, crew);
    ships[0].stations[1].actions[0].grantsEffects = [{ id: "x", name: "X" }];
    expect(() => librarySchema.parse({ version: 1, ships, crew })).toThrow(
      /separate Use/,
    );
  });
});
function allDataForTest(s: State) {
  return {
    ships: [...s.shared.ships, ...s.gm.ships],
    crew: [...s.shared.crew, ...s.gm.crew],
  };
}

describe("damage categories", () => {
  it("maps all five dice, sums modifiers and keeps the category within bounds", () => {
    const { ships, crew } = fixture(),
      ship = ships[0],
      st = ship.stations[1];
    for (const [index, die] of [4, 6, 8, 10, 12].entries()) {
      const roll = {
        kind: "effectRoll" as const,
        label: "Damage",
        type: "Damage",
        notation: `3d${die}+2`,
      };
      expect(baseCategory(roll)).toBe(index + 1);
      expect(categoryDie(index + 1)).toBe(die);
      ship.receivedEffects = [
        {
          id: crypto.randomUUID(),
          effect: { id: "cat", name: "CAT", categories: [{ modifier: 1 }] },
        },
      ];
      expect(damageCategory(ship, st, "fire", roll)).toBe(Math.max(1, index));
      expect(
        rollNotation(ship, st, "Gunnery", roll, crew[1], undefined, "fire"),
      ).toBe(`3d${[4, 4, 6, 8, 10][index]}+2`);
    }
    ship.receivedEffects![0].effect.categories = [
      { modifier: 10 },
      { modifier: -20 },
    ];
    const roll = {
      kind: "effectRoll" as const,
      label: "Damage",
      type: "Damage",
      notation: "1d6",
    };
    expect(damageCategory(ship, st, "fire", roll)).toBe(5);
    expect(damageCategory(ship, st, "fire", roll, 1)).toBe(4);
    expect(damageCategory(ship, st, "fire", roll, -4)).toBe(5);
  });
  it("scopes changes to a weapon, a station or the entire ship, leaving hit rolls alone", () => {
    const { ships, crew } = fixture(),
      ship = ships[0],
      st = ship.stations[1];
    ship.receivedEffects = [
      {
        id: crypto.randomUUID(),
        effect: {
          id: "cat",
          name: "CAT",
          categories: [{ stationId: "weapons", actionId: "fire", modifier: 1 }],
        },
      },
    ];
    const damage = {
      kind: "effectRoll" as const,
      label: "Damage",
      type: "Damage",
      notation: "2d8-1",
    };
    expect(
      rollNotation(ship, st, "Gunnery", damage, crew[1], undefined, "fire"),
    ).toBe("2d6-1");
    expect(
      rollNotation(ship, st, "Gunnery", damage, crew[1], undefined, "torpedo"),
    ).toBe("2d8-1");
    expect(damageCategory(ship, ship.stations[0], "fire", damage)).toBe(3);
    expect(baseCategory({ ...damage, kind: "hitRoll" })).toBeUndefined();
    expect(baseCategory({ ...damage, damage: false })).toBeUndefined();
    expect(baseCategory({ ...damage, notation: "d20" })).toBeUndefined();
    expect(baseCategory({ ...damage, notation: "1d6+1d8" })).toBeUndefined();
    expect(
      rollNotation(
        ship,
        st,
        "Gunnery",
        { ...damage, notation: "2d8kh1" },
        crew[1],
        undefined,
        "fire",
      ),
    ).toBe("2d6kh1");
  });
  it("uses forced CAT shifts for one damage roll without spending resources or persisting an effect", () => {
    const s = state();
    const command = {
      ...fire,
      rollIndex: 1,
      override: "normal" as const,
      categoryShift: 1,
    };
    expect(execute(s, command, false).roll?.notation).toBe("1d4#Damage");
    expect(
      execute(s, { ...command, categoryShift: -3 }, true).roll?.notation,
    ).toBe("1d12#Damage");
    expect(execute(s, command, false).publicChanged).toBe(false);
    expect(execute(s, { ...fire, rollIndex: 1 }, false).roll?.notation).toBe(
      "1d6#Damage",
    );
    expect(() =>
      execute(s, { ...command, override: undefined }, false),
    ).toThrow(/forced-roll menu/);
    expect(() => execute(s, { ...command, rollIndex: 0 }, false)).toThrow(
      /damage roll/,
    );
    expect(
      commandSchema.safeParse({ ...command, categoryShift: 5 }).success,
    ).toBe(false);
  });
});

function finishSelection(
  s: State,
  command: {
    shipId: string;
    stationId: string;
    actionId: string;
    crewId: string;
    targetShipId?: string;
    key?: string;
    op?: string;
  },
  isGM: boolean,
) {
  const activated = execute(
    s,
    {
      op: "activate-selection",
      shipId: command.shipId,
      stationId: command.stationId,
      crewId: command.crewId,
      actionId: command.actionId,
    },
    isGM,
  );
  return execute(
    activated.state,
    {
      op: "resolve-selection",
      shipId: command.shipId,
      selectionId: activated.selectionId!,
      targetShipId: command.targetShipId,
      key: command.key,
    },
    isGM,
  );
}

describe("paid selections", () => {
  const start = {
    op: "activate-selection" as const,
    shipId: "kestrel",
    stationId: "helm",
    crewId: "mara",
    actionId: "support",
  };
  const setup = () => {
    const s = timedEncounter(),
      ship = s.shared.ships[0],
      a = ship.stations[0].actions.find((a) => a.id === "support")!;
    a.ammunition = { name: "Autonomy", cost: 7 };
    a.activationRoll = { label: "Support", type: "Piloting", notation: "1d6" };
    ship.ammunition!.find((p) => p.name === "Autonomy")!.current = 7;
    return s;
  };
  it("rolls and consumes resources before a target exists, then confirms without paying twice", () => {
    const initial = setup(),
      preview = execute(initial, { ...start, op: "selection-preview" }, false);
    expect(preview.roll).toEqual({
      notation: "1d6+4#Support",
      target: "everyone",
    });
    expect(preview.publicChanged).toBe(false);
    expect(preview.selectionId).toBeUndefined();
    const activated = execute(initial, start, false),
      ship = activated.state.shared.ships[0];
    expect(activated.roll).toEqual(preview.roll);
    expect(ship.ammunition!.find((p) => p.name === "Autonomy")!.current).toBe(
      0,
    );
    expect(ship.stations[0].cooldowns?.support).toEqual([2]);
    expect(ship.receivedEffects).toBeUndefined();
    const resolved = execute(
      activated.state,
      {
        op: "resolve-selection",
        shipId: "kestrel",
        selectionId: activated.selectionId!,
        targetShipId: "kestrel",
      },
      false,
    );
    expect(resolved.state.shared.ships[0].receivedEffects).toHaveLength(1);
    expect(
      resolved.state.shared.ships[0].ammunition!.find(
        (p) => p.name === "Autonomy",
      )!.current,
    ).toBe(0);
    expect(
      resolved.state.shared.ships[0].stations[0].cooldowns?.support,
    ).toEqual([2]);
    expect(() =>
      execute(
        resolved.state,
        {
          op: "resolve-selection",
          shipId: "kestrel",
          selectionId: activated.selectionId!,
          targetShipId: "kestrel",
        },
        false,
      ),
    ).toThrow(/already finished/);
  });
  it("also spends and opens a paid selection when no activation roll is associated", () => {
    const s = setup(),
      action = s.shared.ships[0].stations[0].actions.find(
        (a) => a.id === "support",
      )!;
    delete action.activationRoll;
    const activated = execute(s, start, false);
    expect(activated.roll).toBeUndefined();
    expect(activated.selectionId).toBeTruthy();
    expect(
      activated.state.shared.ships[0].ammunition!.find(
        (p) => p.name === "Autonomy",
      )!.current,
    ).toBe(0);
    expect(
      activated.state.shared.ships[0].stations[0].cooldowns?.support,
    ).toEqual([2]);
  });
  it("cancels without refunding or applying effects and round-trips paid receipts", () => {
    const activated = execute(setup(), start, true);
    expect(activated.roll?.target).toBe("gm_only");
    const parsed = publicSchema.parse(activated.state.shared);
    expect(parsed.ships[0].pendingSelections![0].id).toBe(
      activated.selectionId,
    );
    const cancelled = execute(
      activated.state,
      {
        op: "cancel-selection",
        shipId: "kestrel",
        selectionId: activated.selectionId!,
      },
      false,
    ).state;
    expect(cancelled.shared.ships[0].pendingSelections).toEqual([]);
    expect(cancelled.shared.ships[0].receivedEffects).toBeUndefined();
    expect(cancelled.shared.ships[0].stations[0].cooldowns?.support).toEqual([
      2,
    ]);
    expect(
      cancelled.shared.ships[0].ammunition!.find((p) => p.name === "Autonomy")!
        .current,
    ).toBe(0);
    expect(() =>
      execute(
        cancelled,
        {
          op: "resolve-selection",
          shipId: "kestrel",
          selectionId: activated.selectionId!,
          targetShipId: "kestrel",
        },
        false,
      ),
    ).toThrow(/already finished/);
  });
  it("keeps paid costs and the receipt if a target or effect becomes invalid", () => {
    const s = execute(
      timedEncounter(),
      { op: "damage", shipId: "kestrel", part: 2, from: 0 },
      false,
    ).state;
    const action = s.shared.ships[0].stations[0].actions.find(
      (a) => a.id === "clear-fault",
    )!;
    action.cooldown = 2;
    action.ammunition = { name: "Autonomy", cost: 1 };
    action.activationRoll = {
      label: "Repair",
      type: "Piloting",
      notation: "1d6",
    };
    const activation = execute(s, { ...start, actionId: "clear-fault" }, false);
    const command = {
      op: "resolve-selection" as const,
      shipId: "kestrel",
      selectionId: activation.selectionId!,
      key: "damage:2:1",
    };
    const stale = execute(
      activation.state,
      { op: "dismiss-effect", shipId: "kestrel", key: "damage:2:1" },
      true,
    ).state;
    expect(() => execute(stale, command, false)).toThrow(
      /Activation costs remain spent/,
    );
    expect(stale.shared.ships[0].pendingSelections).toHaveLength(1);
    expect(
      stale.shared.ships[0].stations[0].cooldowns?.["clear-fault"],
    ).toEqual([2]);
    const paid = execute(setup(), start, false);
    expect(() =>
      execute(
        paid.state,
        {
          op: "resolve-selection",
          shipId: "kestrel",
          selectionId: paid.selectionId!,
          targetShipId: "shrike",
        },
        false,
      ),
    ).toThrow(/Players can only/);
    expect(paid.state.shared.ships[0].pendingSelections).toHaveLength(1);
  });
  it("serializes activations and allows each receipt to resolve only once independently of later crew changes", () => {
    const s = setup(),
      ship = s.shared.ships[0],
      a = ship.stations[0].actions.find((a) => a.id === "support")!;
    a.ammunition = undefined;
    a.cooldown = [2, 3];
    const first = execute(s, start, false),
      second = execute(first.state, start, false);
    expect(() => execute(second.state, start, false)).toThrow(/cooldown/);
    expect(second.state.shared.ships[0].stations[0].cooldowns?.support).toEqual(
      [2, 3],
    );
    second.state.shared.ships[0].stations[0].seats = [null];
    let resolved = execute(
      second.state,
      {
        op: "resolve-selection",
        shipId: "kestrel",
        selectionId: second.selectionId!,
        targetShipId: "kestrel",
      },
      false,
    ).state;
    resolved = execute(
      resolved,
      {
        op: "resolve-selection",
        shipId: "kestrel",
        selectionId: first.selectionId!,
        targetShipId: "kestrel",
      },
      false,
    ).state;
    expect(resolved.shared.ships[0].receivedEffects).toHaveLength(2);
    expect(resolved.shared.ships[0].pendingSelections).toEqual([]);
  });
  it("rejects stale previews before spending and honors station blocks and forced overrides", () => {
    const s = setup();
    expect(() =>
      execute(s, { ...start, expectedNotation: "outdated" }, false),
    ).toThrow(/Effects changed/);
    expect(s.shared.ships[0].pendingSelections).toBeUndefined();
    selectStationEffects(
      s.shared.ships[0].stations[0],
      "flight-mode",
      ["ion-lock"],
      s.shared.crew,
    );
    expect(() => execute(s, start, false)).toThrow(/Rolls disabled/);
    expect(
      execute(s, { ...start, override: "normal" }, false).selectionId,
    ).toBeTruthy();
  });
});
