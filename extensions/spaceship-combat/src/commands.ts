import {
  applyDamage,
  type Crew,
  crewActions,
  repairDamage,
  rollNotation,
  type Ship,
  selectStationEffects,
} from "./rules";
import {
  type Command,
  type GmState,
  type PublicState,
  validateFleet,
} from "./schema";
export type State = { shared: PublicState; gm: GmState };
export function allData(state: State) {
  return {
    ships: [...state.shared.ships, ...state.gm.ships],
    crew: [...state.shared.crew, ...state.gm.crew],
  };
}
export function execute(current: State, command: Command, isGM: boolean) {
  const state = structuredClone(current);
  const { ships, crew } = allData(state);
  const vessel = (id: string): Ship => {
    const s = ships.find((s) => s.id === id);
    if (!s) throw new Error("Ship no longer exists.");
    if (!isGM && s.kind !== "Player")
      throw new Error("Players can only manage player ships.");
    return s;
  };
  const member = (id: string): Crew => {
    const c = crew.find((c) => c.id === id);
    if (!c) throw new Error("Crew member no longer exists.");
    vessel(c.ship);
    return c;
  };
  const gmOnly = () => {
    if (!isGM) throw new Error("Only the GM can do this.");
  };
  const encounter = () => {
    gmOnly();
    const e = state.gm.encounters.find(
      (e) => e.id === state.gm.activeEncounterId,
    );
    if (!e) throw new Error("Open an encounter first.");
    return e;
  };
  let roll: { notation: string; target: "gm_only" | "everyone" } | undefined;
  let notice = "";
  switch (command.op) {
    case "snapshot":
      break;
    case "damage": {
      const p = vessel(command.shipId).parts[command.part];
      if (!p) throw new Error("Unknown damage section.");
      if (p.damage !== command.from)
        throw new Error(
          "Damage changed while this request was being prepared. Review the current level and try again.",
        );
      const result = applyDamage(p, command.choice);
      if (result === "choose")
        throw new Error("Select an effect before applying damage.");
      if (result === "max") throw new Error("Damage is already at maximum.");
      break;
    }
    case "repair": {
      const p = vessel(command.shipId).parts[command.part];
      if (!p) throw new Error("Unknown damage section.");
      repairDamage(p);
      break;
    }
    case "seat":
    case "move": {
      const s = vessel(command.shipId);
      const st = s.stations.find((st) => st.id === command.stationId);
      if (!st || command.seat >= st.seats.length)
        throw new Error("Unknown seat.");
      if (command.crewId === null) {
        st.seats[command.seat] = null;
        break;
      }
      const c = member(command.crewId);
      if (s.kind === "NPC" ? c.ship !== s.id : vessel(c.ship).kind !== "Player")
        throw new Error("NPC crew stay on their own ship.");
      if (
        command.op === "move" &&
        st.seats[command.seat] &&
        st.seats[command.seat] !== c.id
      )
        throw new Error("That seat was just occupied. Choose another seat.");
      for (const ship of ships)
        for (const station of ship.stations)
          station.seats = station.seats.map((id) => (id === c.id ? null : id));
      st.seats[command.seat] = c.id;
      break;
    }
    case "disable":
      member(command.crewId).disabled = command.disabled;
      break;
    case "effects": {
      const st = vessel(command.shipId).stations.find(
        (st) => st.id === command.stationId,
      );
      if (!st) throw new Error("Unknown station.");
      selectStationEffects(st, command.actionId, command.choices, crew);
      break;
    }
    case "roll": {
      const s = vessel(command.shipId),
        c = member(command.crewId),
        st = s.stations.find((st) => st.id === command.stationId);
      if (!st || c.disabled || !st.seats.includes(c.id))
        throw new Error(
          "An enabled crew member must still occupy this station.",
        );
      const a = crewActions(st, c).find((a) => a.id === command.actionId);
      if (!a) throw new Error("Action is no longer available.");
      if (a.kind === "roll")
        roll = {
          notation: a.rolls
            .map(
              (r) =>
                `${rollNotation(s, st, a.type, r, c)}#${r.label.replace(/[^\w -]/g, "")}`,
            )
            .join(", "),
          target: isGM ? "gm_only" : "everyone",
        };
      else notice = `${a.name} used.`;
      break;
    }
    case "initiative":
      gmOnly();
      vessel(command.shipId).initiative = command.value;
      break;
    case "encounter": {
      gmOnly();
      if (
        command.encounter.shipIds.some((id) => !ships.some((s) => s.id === id))
      )
        throw new Error("Encounter refers to unknown ships.");
      const i = state.gm.encounters.findIndex(
        (e) => e.id === command.encounter.id,
      );
      if (i < 0) state.gm.encounters.push(command.encounter);
      else state.gm.encounters[i] = command.encounter;
      state.gm.activeEncounterId = command.encounter.id;
      break;
    }
    case "open-encounter":
      gmOnly();
      if (!state.gm.encounters.some((e) => e.id === command.id))
        throw new Error("Encounter not found.");
      state.gm.activeEncounterId = command.id;
      break;
    case "pause": {
      const e = encounter();
      e.running = !e.running;
      break;
    }
    case "next": {
      const e = encounter();
      if (!e.running || !e.shipIds.length)
        throw new Error("Resume an encounter with ships first.");
      e.turn++;
      if (e.turn >= e.shipIds.length) {
        e.turn = 0;
        e.round++;
      }
      break;
    }
    case "import": {
      gmOnly();
      const merge = <T extends { id: string }>(
        existing: T[],
        incoming: T[] = [],
      ) => [
        ...existing.filter((e) => !incoming.some((i) => i.id === e.id)),
        ...incoming,
      ];
      const mergedShips = merge(ships, command.library.ships),
        mergedCrew = merge(crew, command.library.crew);
      validateFleet(mergedShips, mergedCrew);
      state.shared.ships = mergedShips.filter((s) => s.kind === "Player");
      state.gm.ships = mergedShips.filter((s) => s.kind === "NPC");
      state.shared.crew = mergedCrew.filter((c) =>
        state.shared.ships.some((s) => s.id === c.ship),
      );
      state.gm.crew = mergedCrew.filter((c) =>
        state.gm.ships.some((s) => s.id === c.ship),
      );
      state.gm.encounters = merge(
        state.gm.encounters,
        command.library.encounters,
      );
      if (
        new Set(state.gm.encounters.map((e) => e.id)).size !==
        state.gm.encounters.length
      )
        throw new Error("Duplicate encounter IDs.");
      for (const e of state.gm.encounters)
        if (e.shipIds.some((id) => !mergedShips.some((s) => s.id === id)))
          throw new Error(`${e.name}: unknown ship reference.`);
      if (!state.gm.activeEncounterId && state.gm.encounters.length)
        state.gm.activeEncounterId = state.gm.encounters[0].id;
      break;
    }
  }
  const publicChanged =
    JSON.stringify(current.shared) !== JSON.stringify(state.shared);
  if (publicChanged) state.shared.revision++;
  return {
    state,
    roll,
    notice,
    publicChanged,
    gmChanged: JSON.stringify(current.gm) !== JSON.stringify(state.gm),
  };
}
