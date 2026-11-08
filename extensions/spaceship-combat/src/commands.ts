import {
  actionRolls,
  activateEffect,
  activateGs,
  activationRolls,
  activationType,
  activeEffects,
  ammunitionAvailable,
  applyDamage,
  assertEffectTargets,
  type Crew,
  changeGs,
  cooldownBlocked,
  crewActions,
  initiativeActors,
  missingEffects,
  randomInitiative,
  removeEffect,
  repairDamage,
  requiresSelection,
  rollBlockers,
  rollNotation,
  type Ship,
  selectStationEffects,
  separateActivation,
  spendAmmunition,
  startCooldown,
  tickCooldowns,
  tickEffects,
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
export function execute(
  current: State,
  command: Command,
  isGM: boolean,
  rng = randomInitiative,
) {
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
  const triggerRef = (c: Crew) => {
    if (state.shared.crew.some((member) => member.id === c.id)) return c.id;
    c.effectTrigger ??= `npc:${crypto.randomUUID()}`;
    return c.effectTrigger;
  };
  const activateTimers = (s: Ship, keys: string[], c?: Crew) => {
    for (const key of keys) {
      const entry = activeEffects(s).find((entry) => entry.key === key);
      if (entry)
        activateEffect(
          s,
          key,
          entry.effect,
          entry.effect.duration?.unit === "crewTurns" && c
            ? triggerRef(c)
            : undefined,
        );
    }
  };
  const requirements = (s: Ship, a: import("./rules").Action) => {
    const missing = missingEffects(s, a);
    if (missing.length)
      throw new Error(`Missing effects: ${missing.join(", ")}.`);
  };
  let roll:
    | {
        notation: string;
        target: "gm_only" | "everyone";
        initiativeToken?: string;
      }
    | undefined;
  let notice = "";
  let selectionId: string | undefined;
  switch (command.op) {
    case "snapshot":
      break;
    case "resolve-selection":
    case "cancel-selection": {
      const s = vessel(command.shipId);
      const pending = s.pendingSelections?.find(
        (pending) => pending.id === command.selectionId,
      );
      if (!pending)
        throw new Error("This selection is already finished or cancelled.");
      if (command.op === "resolve-selection") {
        if (pending.kind === "remove") {
          const entry = activeEffects(s).find(
            (entry) =>
              entry.key === command.key &&
              (entry.effect.type ?? "General") === pending.effectType,
          );
          if (!entry)
            throw new Error(
              `Choose an active ${pending.effectType} effect. Activation costs remain spent.`,
            );
          removeEffect(s, entry.key);
        } else {
          if (!command.targetShipId) throw new Error("Choose a target ship.");
          const target = vessel(command.targetShipId),
            effects = pending.effects ?? [];
          if ((target.receivedEffects?.length ?? 0) + effects.length > 500)
            throw new Error(
              "Remove old action effects before adding more. Activation costs remain spent.",
            );
          for (const effect of effects)
            assertEffectTargets(target, effect, crew);
          target.receivedEffects ??= [];
          for (const effect of effects) {
            const id = crypto.randomUUID();
            target.receivedEffects.push({
              id,
              effect: structuredClone(effect),
            });
            activateEffect(target, `received:${id}`, effect, pending.trigger);
          }
        }
        notice = "Selection applied. Activation costs were already spent.";
      } else
        notice =
          "Selection cancelled. Ammunition and cooldowns are not refunded.";
      s.pendingSelections = s.pendingSelections?.filter(
        (pending) => pending.id !== command.selectionId,
      );
      break;
    }
    case "dismiss-effect":
      gmOnly();
      removeEffect(vessel(command.shipId), command.key);
      break;
    case "ammunition": {
      const s = vessel(command.shipId),
        pool = s.ammunition?.find((pool) => pool.name === command.name);
      if (!pool) throw new Error("Ammunition pool no longer exists.");
      if (Math.abs(command.delta) === 7 && pool.name !== "Autonomy")
        throw new Error("Only Autonomy uses seven-point adjustments.");
      pool.current = Math.max(
        0,
        Math.min(pool.capacity, pool.current + command.delta),
      );
      break;
    }
    case "damage": {
      const s = vessel(command.shipId),
        p = s.parts[command.part];
      if (!p) throw new Error("Unknown damage section.");
      if (p.damage !== command.from)
        throw new Error(
          "Damage changed while this request was being prepared. Review the current level and try again.",
        );
      const result = applyDamage(p, command.choice);
      if (result === "choose")
        throw new Error("Select an effect before applying damage.");
      if (result === "max") throw new Error("Damage is already at maximum.");
      const e = state.gm.encounters.find(
        (e) => e.id === state.gm.activeEncounterId,
      );
      const actorId = command.crewId ?? (isGM ? e?.currentCrewId : undefined);
      const timedCrew =
        p.levels[p.damage - 1].find(
          (effect) => effect.id === p.applied[p.damage],
        )?.duration?.unit === "crewTurns";
      const c = timedCrew && actorId ? member(actorId) : undefined;
      activateTimers(s, [`damage:${command.part}:${p.damage}`], c);
      break;
    }
    case "repair": {
      const s = vessel(command.shipId),
        p = s.parts[command.part];
      if (!p) throw new Error("Unknown damage section.");
      if (s.effectStates)
        delete s.effectStates[`damage:${command.part}:${p.damage}`];
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
      const s = vessel(command.shipId),
        st = s.stations.find((st) => st.id === command.stationId);
      if (!st) throw new Error("Unknown station.");
      const action = st.actions.find((a) => a.id === command.actionId);
      if (!action || action.kind !== "effects")
        throw new Error("Unknown station configuration.");
      const c = command.crewId
        ? member(command.crewId)
        : crew.find((c) => st.seats.includes(c.id) && !c.disabled);
      if (!c || c.disabled || !st.seats.includes(c.id))
        throw new Error("Choose an enabled crew member at this station.");
      requirements(s, action);
      const before = [...(st.selectedEffects[action.id] ?? [])];
      selectStationEffects(st, command.actionId, command.choices, crew);
      for (const id of before.filter((id) => !command.choices.includes(id)))
        if (s.effectStates)
          delete s.effectStates[`station:${st.id}:${action.id}:${id}`];
      activateTimers(
        s,
        command.choices
          .filter((id) => !before.includes(id))
          .map((id) => `station:${st.id}:${action.id}:${id}`),
        c,
      );
      if (JSON.stringify(before) !== JSON.stringify(command.choices))
        activateGs(s, action);
      break;
    }
    case "activate-selection":
    case "selection-preview":
    case "action-gs":
    case "remove-effect":
    case "use":
    case "roll-preview":
    case "roll": {
      const s = vessel(command.shipId),
        c = member(command.crewId),
        st = s.stations.find((st) => st.id === command.stationId);
      if (!st || !st.seats.includes(c.id))
        throw new Error("The crew member must still occupy this station.");
      const override = "override" in command ? command.override : undefined;
      if (c.disabled && !override)
        throw new Error(
          "An enabled crew member is required; use an explicit forced roll to override.",
        );
      const a = (
        command.op === "action-gs"
          ? [...st.actions, ...(c.stationActions[st.id] ?? [])]
          : crewActions(st, c)
      ).find((a) => a.id === command.actionId);
      if (!a) throw new Error("Action is no longer available.");
      requirements(s, a);
      if (command.op === "action-gs") {
        if (!a.gs || a.gs.on !== "button")
          throw new Error("This action has no separate Gs adjustment.");
        changeGs(s, a.gs.amount);
        break;
      }
      if (
        command.op === "activate-selection" ||
        command.op === "selection-preview"
      ) {
        if (!requiresSelection(a))
          throw new Error("This action has no selection.");
        if (cooldownBlocked(s, st, a) && !command.override)
          throw new Error("This station action is on cooldown.");
        if (!ammunitionAvailable(s, a))
          throw new Error(`Not enough ${a.ammunition?.name} for this action.`);
        const rolls = activationRolls(a);
        if (command.override && !rolls.length)
          throw new Error("This action has no activation roll to force.");
        if (command.categoryShift && !command.override)
          throw new Error("Use the forced-roll menu for a CAT override.");
        if (rolls.length && rollBlockers(s, st).length && !command.override)
          throw new Error(
            "Rolls disabled at this station; right-click to force.",
          );
        if (
          a.kind === "remove-effect" &&
          !activeEffects(s).some(
            (entry) => (entry.effect.type ?? "General") === a.effectType,
          )
        )
          throw new Error(`No active ${a.effectType} effects.`);
        if ((s.pendingSelections?.length ?? 0) >= 100)
          throw new Error("Finish or cancel pending selections first.");
        const notation = rolls
          .map(
            (r) =>
              `${rollNotation(s, st, activationType(a), r, c, command.override, a.id, command.categoryShift)}#${r.label.replace(/[^\w -]/g, "")}`,
          )
          .join(", ");
        if (
          command.expectedNotation !== undefined &&
          command.expectedNotation !== notation
        )
          throw new Error(
            "Effects changed while preparing the roll. Review and activate again.",
          );
        if (notation)
          roll = { notation, target: isGM ? "gm_only" : "everyone" };
        if (command.op === "activate-selection") {
          spendAmmunition(s, a);
          startCooldown(s, st, a, Boolean(command.override));
          activateGs(s, a);
          selectionId = crypto.randomUUID();
          s.pendingSelections ??= [];
          s.pendingSelections.push({
            id: selectionId,
            stationId: st.id,
            actionId: a.id,
            crewId: c.id,
            kind: a.kind === "remove-effect" ? "remove" : "target",
            ...(a.kind === "remove-effect"
              ? { effectType: a.effectType }
              : {
                  effects: structuredClone(a.grantsEffects ?? []),
                  trigger: a.grantsEffects?.some(
                    (e) => e.duration?.unit === "crewTurns",
                  )
                    ? triggerRef(c)
                    : undefined,
                }),
          });
        }
        notice =
          "Activation spent. Choose a target or cancel without a refund.";
        break;
      }
      if (
        command.op === "remove-effect" ||
        (requiresSelection(a) && (command.op === "use" || a.kind !== "roll"))
      )
        throw new Error("Activate this action before choosing a target.");
      if (
        command.op !== "roll" &&
        command.op !== "roll-preview" &&
        command.op !== "use"
      )
        throw new Error("Invalid action activation.");
      if (a.kind === "remove-effect")
        throw new Error("Choose an effect to remove first.");
      if (command.op === "use" || a.kind !== "roll") {
        if (!separateActivation(a))
          throw new Error("This action is activated by its hit roll.");
        if (cooldownBlocked(s, st, a))
          throw new Error("This station action is on cooldown.");
        if (!ammunitionAvailable(s, a))
          throw new Error(`Not enough ${a.ammunition?.name} for this action.`);
        const target =
          command.op === "use" && a.shipSelector
            ? command.targetShipId
              ? vessel(command.targetShipId)
              : undefined
            : s;
        if (a.shipSelector && !target) throw new Error("Choose a target ship.");
        if (a.grantsEffects && target) {
          if (
            (target.receivedEffects?.length ?? 0) + a.grantsEffects.length >
            500
          )
            throw new Error("Remove old action effects before adding more.");
          for (const effect of a.grantsEffects)
            assertEffectTargets(target, effect, crew);
        }
        if (command.op !== "roll-preview") {
          spendAmmunition(s, a);
          startCooldown(s, st, a);
          activateGs(s, a);
          if (a.grantsEffects && target) {
            target.receivedEffects ??= [];
            for (const effect of a.grantsEffects) {
              const id = crypto.randomUUID();
              target.receivedEffects.push({
                id,
                effect: structuredClone(effect),
              });
              activateEffect(
                target,
                `received:${id}`,
                effect,
                effect.duration?.unit === "crewTurns"
                  ? triggerRef(c)
                  : undefined,
              );
            }
          }
        }
        notice = `${a.name} used${a.grantsEffects && target ? ` on ${target.name}` : ""}.`;
        break;
      }
      const blocked = rollBlockers(s, st);
      if (blocked.length && !command.override)
        throw new Error(`Rolls disabled at ${st.name}: ${blocked.join(", ")}.`);
      if (command.categoryShift && !command.override)
        throw new Error("Use the forced-roll menu for a CAT override.");
      const available = actionRolls(a);
      const selected =
        command.rollIndex === undefined
          ? available
          : [available[command.rollIndex]];
      if (selected.some((r) => !r)) throw new Error("Unknown roll.");
      if (requiresSelection(a) && selected.some((r) => r.kind === "hitRoll"))
        throw new Error("Use activation to roll before choosing a target.");
      const usesHit =
        selected.some((r) => r.kind === "hitRoll") && !separateActivation(a);
      if (usesHit && cooldownBlocked(s, st, a) && !command.override)
        throw new Error(
          "This station action is on cooldown. Its effect roll remains available.",
        );
      if (usesHit && !ammunitionAvailable(s, a))
        throw new Error(`Not enough ${a.ammunition?.name} for this action.`);
      const notation = selected
        .map(
          (r) =>
            `${rollNotation(s, st, a.type, r, c, command.override, a.id, command.categoryShift)}#${r.label.replace(/[^\w -]/g, "")}`,
        )
        .join(", ");
      if (
        command.expectedNotation !== undefined &&
        notation !== command.expectedNotation
      )
        throw new Error(
          "Effects changed while preparing the roll. Review the new notation and roll again.",
        );
      if (command.op === "roll" && usesHit) {
        spendAmmunition(s, a);
        startCooldown(s, st, a, Boolean(command.override));
        activateGs(s, a);
      }
      roll = { notation, target: isGM ? "gm_only" : "everyone" };
      break;
    }
    case "initiative":
      gmOnly();
      member(command.crewId).initiative = command.value;
      member(command.crewId).initiativeToken = null;
      break;
    case "initiative-roll": {
      const c = member(command.crewId);
      c.initiativeToken = crypto.randomUUID();
      roll = {
        notation: c.initiativeRoll ?? "1d20",
        target: isGM ? "gm_only" : "everyone",
        initiativeToken: c.initiativeToken,
      };
      break;
    }
    case "initiative-result": {
      const c = member(command.crewId);
      if (c.initiativeToken !== command.token)
        throw new Error("A newer initiative roll replaced this one.");
      c.initiative = command.value;
      c.initiativeToken = null;
      break;
    }
    case "roll-all-initiatives": {
      const e = encounter();
      const actors = initiativeActors(ships, crew, e.shipIds, false).filter(
        (actor) => actor.ship.kind === "NPC",
      );
      for (const { crew: c } of actors) {
        c.initiative = rng(c.initiativeRoll ?? "1d20");
        c.initiativeToken = null;
      }
      e.currentCrewId =
        initiativeActors(ships, crew, e.shipIds)[0]?.crew.id ?? null;
      e.turn = 0;
      e.effectTurnRounds ??= {};
      if (e.currentCrewId)
        e.effectTurnRounds[e.currentCrewId] = Math.max(
          e.effectTurnRounds[e.currentCrewId] ?? 0,
          e.round,
        );
      notice = `Rolled ${actors.length} NPC initiatives with RNG.`;
      break;
    }
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
      state.shared.round = command.encounter.round;
      break;
    }
    case "open-encounter":
      gmOnly();
      if (!state.gm.encounters.some((e) => e.id === command.id))
        throw new Error("Encounter not found.");
      state.gm.activeEncounterId = command.id;
      state.shared.round =
        state.gm.encounters.find((e) => e.id === command.id)?.round ?? 1;
      break;
    case "pause": {
      const e = encounter();
      e.running = !e.running;
      break;
    }
    case "previous":
    case "next":
    case "next-round": {
      const e = encounter();
      const actors = initiativeActors(ships, crew, e.shipIds);
      if (!e.running) throw new Error("Resume the encounter first.");
      e.cooldownRound ??= e.round;
      e.effectTurnRounds ??= {};
      if (e.currentCrewId)
        e.effectTurnRounds[e.currentCrewId] = Math.max(
          e.effectTurnRounds[e.currentCrewId] ?? 0,
          e.round,
        );
      if (command.op === "next-round") {
        e.round++;
        e.currentCrewId = actors[0]?.crew.id ?? null;
        e.turn = 0;
      } else {
        if (!actors.length) throw new Error("Roll crew initiative first.");
        const index = actors.findIndex((a) => a.crew.id === e.currentCrewId);
        if (command.op === "previous") {
          if (index <= 0) {
            if (e.round === 1) throw new Error("Already at the first turn.");
            e.round--;
            e.turn = actors.length - 1;
          } else e.turn = index - 1;
        } else if (index + 1 >= actors.length) {
          e.round++;
          e.turn = 0;
        } else e.turn = index + 1;
        e.currentCrewId = actors[e.turn].crew.id;
      }
      if (e.round > e.cooldownRound) {
        tickCooldowns(ships.filter((s) => e.shipIds.includes(s.id)));
        tickEffects(
          ships.filter((s) => e.shipIds.includes(s.id)),
          "rounds",
        );
        e.cooldownRound = e.round;
      }
      if (command.op !== "previous" && e.currentCrewId) {
        e.effectTurnRounds ??= {};
        if ((e.effectTurnRounds[e.currentCrewId] ?? 0) < e.round) {
          const c = crew.find((c) => c.id === e.currentCrewId);
          if (c)
            tickEffects(
              ships.filter((s) => e.shipIds.includes(s.id)),
              "crewTurns",
              [c.id, ...(c.effectTrigger ? [c.effectTrigger] : [])],
            );
          e.effectTurnRounds[e.currentCrewId] = e.round;
        }
      }
      state.shared.round = e.round;
      break;
    }
    case "import": {
      gmOnly();
      const library = structuredClone(command.library);
      const replacing = command.mode === "replace";
      const merge = <T extends { id: string }>(
        existing: T[],
        incoming: T[] = [],
      ) => [
        ...existing.filter((e) => !incoming.some((i) => i.id === e.id)),
        ...incoming,
      ];
      const mergedShips = replacing
          ? (library.ships ?? [])
          : merge(ships, library.ships),
        mergedCrew = replacing
          ? (library.crew ?? [])
          : merge(crew, library.crew);
      validateFleet(mergedShips, mergedCrew);
      state.shared.ships = mergedShips.filter((s) => s.kind === "Player");
      state.gm.ships = mergedShips.filter((s) => s.kind === "NPC");
      state.shared.crew = mergedCrew.filter((c) =>
        state.shared.ships.some((s) => s.id === c.ship),
      );
      state.gm.crew = mergedCrew.filter((c) =>
        state.gm.ships.some((s) => s.id === c.ship),
      );
      for (const s of mergedShips)
        for (const entry of activeEffects(s)) {
          if (entry.effect.duration && !s.effectStates?.[entry.key]?.unit) {
            const c = entry.station
              ? mergedCrew.find((c) => entry.station!.seats.includes(c.id))
              : mergedCrew.find((c) => c.ship === s.id);
            activateTimers(s, [entry.key], c);
          }
        }
      state.gm.encounters = replacing
        ? (library.encounters ?? [])
        : merge(state.gm.encounters, library.encounters);
      if (
        new Set(state.gm.encounters.map((e) => e.id)).size !==
        state.gm.encounters.length
      )
        throw new Error("Duplicate encounter IDs.");
      for (const e of state.gm.encounters)
        if (e.shipIds.some((id) => !mergedShips.some((s) => s.id === id)))
          throw new Error(`${e.name}: unknown ship reference.`);
      if (replacing) {
        state.gm.activeEncounterId = state.gm.encounters[0]?.id ?? null;
        state.shared.round = state.gm.encounters[0]?.round ?? 1;
      } else if (!state.gm.activeEncounterId && state.gm.encounters.length)
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
    selectionId,
    publicChanged,
    gmChanged: JSON.stringify(current.gm) !== JSON.stringify(state.gm),
  };
}
