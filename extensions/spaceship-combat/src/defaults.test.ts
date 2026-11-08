import { describe, expect, it } from "vitest";
import { allData, execute, type State } from "./commands";
import { defaultFleet, defaultGm, defaultLibrary } from "./defaults";
import { crew, ships } from "./sample-data";
import { commandSchema, gmSchema, publicSchema } from "./schema";

function initial(): State {
  return {
    shared: publicSchema.parse({
      version: 1,
      sessionId: "scene",
      ownerId: "gm",
      controllerId: "gm-tab",
      revision: 0,
      round: 1,
      ...defaultFleet("Player"),
    }),
    gm: gmSchema.parse(defaultGm()),
  };
}

describe("Naranja defaults", () => {
  it("initializes the complete encounter with the correct storage split", () => {
    const state = initial();
    expect(state.shared.ships.map((s) => s.id)).toEqual(["naranja-mecanica"]);
    expect(state.shared.crew).toHaveLength(6);
    expect(state.gm.ships).toHaveLength(3);
    expect(state.gm.crew).toHaveLength(7);
    expect(state.gm.encounters).toHaveLength(1);
    expect(state.gm.encounters[0]).toMatchObject({
      id: "naranja-mecanica-debt-collection",
      running: false,
      round: 1,
      currentCrewId: null,
    });
    expect(state.gm.activeEncounterId).toBe(state.gm.encounters[0].id);
    expect(allData(state).crew.every((c) => c.initiative == null)).toBe(true);
    expect(defaultLibrary().ships).toHaveLength(4);
  });

  it("replaces a previously saved starter library using a small preset command", () => {
    const state = initial();
    state.shared.ships = structuredClone(
      ships.filter((s) => s.kind === "Player"),
    );
    state.shared.crew = structuredClone(
      crew.filter((c) => c.ship === "kestrel"),
    );
    state.shared.round = 9;
    const command = commandSchema.parse({ op: "load-defaults" });
    const result = execute(state, command, true);
    expect(allData(result.state).ships).toEqual(defaultLibrary().ships);
    expect(result.state.shared.round).toBe(1);
    expect(result.state.gm).toEqual(defaultGm());
    expect(result.publicChanged).toBe(true);
    expect(state.shared.ships[0].id).toBe("kestrel");
    expect(() => execute(state, command, false)).toThrow("Only the GM");
  });

  it("does not carry mutations into later initializations or resets", () => {
    const first = initial();
    first.shared.ships[0].gs = 99;
    first.gm.encounters[0].running = true;
    expect(initial().shared.ships[0].gs).toBe(0);
    expect(initial().gm.encounters[0].running).toBe(false);
  });
});
