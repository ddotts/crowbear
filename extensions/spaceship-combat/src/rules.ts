export type Ammunition = { name: string; current: number; capacity: number };
export type Stats = { ac: number; maxG: number; speed: number };
export type RollEffect = {
  stationId?: string;
  rollType?: string;
  modifier?: number;
  advantage?: number;
  disadvantage?: number;
};
export type EffectState = {
  removed?: boolean;
  unit?: "rounds" | "crewTurns";
  remaining?: number;
  trigger?: string;
};
export type Effect = {
  id: string;
  name: string;
  description?: string;
  type?: string;
  duration?: { unit: "rounds" | "crewTurns"; count: number };
  disableStations?: string[];
  stats?: Partial<Stats>;
  rolls?: RollEffect[];
  cooldowns?: { stationId?: string; actionType?: string; modifier: number }[];
  categories?: { stationId?: string; actionId?: string; modifier: number }[];
};
export type Roll = {
  label: string;
  type: string;
  notation: string;
  kind?: "hitRoll" | "effectRoll";
  damage?: boolean;
};
export type RollOverride = "advantage" | "disadvantage" | "normal";
type ActionBase = {
  id: string;
  name: string;
  description?: string;
  cooldown?: number | number[];
  cooldownName?: string;
  values?: { name: string; value: string | number }[];
  ammunition?: { name: string; cost?: number };
  requiresEffects?: string[];
  gs?: { amount: number; on?: "activation" | "button" };
  grantsEffects?: Effect[];
  shipSelector?: boolean;
  activationRoll?: Roll;
};
export type Action = ActionBase &
  (
    | {
        kind: "roll";
        type: string;
        rolls: Roll[];
        activation?: "use";
        savingThrow?: boolean;
      }
    | { kind: "effects"; effects: Effect[] }
    | { kind: "remove-effect"; effectType: string }
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
  initiativeRoll?: string;
  initiative?: number | null;
  initiativeToken?: string | null;
  effectTrigger?: string;
};
export type Station = {
  id: string;
  name: string;
  type: string;
  seats: (string | null)[];
  actions: Action[];
  selectedEffects: Record<string, string[]>;
  cooldowns?: Record<string, number[]>;
};
export type Part = {
  name: string;
  damage: number;
  levels: Effect[][];
  applied: Record<number, string>;
};
export type PendingSelection = {
  id: string;
  stationId: string;
  actionId: string;
  crewId: string;
  kind: "target" | "remove";
  effects?: Effect[];
  effectType?: string;
  trigger?: string;
};
export type Ship = {
  id: string;
  name: string;
  kind: "Player" | "NPC";
  class: string;
  stats: Stats;
  gs?: number;
  effectStates?: Record<string, EffectState>;
  receivedEffects?: { id: string; effect: Effect }[];
  pendingSelections?: PendingSelection[];
  ammunition?: Ammunition[];
  parts: Part[];
  stations: Station[];
};
export function ammunitionPool(ship: Ship, action: Action) {
  return ship.ammunition?.find((pool) => pool.name === action.ammunition?.name);
}
export function ammunitionAvailable(ship: Ship, action: Action) {
  return (
    !action.ammunition ||
    (ammunitionPool(ship, action)?.current ?? 0) >=
      (action.ammunition.cost ?? 1)
  );
}
export function requiresSelection(action: Action) {
  return action.kind === "remove-effect" || Boolean(action.shipSelector);
}
export function activationRolls(action: Action): Roll[] {
  if (action.activationRoll)
    return [
      {
        ...action.activationRoll,
        kind: action.activationRoll.kind ?? "hitRoll",
      },
    ];
  return action.kind === "roll" && requiresSelection(action)
    ? actionRolls(action).filter((r) => r.kind === "hitRoll")
    : [];
}
export function activationType(action: Action) {
  return action.kind === "roll"
    ? action.type
    : (action.activationRoll?.type ?? "");
}
export function separateActivation(action: Action) {
  return (
    action.kind === "utility" ||
    action.kind === "remove-effect" ||
    (action.kind === "roll" && action.activation === "use")
  );
}
export function spendAmmunition(ship: Ship, action: Action) {
  if (!action.ammunition) return;
  const pool = ammunitionPool(ship, action);
  if (!pool)
    throw new Error(
      `Ammunition pool "${action.ammunition.name}" is unavailable on this ship.`,
    );
  const cost = action.ammunition.cost ?? 1;
  if (pool.current < cost)
    throw new Error(
      `Not enough ${pool.name}: need ${cost}, have ${pool.current}.`,
    );
  pool.current -= cost;
}
export function startCooldown(
  ship: Ship,
  station: Station,
  action: Action,
  forced = false,
) {
  const slot = availableCooldown(ship, station, action, forced);
  if (!slot) return;
  station.cooldowns ??= {};
  const remaining = cooldownSlots(ship, station, action).map(
    (value) => value.remaining,
  );
  remaining[slot.index] = slot.duration;
  if (remaining.some((value) => value > 0))
    station.cooldowns[cooldownKey(action)] = remaining;
  else delete station.cooldowns[cooldownKey(action)];
}
export function effectEntries(ship: Ship) {
  return [
    ...(ship.receivedEffects ?? []).map(({ id, effect }) => ({
      effect,
      key: `received:${id}`,
      source: "Action effect",
      station: undefined as Station | undefined,
      actionId: undefined as string | undefined,
    })),
    ...ship.parts.flatMap((part, partIndex) =>
      part.levels.slice(0, part.damage).flatMap((options, index) => {
        const effect = options.find(
          (effect) => effect.id === part.applied[index + 1],
        );
        return effect
          ? [
              {
                effect,
                source: `${part.name} · damage ${index + 1}`,
                key: `damage:${partIndex}:${index + 1}`,
                station: undefined as Station | undefined,
                actionId: undefined as string | undefined,
              },
            ]
          : [];
      }),
    ),
    ...ship.stations.flatMap((station) =>
      station.actions.flatMap((action) =>
        action.kind === "effects"
          ? action.effects
              .filter((effect) =>
                station.selectedEffects[action.id]?.includes(effect.id),
              )
              .map((effect) => ({
                effect,
                source: `${station.name} · ${action.name}`,
                key: `station:${station.id}:${action.id}:${effect.id}`,
                station,
                actionId: action.id,
              }))
          : [],
      ),
    ),
  ];
}
export function activeEffects(ship: Ship) {
  return effectEntries(ship).filter(
    (entry) => !ship.effectStates?.[entry.key]?.removed,
  );
}
export function effectDefinitions(ship: Ship) {
  return [
    ...(ship.receivedEffects ?? []).map((entry) => entry.effect),
    ...ship.parts.flatMap((part) => part.levels.flat()),
    ...ship.stations.flatMap((station) =>
      station.actions.flatMap((action) => [
        ...(action.kind === "effects" ? action.effects : []),
        ...(action.grantsEffects ?? []),
      ]),
    ),
  ];
}
export function assertEffectTargets(ship: Ship, effect: Effect, crew: Crew[]) {
  for (const stationId of [
    ...(effect.disableStations ?? []),
    ...[
      ...(effect.rolls ?? []),
      ...(effect.cooldowns ?? []),
      ...(effect.categories ?? []),
    ].flatMap((rule) => (rule.stationId ? [rule.stationId] : [])),
  ])
    if (!ship.stations.some((station) => station.id === stationId))
      throw new Error(
        `${ship.name}: effect targets unknown station ${stationId}.`,
      );
  for (const rule of effect.categories ?? []) {
    if (!rule.actionId) continue;
    const stations = ship.stations.filter(
      (st) => !rule.stationId || rule.stationId === st.id,
    );
    if (
      !stations.some((st) =>
        [
          ...st.actions,
          ...crew.flatMap((c) => c.stationActions[st.id] ?? []),
        ].some((a) => a.id === rule.actionId),
      )
    )
      throw new Error(
        `${ship.name}: CAT effect targets unknown action ${rule.actionId}.`,
      );
  }
}
export function activateEffect(
  ship: Ship,
  key: string,
  effect: Effect,
  trigger?: string,
) {
  ship.effectStates ??= {};
  if (!effect.duration) {
    delete ship.effectStates[key];
    return;
  }
  if (effect.duration.unit === "crewTurns" && !trigger)
    throw new Error(
      "Choose the triggering crew member for this turn-based effect.",
    );
  ship.effectStates[key] = {
    unit: effect.duration.unit,
    remaining: effect.duration.count,
    ...(trigger ? { trigger } : {}),
  };
}
export function removeEffect(ship: Ship, key: string) {
  const entry = activeEffects(ship).find((entry) => entry.key === key);
  if (!entry) throw new Error("That effect is no longer active.");
  if (key.startsWith("received:")) {
    ship.receivedEffects = ship.receivedEffects?.filter(
      (received) => `received:${received.id}` !== key,
    );
    if (ship.effectStates) delete ship.effectStates[key];
  } else if (entry.station && entry.actionId) {
    entry.station.selectedEffects[entry.actionId] =
      entry.station.selectedEffects[entry.actionId].filter(
        (id) => id !== entry.effect.id,
      );
    if (ship.effectStates) delete ship.effectStates[key];
  } else {
    ship.effectStates ??= {};
    ship.effectStates[key] = { removed: true };
  }
}
export function tickEffects(
  ships: Ship[],
  unit: "rounds" | "crewTurns",
  triggers: string[] = [],
) {
  for (const ship of ships)
    for (const entry of activeEffects(ship)) {
      const timer = ship.effectStates?.[entry.key];
      if (
        timer?.unit !== unit ||
        timer.remaining === undefined ||
        (unit === "crewTurns" && !triggers.includes(timer.trigger ?? ""))
      )
        continue;
      if (timer.remaining <= 1) removeEffect(ship, entry.key);
      else timer.remaining--;
    }
}
export function missingEffects(ship: Ship, action: Action) {
  const active = activeEffects(ship),
    definitions = effectDefinitions(ship);
  return (action.requiresEffects ?? [])
    .filter((id) => !active.some((entry) => entry.effect.id === id))
    .map((id) => definitions.find((effect) => effect.id === id)?.name ?? id);
}
export function rollBlockers(ship: Ship, station: Station) {
  return activeEffects(ship)
    .filter((entry) => entry.effect.disableStations?.includes(station.id))
    .map((entry) => entry.effect.name);
}
export function changeGs(ship: Ship, amount: number) {
  ship.gs = Math.max(0, (ship.gs ?? 0) + amount);
}
export function activateGs(ship: Ship, action: Action) {
  if (action.gs && action.gs.on !== "button") changeGs(ship, action.gs.amount);
}
export function isSavingThrow(action: Action) {
  return action.kind === "roll" && action.savingThrow === true;
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
export function actionRolls(action: Action): Roll[] {
  return action.kind === "roll"
    ? action.rolls.map((roll, index) => ({
        ...roll,
        kind: roll.kind ?? (index === 0 ? "hitRoll" : "effectRoll"),
      }))
    : [];
}
export function rollAdjustments(
  ship: Ship,
  station: Station,
  actionType: string,
  roll: Roll,
  crew: Crew,
) {
  let modifier =
    roll.kind === "effectRoll"
      ? 0
      : Object.hasOwn(crew.modifiers, actionType)
        ? crew.modifiers[actionType]
        : 0;
  let advantage = 0;
  for (const { effect } of activeEffects(ship))
    for (const rule of effect.rolls ?? []) {
      if (rule.stationId !== undefined && rule.stationId !== station.id)
        continue;
      if (rule.rollType !== undefined && rule.rollType !== roll.type) continue;
      modifier += rule.modifier ?? 0;
      if (roll.kind !== "effectRoll")
        advantage += (rule.advantage ?? 0) - (rule.disadvantage ?? 0);
    }
  return { modifier, advantage };
}
const categoryDice = [4, 6, 8, 10, 12];
export function isDamageRoll(roll: Roll) {
  return roll.damage ?? roll.kind === "effectRoll";
}
export function baseCategory(roll: Roll) {
  if (!isDamageRoll(roll)) return undefined;
  const pools = [...roll.notation.matchAll(/\b\d*d(\d+)/gi)];
  const sides = Number(pools[0]?.[1]);
  const index = categoryDice.indexOf(sides);
  return pools.length &&
    index >= 0 &&
    pools.every((pool) => Number(pool[1]) === sides)
    ? index + 1
    : undefined;
}
export function damageCategory(
  ship: Ship,
  station: Station,
  actionId: string,
  roll: Roll,
  shift = 0,
) {
  const base = baseCategory(roll);
  if (base === undefined) return undefined;
  let modifier = 0;
  for (const { effect } of activeEffects(ship))
    for (const rule of effect.categories ?? []) {
      if (rule.stationId && rule.stationId !== station.id) continue;
      if (rule.actionId && rule.actionId !== actionId) continue;
      modifier += rule.modifier;
    }
  return Math.max(
    1,
    Math.min(5, Math.max(1, Math.min(5, base - modifier)) - shift),
  );
}
export function categoryDie(category: number) {
  return categoryDice[category - 1];
}
export function rollNotation(
  ship: Ship,
  station: Station,
  actionType: string,
  roll: Roll,
  crew: Crew,
  override?: RollOverride,
  actionId = "",
  categoryShift = 0,
) {
  const adjusted = rollAdjustments(ship, station, actionType, roll, crew);
  const advantage = override
    ? override === "advantage"
      ? 1
      : override === "disadvantage"
        ? -1
        : 0
    : adjusted.advantage;
  let notation = roll.notation;
  if (categoryShift && !isDamageRoll(roll))
    throw new Error("CAT overrides require a damage roll.");
  const category = damageCategory(ship, station, actionId, roll, categoryShift);
  if (categoryShift && category === undefined)
    throw new Error(
      "CAT needs damage dice of one size: d4, d6, d8, d10 or d12.",
    );
  if (category !== undefined)
    notation = notation.replace(
      /\b(\d*)d\d+/gi,
      (_, count) => `${count}d${categoryDie(category)}`,
    );
  if (advantage) {
    const pool = /^(\d*)d(\d+)$/i.exec(notation);
    if (!pool)
      throw new Error(
        "Effect advantage requires a plain dice pool, such as 2d6. Split complex formulas into separate rolls.",
      );
    const count = Number(pool[1] || 1);
    notation = `${count + Math.abs(advantage)}d${pool[2]}${advantage > 0 ? "kh" : "kl"}${count}`;
  }
  if (adjusted.modifier)
    notation +=
      adjusted.modifier > 0
        ? `+${adjusted.modifier}`
        : String(adjusted.modifier);
  return notation;
}
export function cooldownKey(action: Action) {
  return action.cooldownName ? `named:${action.cooldownName}` : action.id;
}
export function cooldownDurations(
  ship: Ship,
  station: Station,
  action: Action,
) {
  if (action.kind === "effects" || action.cooldown === undefined) return [];
  const durations = Array.isArray(action.cooldown)
    ? action.cooldown
    : [action.cooldown];
  let modifier = 0;
  for (const { effect } of activeEffects(ship))
    for (const rule of effect.cooldowns ?? []) {
      if (rule.stationId && rule.stationId !== station.id) continue;
      if (
        rule.actionType &&
        (action.kind !== "roll" || rule.actionType !== action.type)
      )
        continue;
      modifier += rule.modifier;
    }
  return durations.map((duration) => Math.max(0, duration + modifier));
}
export function cooldownSlots(ship: Ship, station: Station, action: Action) {
  return cooldownDurations(ship, station, action).map((duration, index) => ({
    index,
    duration,
    remaining: station.cooldowns?.[cooldownKey(action)]?.[index] ?? 0,
  }));
}
export function availableCooldown(
  ship: Ship,
  station: Station,
  action: Action,
  forced = false,
) {
  const slots = cooldownSlots(ship, station, action);
  const ready = slots
    .filter((slot) => slot.remaining === 0)
    .sort((a, b) => a.duration - b.duration || a.index - b.index);
  return (
    ready[0] ??
    (forced
      ? slots.sort(
          (a, b) =>
            a.remaining - b.remaining ||
            a.duration - b.duration ||
            a.index - b.index,
        )[0]
      : undefined)
  );
}
export function cooldownBlocked(ship: Ship, station: Station, action: Action) {
  const slots = cooldownSlots(ship, station, action);
  return slots.length > 0 && slots.every((slot) => slot.remaining > 0);
}
export function tickCooldowns(ships: Ship[]) {
  for (const ship of ships)
    for (const station of ship.stations)
      for (const [id, remaining] of Object.entries(station.cooldowns ?? {})) {
        const next = remaining.map((value) => Math.max(0, value - 1));
        if (next.every((value) => value === 0)) delete station.cooldowns?.[id];
        else if (station.cooldowns) station.cooldowns[id] = next;
      }
}
/** Mixed effects deliberately keep both signs instead of implying a net benefit. */
export function effectTone(
  effect: Effect,
): "positive" | "negative" | "mixed" | "neutral" {
  const values = [
    ...Object.values(effect.stats ?? {}),
    ...(effect.categories ?? []).map((rule) => rule.modifier),
    ...(effect.disableStations?.length ? [-1] : []),
    ...(effect.rolls ?? []).flatMap((rule) => [
      rule.modifier ?? 0,
      rule.advantage ?? 0,
      -(rule.disadvantage ?? 0),
    ]),
    ...(effect.cooldowns ?? []).map((rule) => -rule.modifier),
  ];
  const positive = values.some((value) => value > 0),
    negative = values.some((value) => value < 0);
  return positive && negative
    ? "mixed"
    : positive
      ? "positive"
      : negative
        ? "negative"
        : "neutral";
}
export function initiativeActors(
  ships: Ship[],
  crew: Crew[],
  shipIds: string[],
  rolledOnly = true,
) {
  return crew
    .flatMap((member) => {
      const vessel =
        ships.find((s) =>
          s.stations.some((st) => st.seats.includes(member.id)),
        ) ?? ships.find((s) => s.id === member.ship);
      return vessel &&
        shipIds.includes(vessel.id) &&
        (!rolledOnly || member.initiative != null)
        ? [{ crew: member, ship: vessel }]
        : [];
    })
    .sort(
      (a, b) =>
        (b.crew.initiative ?? -Infinity) - (a.crew.initiative ?? -Infinity) ||
        a.crew.id.localeCompare(b.crew.id),
    );
}
export function initiativeFormula(notation: string) {
  const match = /^(\d*)d(\d+)([+-]\d+)?$/i.exec(notation.replace(/\s/g, ""));
  if (!match)
    throw new Error(
      "Initiative uses NdS with an optional integer modifier, such as 1d20+2.",
    );
  const count = Number(match[1] || 1),
    sides = Number(match[2]),
    modifier = Number(match[3] || 0);
  if (
    count < 1 ||
    count > 100 ||
    sides < 2 ||
    sides > 1000000 ||
    !Number.isSafeInteger(modifier)
  )
    throw new Error("Initiative supports 1–100 dice with 2–1,000,000 sides.");
  return { count, sides, modifier };
}
export function randomInitiative(
  notation: string,
  die: (sides: number) => number = (sides) => {
    const buffer = new Uint32Array(1),
      limit = 0x100000000 - (0x100000000 % sides);
    do {
      crypto.getRandomValues(buffer);
    } while (buffer[0] >= limit);
    return (buffer[0] % sides) + 1;
  },
) {
  const { count, sides, modifier } = initiativeFormula(notation);
  return Array.from({ length: count }, () => die(sides)).reduce(
    (sum, value) => sum + value,
    modifier,
  );
}
export function effectSummary(effect: Effect) {
  const signed = (n: number) => (n > 0 ? `+${n}` : String(n));
  return [
    ...(effect.disableStations ?? []).map((id) => `${id}: all rolls disabled`),
    ...Object.entries(effect.stats ?? {}).map(
      ([key, n]) =>
        `${key === "ac" ? "AC" : key === "speed" ? "Speed" : "maxG"} ${signed(n)}${key === "speed" ? " km" : ""}`,
    ),
    ...(effect.categories ?? []).map(
      (r) =>
        `CAT ${r.modifier > 0 ? "improve" : "worsen"} ${Math.abs(r.modifier)} · ${r.stationId ?? "all stations"}${r.actionId ? ` / ${r.actionId}` : ""}`,
    ),
    ...(effect.cooldowns ?? []).map(
      (r) =>
        `Cooldown ${r.stationId ?? "all stations"}${r.actionType ? ` / ${r.actionType}` : ""}: ${signed(r.modifier)}`,
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
