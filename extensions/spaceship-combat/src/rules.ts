export type Stats = { ac: number; maxG: number; speed: number };
export type RollEffect = {
  stationId?: string;
  rollType?: string;
  modifier?: number;
  advantage?: number;
  disadvantage?: number;
};
export type Effect = {
  id: string;
  name: string;
  description?: string;
  stats?: Partial<Stats>;
  rolls?: RollEffect[];
};
export type Roll = { label: string; type: string; notation: string };
type ActionBase = { id: string; name: string; description?: string };
export type Action = ActionBase &
  (
    | { kind: "roll"; type: string; rolls: Roll[] }
    | { kind: "effects"; effects: Effect[] }
    | { kind: "utility" }
  );
export type Crew = {
  id: string;
  name: string;
  role: string;
  ship: string;
  disabled: boolean;
  modifiers: Record<string, number>;
  stationActions: Record<string, Action[]>;
};
export type Station = {
  id: string;
  name: string;
  type: string;
  seats: (string | null)[];
  actions: Action[];
  selectedEffects: Record<string, string[]>;
};
export type Part = {
  name: string;
  damage: number;
  levels: Effect[][];
  applied: Record<number, string>;
};
export type Ship = {
  id: string;
  name: string;
  kind: "Player" | "NPC";
  class: string;
  initiative: number;
  stats: Stats;
  parts: Part[];
  stations: Station[];
};
export function activeEffects(
  ship: Ship,
): { effect: Effect; source: string }[] {
  return [
    ...ship.parts.flatMap((part) =>
      part.levels.slice(0, part.damage).flatMap((options, index) => {
        const effect = options.find((e) => e.id === part.applied[index + 1]);
        return effect
          ? [{ effect, source: `${part.name} · damage ${index + 1}` }]
          : [];
      }),
    ),
    ...ship.stations.flatMap((station) =>
      station.actions.flatMap((action) =>
        action.kind === "effects"
          ? action.effects
              .filter((e) => station.selectedEffects[action.id]?.includes(e.id))
              .map((effect) => ({
                effect,
                source: `${station.name} · ${action.name}`,
              }))
          : [],
      ),
    ),
  ];
}
export function effectiveStats(ship: Ship): Stats {
  const result = { ...ship.stats };
  for (const { effect } of activeEffects(ship)) {
    for (const stat of ["ac", "maxG", "speed"] as const)
      result[stat] += effect.stats?.[stat] ?? 0;
  }
  return result;
}
/** No mutation until a required choice is supplied and validated. */
export function applyDamage(
  part: Part,
  choice?: string,
): "applied" | "choose" | "max" {
  if (part.damage === part.levels.length) return "max";
  const options = part.levels[part.damage];
  if (options.length > 1 && !choice) return "choose";
  const selected =
    options.length === 1 ? options[0] : options.find((e) => e.id === choice);
  if (options.length > 1 && !selected)
    throw new Error("Select an effect from this damage level.");
  part.damage++;
  if (selected) part.applied[part.damage] = selected.id;
  return "applied";
}
export function repairDamage(part: Part) {
  if (!part.damage) return;
  delete part.applied[part.damage];
  part.damage--;
}
export function usableCrew(station: Station, crew: Crew[]) {
  return crew.some((c) => station.seats.includes(c.id) && !c.disabled);
}
export function selectStationEffects(
  station: Station,
  actionId: string,
  choices: string[],
  crew: Crew[],
) {
  if (!usableCrew(station, crew))
    throw new Error(
      "Seat an enabled crew member at this station to change its effects.",
    );
  const action = station.actions.find((a) => a.id === actionId);
  if (!action || action.kind !== "effects")
    throw new Error("This action does not select effects.");
  if (choices.some((id) => !action.effects.some((e) => e.id === id)))
    throw new Error("Choose effects offered by this action.");
  station.selectedEffects[action.id] = [...new Set(choices)];
}
export function rollNotation(
  ship: Ship,
  station: Station,
  actionType: string,
  roll: Roll,
  crew: Crew,
) {
  let modifier = Object.hasOwn(crew.modifiers, actionType)
    ? crew.modifiers[actionType]
    : 0;
  let advantage = 0;
  for (const { effect } of activeEffects(ship))
    for (const rule of effect.rolls ?? []) {
      if (rule.stationId !== undefined && rule.stationId !== station.id)
        continue;
      if (rule.rollType !== undefined && rule.rollType !== roll.type) continue;
      modifier += rule.modifier ?? 0;
      advantage += (rule.advantage ?? 0) - (rule.disadvantage ?? 0);
    }
  let notation = roll.notation;
  if (advantage) {
    // Dice+ pool advantage: add dice, then keep the original count.
    const pool = /^(\d*)d(\d+)$/i.exec(notation);
    if (!pool)
      throw new Error(
        "Effect advantage requires a plain dice pool (e.g. 2d6) for effect advantage. Split complex formulas into separate rolls.",
      );
    const count = Number(pool[1] || 1);
    notation = `${count + Math.abs(advantage)}d${pool[2]}${advantage > 0 ? "kh" : "kl"}${count}`;
  }
  if (modifier) notation += modifier > 0 ? `+${modifier}` : String(modifier);
  return notation;
}
export function effectSummary(effect: Effect) {
  const signed = (n: number) => (n > 0 ? `+${n}` : String(n));
  return [
    ...Object.entries(effect.stats ?? {}).map(
      ([key, n]) =>
        `${key === "ac" ? "AC" : key === "speed" ? "Speed" : "maxG"} ${signed(n)}${key === "speed" ? " km" : ""}`,
    ),
    ...(effect.rolls ?? []).map(
      (r) =>
        `${r.stationId ?? "All stations"}${r.rollType ? ` / ${r.rollType}` : ""}: ${[r.modifier ? signed(r.modifier) : "", r.advantage ? `advantage ${r.advantage}` : "", r.disadvantage ? `disadvantage ${r.disadvantage}` : ""].filter(Boolean).join(", ")}`,
    ),
  ].join(" · ");
}

export function crewActions(st: Station, c: Crew): Action[] {
  return [
    ...st.actions.filter((a) => a.kind !== "effects"),
    ...(c.stationActions[st.id] ?? []),
  ];
}
