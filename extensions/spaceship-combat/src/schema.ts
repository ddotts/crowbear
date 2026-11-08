import { z } from "zod";
import type { Crew, Ship } from "./rules";

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
  stats: stats.partial().optional(),
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
  type: text,
  notation: z.string().min(1).max(500),
});
const baseAction = { id, name: text, description };
const action = z.discriminatedUnion("kind", [
  z.object({
    ...baseAction,
    kind: z.literal("roll"),
    type: text,
    rolls: z.array(roll).min(1).max(20),
  }),
  z.object({
    ...baseAction,
    kind: z.literal("effects"),
    effects: z.array(effect).min(1).max(50),
  }),
  z.object({ ...baseAction, kind: z.literal("utility") }),
]);
export const crewSchema = z.object({
  id,
  name: text,
  role: text,
  ship: id,
  disabled: z.boolean(),
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
}) satisfies z.ZodType<Crew>;
export const shipSchema = z.object({
  id,
  name: text,
  kind: z.enum(["Player", "NPC"]),
  class: text,
  initiative: number,
  stats,
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
      }),
    )
    .max(30),
}) satisfies z.ZodType<Ship>;
export const encounterSchema = z.object({
  id,
  name: text,
  shipIds: z.array(id),
  round: z.number().int().min(1),
  turn: z.number().int().min(0),
  running: z.boolean(),
});
export type Encounter = z.infer<typeof encounterSchema>;
export const publicSchema = z.object({
  version: z.literal(1),
  sessionId: z.string(),
  ownerId: z.string(),
  controllerId: z.string(),
  revision: z.number().int().min(0),
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
  z.object({ op: z.literal("snapshot") }),
  z.object({
    op: z.literal("damage"),
    ...atShip,
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
  }),
  z.object({ op: z.literal("roll"), ...atStation, actionId: id, crewId: id }),
  z.object({ op: z.literal("initiative"), ...atShip, value: number }),
  z.object({ op: z.literal("encounter"), encounter: encounterSchema }),
  z.object({ op: z.literal("open-encounter"), id }),
  z.object({ op: z.literal("pause") }),
  z.object({ op: z.literal("next") }),
  z.object({ op: z.literal("import"), library: librarySchema }),
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
  const seated = new Set<string>();
  for (const s of ships) {
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
    const checkEffects = (effects: z.infer<typeof effect>[]) => {
      for (const e of effects)
        for (const r of e.rolls ?? [])
          if (r.stationId && !s.stations.some((st) => st.id === r.stationId))
            throw new Error(
              `${s.name}: effect targets unknown station ${r.stationId}.`,
            );
    };
    for (const p of s.parts) p.levels.forEach(checkEffects);
    for (const st of s.stations) {
      unique(
        st.actions.map((a) => a.id),
        "action",
      );
      for (const a of st.actions)
        if (a.kind === "effects") {
          unique(
            a.effects.map((e) => e.id),
            "effect",
          );
          checkEffects(a.effects);
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
