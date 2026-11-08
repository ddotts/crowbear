import { z } from "zod";
import {
  assertEffectTargets,
  type Crew,
  type Effect,
  effectDefinitions,
  effectEntries,
  initiativeFormula,
  type Ship,
} from "./rules";

const id = z
  .string()
  .min(1)
  .max(100)
  .regex(
    /^[a-zA-Z0-9_-]+$/,
    "Use letters, numbers, underscores or hyphens for IDs.",
  )
  .refine(
    (value) => value !== "prototype" && !Object.hasOwn(Object.prototype, value),
    "Reserved ID.",
  );
const text = z.string().min(1).max(200);
const description = z.string().max(30000).optional();
const number = z.number().finite();
const count = z.number().int().min(0).max(20);
const stats = z.object({ ac: number, maxG: number, speed: number });
const effect = z.object({
  id,
  name: text,
  description,
  type: text.default("General"),
  duration: z
    .object({
      unit: z.enum(["rounds", "crewTurns"]),
      count: z.number().int().positive(),
    })
    .optional(),
  disableStations: z.array(id).max(30).optional(),
  stats: stats.partial().optional(),
  categories: z
    .array(
      z.object({
        stationId: id.optional(),
        actionId: id.optional(),
        modifier: number.int(),
      }),
    )
    .max(50)
    .optional(),
  cooldowns: z
    .array(
      z.object({
        stationId: id.optional(),
        actionType: text.optional(),
        modifier: number.int(),
      }),
    )
    .optional(),
  rolls: z
    .array(
      z.object({
        stationId: id.optional(),
        rollType: text.optional(),
        modifier: number.optional(),
        advantage: count.optional(),
        disadvantage: count.optional(),
      }),
    )
    .max(50)
    .optional(),
});
const roll = z.object({
  label: text,
  damage: z.boolean().optional(),
  kind: z.enum(["hitRoll", "effectRoll"]).optional(),
  type: text,
  notation: z.string().min(1).max(500),
});
const baseAction = {
  id,
  name: text,
  description,
  activationRoll: roll.optional(),
  grantsEffects: z.array(effect).min(1).max(50).optional(),
  shipSelector: z.boolean().optional(),
  cooldownName: id.optional(),
  values: z
    .array(z.object({ name: text, value: z.union([text, number]) }))
    .max(20)
    .optional(),
  requiresEffects: z.array(id).max(50).optional(),
  gs: z
    .object({ amount: number, on: z.enum(["activation", "button"]).optional() })
    .optional(),
  ammunition: z
    .object({
      name: text.trim().min(1),
      cost: z.number().int().positive().optional(),
    })
    .optional(),
  cooldown: z
    .union([
      z.number().int().min(0),
      z.array(z.number().int().min(0)).min(1).max(20),
    ])
    .optional(),
};
const action = z
  .discriminatedUnion("kind", [
    z.object({
      ...baseAction,
      kind: z.literal("roll"),
      activation: z.literal("use").optional(),
      savingThrow: z.boolean().optional(),
      type: text,
      rolls: z
        .array(roll)
        .min(1)
        .max(20)
        .transform((rolls) =>
          rolls.map((r, index) => ({
            ...r,
            kind:
              r.kind ??
              (index === 0 ? ("hitRoll" as const) : ("effectRoll" as const)),
          })),
        ),
    }),
    z.object({
      ...baseAction,
      kind: z.literal("effects"),
      effects: z.array(effect).min(1).max(50),
    }),
    z.object({ ...baseAction, kind: z.literal("utility") }),
    z.object({
      ...baseAction,
      kind: z.literal("remove-effect"),
      effectType: text,
    }),
  ])
  .refine(
    (a) =>
      !a.cooldownName || (a.kind !== "effects" && a.cooldown !== undefined),
    "Named cooldowns require durations on a non-configuration action.",
  )
  .refine(
    (a) =>
      !a.grantsEffects ||
      a.kind === "utility" ||
      (a.kind === "roll" && a.activation === "use"),
    "Effect grants require a utility action or a roll with separate Use activation.",
  )
  .refine(
    (a) => !a.shipSelector || Boolean(a.grantsEffects),
    "A ship selector requires effects to grant.",
  )
  .refine(
    (a) => !a.activationRoll || a.kind === "remove-effect" || a.shipSelector,
    "Activation rolls require a ship selector or effect-removal action.",
  );
export const crewSchema: z.ZodType<Crew> = z.object({
  id,
  name: text,
  role: text,
  ship: id,
  disabled: z.boolean(),
  initiativeRoll: z
    .string()
    .default("1d20")
    .refine((value) => {
      try {
        initiativeFormula(value);
        return true;
      } catch {
        return false;
      }
    }, "Initiative must be NdS with an optional integer modifier."),
  initiative: number.nullable().default(null),
  initiativeToken: z.string().nullable().default(null),
  effectTrigger: z
    .string()
    .regex(/^npc:[0-9a-f-]{36}$/i)
    .optional(),
  modifiers: z.record(z.string(), number),
  stationActions: z
    .record(id, z.array(action).max(50))
    .refine(
      (groups) =>
        Object.values(groups).every((actions) =>
          actions.every((a) => a.kind !== "effects"),
        ),
      "Persistent configuration actions must be defined on the station, not on individual crew.",
    ),
});
export const shipSchema: z.ZodType<Ship> = z.object({
  id,
  name: text,
  kind: z.enum(["Player", "NPC"]),
  class: text,
  stats,
  gs: number.min(0).default(0),
  pendingSelections: z
    .array(
      z
        .object({
          id: z.string().uuid(),
          stationId: id,
          actionId: id,
          crewId: id,
          kind: z.enum(["target", "remove"]),
          effects: z.array(effect).optional(),
          effectType: text.optional(),
          trigger: z.string().optional(),
        })
        .refine(
          (p) =>
            p.kind === "remove"
              ? Boolean(p.effectType)
              : Boolean(p.effects?.length) &&
                p.effects!.every(
                  (effect) =>
                    effect.duration?.unit !== "crewTurns" || Boolean(p.trigger),
                ),
          "A paid selection needs its removal type or granted effects and turn trigger.",
        ),
    )
    .max(100)
    .default([]),
  receivedEffects: z
    .array(z.object({ id: z.string().uuid(), effect }))
    .max(500)
    .default([]),
  effectStates: z
    .record(
      z.string(),
      z
        .object({
          removed: z.boolean().optional(),
          unit: z.enum(["rounds", "crewTurns"]).optional(),
          remaining: z.number().int().positive().optional(),
          trigger: z.string().optional(),
        })
        .refine(
          (timer) =>
            !timer.unit ||
            (timer.remaining !== undefined &&
              (timer.unit !== "crewTurns" || Boolean(timer.trigger))),
          "Timed effects need a remaining count and a trigger for crew turns.",
        ),
    )
    .default({}),
  ammunition: z
    .array(
      z
        .object({
          name: text.trim().min(1),
          current: z.number().int().min(0),
          capacity: z.number().int().positive().max(1000000),
        })
        .refine(
          (pool) => pool.current <= pool.capacity,
          "Ammunition cannot exceed capacity.",
        )
        .refine(
          (pool) =>
            pool.name !== "Autonomy" ||
            (pool.capacity >= 40 && pool.capacity <= 120),
          "Autonomy capacity must be 40–120 points.",
        ),
    )
    .max(50)
    .default([]),
  parts: z
    .array(
      z.object({
        name: text,
        damage: z.number().int().min(0),
        levels: z.array(z.array(effect).max(30)).min(1).max(30),
        applied: z.record(z.string(), z.string()),
      }),
    )
    .max(30),
  stations: z
    .array(
      z.object({
        id,
        name: text,
        type: text,
        seats: z.array(id.nullable()).min(1).max(20),
        actions: z.array(action).max(50),
        selectedEffects: z.record(z.string(), z.array(id)),
        cooldowns: z
          .record(
            z.union([id, z.string().regex(/^named:[a-zA-Z0-9_-]{1,100}$/)]),
            z
              .union([
                z.number().int().min(0),
                z.array(z.number().int().min(0)).min(1).max(20),
              ])
              .transform((value) =>
                typeof value === "number" ? [value] : value,
              ),
          )
          .default({}),
      }),
    )
    .max(30),
});
export const encounterSchema = z.object({
  id,
  name: text,
  shipIds: z.array(id),
  round: z.number().int().min(1),
  turn: z.number().int().min(0).default(0),
  currentCrewId: id.nullable().default(null),
  cooldownRound: z.number().int().min(1).optional(),
  effectTurnRounds: z.record(id, z.number().int().min(1)).optional(),
  running: z.boolean(),
});
export type Encounter = z.infer<typeof encounterSchema>;
export const publicSchema = z.object({
  version: z.literal(1),
  sessionId: z.string(),
  ownerId: z.string(),
  controllerId: z.string(),
  revision: z.number().int().min(0),
  round: z.number().int().min(1).default(1),
  ships: z.array(shipSchema),
  crew: z.array(crewSchema),
});
export type PublicState = z.infer<typeof publicSchema>;
export const gmSchema = z.object({
  version: z.literal(1),
  ships: z.array(shipSchema),
  crew: z.array(crewSchema),
  encounters: z.array(encounterSchema),
  activeEncounterId: id.nullable(),
});
export type GmState = z.infer<typeof gmSchema>;
export const librarySchema = z.object({
  version: z.literal(1),
  ships: z.array(shipSchema).optional(),
  crew: z.array(crewSchema).optional(),
  encounters: z.array(encounterSchema).optional(),
});
export type Library = z.infer<typeof librarySchema>;
const atShip = { shipId: id };
const atStation = { ...atShip, stationId: id };
export const commandSchema = z.discriminatedUnion("op", [
  z.object({
    op: z.enum(["activate-selection", "selection-preview"]),
    ...atStation,
    actionId: id,
    crewId: id,
    override: z.enum(["advantage", "disadvantage", "normal"]).optional(),
    categoryShift: z.number().int().min(-4).max(4).optional(),
    expectedNotation: z.string().optional(),
  }),
  z.object({
    op: z.literal("resolve-selection"),
    ...atShip,
    selectionId: z.string().uuid(),
    targetShipId: id.optional(),
    key: z.string().max(500).optional(),
  }),
  z.object({
    op: z.literal("cancel-selection"),
    ...atShip,
    selectionId: z.string().uuid(),
  }),
  z.object({ op: z.literal("snapshot") }),
  z.object({
    op: z.literal("dismiss-effect"),
    ...atShip,
    key: z.string().max(500),
  }),
  z.object({
    op: z.literal("remove-effect"),
    ...atStation,
    actionId: id,
    crewId: id,
    key: z.string().max(500),
  }),
  z.object({
    op: z.literal("action-gs"),
    ...atStation,
    actionId: id,
    crewId: id,
  }),
  z.object({
    op: z.literal("ammunition"),
    ...atShip,
    name: text,
    delta: z.union([z.literal(-7), z.literal(-1), z.literal(1), z.literal(7)]),
  }),
  z.object({
    op: z.literal("use"),
    ...atStation,
    actionId: id,
    crewId: id,
    targetShipId: id.optional(),
  }),
  z.object({
    op: z.literal("damage"),
    ...atShip,
    crewId: id.optional(),
    from: z.number().int().min(0),
    part: z.number().int().min(0),
    choice: id.optional(),
  }),
  z.object({
    op: z.literal("repair"),
    ...atShip,
    part: z.number().int().min(0),
  }),
  z.object({
    op: z.literal("seat"),
    ...atStation,
    seat: z.number().int().min(0),
    crewId: id.nullable(),
  }),
  z.object({
    op: z.literal("move"),
    ...atStation,
    seat: z.number().int().min(0),
    crewId: id,
  }),
  z.object({ op: z.literal("disable"), crewId: id, disabled: z.boolean() }),
  z.object({
    op: z.literal("effects"),
    ...atStation,
    actionId: id,
    choices: z.array(id),
    crewId: id.optional(),
  }),
  z.object({
    op: z.enum(["roll", "roll-preview"]),
    ...atStation,
    actionId: id,
    crewId: id,
    rollIndex: z.number().int().min(0).optional(),
    override: z.enum(["advantage", "disadvantage", "normal"]).optional(),
    categoryShift: z.number().int().min(-4).max(4).optional(),
    expectedNotation: z.string().optional(),
  }),
  z.object({
    op: z.literal("initiative"),
    crewId: id,
    value: number.nullable(),
  }),
  z.object({ op: z.literal("encounter"), encounter: encounterSchema }),
  z.object({ op: z.literal("open-encounter"), id }),
  z.object({ op: z.literal("initiative-roll"), crewId: id }),
  z.object({
    op: z.literal("initiative-result"),
    crewId: id,
    token: z.string(),
    value: number,
  }),
  z.object({ op: z.literal("roll-all-initiatives") }),
  z.object({ op: z.literal("next-round") }),
  z.object({ op: z.literal("pause") }),
  z.object({ op: z.literal("next") }),
  z.object({ op: z.literal("previous") }),
  z.object({ op: z.literal("load-defaults") }),
  z.object({
    op: z.literal("import"),
    library: librarySchema,
    mode: z.enum(["replace", "merge"]).optional(),
  }),
]);
export type Command = z.infer<typeof commandSchema>;
function unique(ids: string[], label: string) {
  if (new Set(ids).size !== ids.length)
    throw new Error(`Duplicate ${label} IDs.`);
}
export function validateFleet(ships: Ship[], crew: Crew[]) {
  unique(
    ships.map((s) => s.id),
    "ship",
  );
  unique(
    crew.map((c) => c.id),
    "crew",
  );
  unique(
    crew.flatMap((c) => (c.effectTrigger ? [c.effectTrigger] : [])),
    "effect trigger",
  );
  const knownEffects = [
    ...ships.flatMap(effectDefinitions),
    ...crew.flatMap((c) =>
      Object.values(c.stationActions).flatMap((actions) =>
        actions.flatMap((a) => a.grantsEffects ?? []),
      ),
    ),
  ];
  const seated = new Set<string>();
  for (const s of ships) {
    unique(
      (s.ammunition ?? []).map((pool) => pool.name),
      "ammunition pool",
    );
    unique(
      (s.pendingSelections ?? []).map((pending) => pending.id),
      "paid selection",
    );
    const checkAmmunition = (a: import("./rules").Action) => {
      if (
        a.requiresEffects?.some(
          (id) => !knownEffects.some((effect) => effect.id === id),
        )
      )
        throw new Error(`${s.name}: action requires an unknown effect.`);
      if (
        a.ammunition &&
        !s.ammunition?.some((pool) => pool.name === a.ammunition!.name)
      )
        throw new Error(
          `${s.name}: unknown ammunition pool ${a.ammunition.name}.`,
        );
    };
    unique(
      s.stations.map((st) => st.id),
      "station",
    );
    for (const p of s.parts) {
      if (p.damage > p.levels.length)
        throw new Error(`${s.name}: damage exceeds the number of levels.`);
      for (const [level, effectId] of Object.entries(p.applied))
        if (
          !Number.isInteger(Number(level)) ||
          Number(level) < 1 ||
          Number(level) > p.damage ||
          !p.levels[Number(level) - 1]?.some((e) => e.id === effectId)
        )
          throw new Error(`${s.name}: invalid applied damage effect.`);
      p.levels.forEach((options, index) => {
        unique(
          options.map((e) => e.id),
          "damage effect",
        );
        if (index < p.damage && options.length && !p.applied[index + 1])
          throw new Error(
            `${s.name}: damaged level ${index + 1} needs a selected effect.`,
          );
      });
    }
    const checkEffects = (effects: Effect[]) => {
      for (const e of effects) assertEffectTargets(s, e, crew);
    };
    for (const p of s.parts) p.levels.forEach(checkEffects);
    unique(
      (s.receivedEffects ?? []).map((entry) => entry.id),
      "received effect",
    );
    checkEffects((s.receivedEffects ?? []).map((entry) => entry.effect));
    for (const key of Object.keys(s.effectStates ?? {}))
      if (!effectEntries(s).some((entry) => entry.key === key))
        throw new Error(
          `${s.name}: effect timer refers to an unknown active source.`,
        );
    for (const st of s.stations) {
      const namedPools = new Map<string, string>();
      const eligibleCrew = crew.filter((c) =>
        s.kind === "NPC"
          ? c.ship === s.id
          : ships.some((home) => home.id === c.ship && home.kind === "Player"),
      );
      for (const a of [
        ...st.actions,
        ...eligibleCrew.flatMap((c) => c.stationActions[st.id] ?? []),
      ]) {
        if (!a.cooldownName) continue;
        const durations = JSON.stringify(
          Array.isArray(a.cooldown) ? a.cooldown : [a.cooldown],
        );
        const existing = namedPools.get(a.cooldownName);
        if (existing && existing !== durations)
          throw new Error(
            `${s.name} · ${st.name}: named cooldown ${a.cooldownName} must use the same base durations on every action.`,
          );
        namedPools.set(a.cooldownName, durations);
      }
      unique(
        st.actions.map((a) => a.id),
        "action",
      );
      for (const a of st.actions) {
        checkAmmunition(a);
        if (!a.shipSelector) checkEffects(a.grantsEffects ?? []);
        if (a.kind === "effects") {
          unique(
            a.effects.map((e) => e.id),
            "effect",
          );
          checkEffects(a.effects);
        }
      }
      for (const [actionId, selected] of Object.entries(st.selectedEffects)) {
        const a = st.actions.find((a) => a.id === actionId);
        if (
          !a ||
          a.kind !== "effects" ||
          selected.some((id) => !a.effects.some((e) => e.id === id))
        )
          throw new Error(`${s.name}: invalid station effect selection.`);
      }
      for (const id of st.seats)
        if (id) {
          const c = crew.find((c) => c.id === id);
          const origin = ships.find((ship) => ship.id === c?.ship);
          if (
            !c ||
            (s.kind === "NPC" ? c.ship !== s.id : origin?.kind !== "Player")
          )
            throw new Error(`${s.name}: invalid crew assignment ${id}.`);
          if (seated.has(id))
            throw new Error(`${c.name} occupies more than one seat.`);
          seated.add(id);
        }
    }
  }
  for (const c of crew) {
    for (const [stationId, actions] of Object.entries(c.stationActions)) {
      unique(
        actions.map((a) => a.id),
        "crew action",
      );
      const eligible = ships.filter((s) =>
        ships.find((home) => home.id === c.ship)?.kind === "Player"
          ? s.kind === "Player"
          : s.id === c.ship,
      );
      for (const a of actions) {
        if (
          a.requiresEffects?.some(
            (id) => !knownEffects.some((effect) => effect.id === id),
          )
        )
          throw new Error(`${c.name}: crew action requires an unknown effect.`);
        if (
          a.ammunition &&
          !eligible.some((s) =>
            s.ammunition?.some((pool) => pool.name === a.ammunition!.name),
          )
        )
          throw new Error(
            `${c.name}: unknown ammunition pool ${a.ammunition.name}.`,
          );
      }
      for (const s of eligible) {
        const station = s.stations.find((st) => st.id === stationId);
        if (
          station &&
          actions.some((a) => station.actions.some((base) => base.id === a.id))
        )
          throw new Error(
            `${c.name}: crew action IDs must differ from station action IDs.`,
          );
      }
    }
  }
  for (const c of crew)
    if (!ships.some((s) => s.id === c.ship))
      throw new Error(`${c.name}: unknown home ship ${c.ship}.`);
}
