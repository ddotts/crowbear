import type { Action, Crew, Effect, Part, Ship, Station } from "./rules";

function ability(
  station: string,
  name: string,
  type: string,
  rollType: string,
): Record<string, Action[]> {
  return {
    [station]: [
      {
        id: "crew-ability",
        kind: "roll",
        name,
        type,
        rolls: [{ label: name, type: rollType, notation: "2d6" }],
        ...(station === "weapons"
          ? { ammunition: { name: "Cannon rounds", cost: 1 } }
          : {}),
        description:
          "**Crew ability.** Available while this crew member occupies a matching station.",
      },
    ],
  };
}

export const crew: Crew[] = [
  {
    id: "mara",
    name: "Mara Voss",
    role: "Pilot · You",
    ship: "kestrel",
    initiativeRoll: "1d20+2",
    initiative: null,
    disabled: false,
    modifiers: { Piloting: 4, Gunnery: 1, Engineering: 0 },
    stationActions: ability("helm", "Evasive maneuver", "Piloting", "Maneuver"),
  },
  {
    id: "ivo",
    name: "Ivo Chen",
    role: "Gunner",
    ship: "kestrel",
    initiativeRoll: "1d20+2",
    initiative: null,
    disabled: false,
    modifiers: { Piloting: 1, Gunnery: 3, Engineering: 2 },
    stationActions: ability("weapons", "Called shot", "Gunnery", "Attack"),
  },
  {
    id: "sol",
    name: "Sol Reyes",
    role: "Engineer",
    ship: "kestrel",
    initiativeRoll: "1d20+1",
    initiative: null,
    disabled: true,
    modifiers: { Piloting: 0, Gunnery: 1, Engineering: 5 },
    stationActions: ability(
      "engineering",
      "Emergency patch",
      "Engineering",
      "Repair",
    ),
  },
  {
    id: "raider",
    name: "Raider pilot",
    role: "NPC crew",
    ship: "shrike",
    initiativeRoll: "1d20+2",
    initiative: null,
    disabled: false,
    modifiers: { Piloting: 2, Gunnery: 2, Engineering: 0 },
    stationActions: ability("helm", "Evasive maneuver", "Piloting", "Maneuver"),
  },
  {
    id: "captain",
    name: "Patrol captain",
    role: "NPC crew",
    ship: "warden",
    initiativeRoll: "1d20+2",
    initiative: null,
    disabled: false,
    modifiers: { Piloting: 3, Gunnery: 2, Engineering: 1 },
    stationActions: ability("helm", "Evasive maneuver", "Piloting", "Maneuver"),
  },
];
const scorched: Effect = {
  id: "scorched",
  name: "Scorched plating",
  type: "Damage",
  stats: { ac: -1 },
  description:
    "The outer armour is **weakened**.\n\n- AC is reduced by 1.\n- Repair this damage level to restore it.",
};
const coolant: Effect = {
  id: "coolant",
  name: "Coolant leak",
  type: "Malfunction",
  stats: { maxG: -1, speed: -100 },
  description: "A leaking cooling loop limits **acceleration** and *speed*.",
};
const misaligned: Effect = {
  id: "misaligned",
  name: "Misaligned weapons",
  type: "Malfunction",
  rolls: [{ stationId: "weapons", modifier: -1 }],
  description:
    "Every roll at **Weapons** takes a −1 modifier, including damage.",
};
function parts(): Part[] {
  return [
    {
      name: "Hull",
      damage: 1,
      applied: { 1: scorched.id },
      levels: [
        [scorched],
        [
          {
            id: "buckled",
            name: "Buckled armour",
            stats: { ac: -2 },
            description: "The armour buckles. **AC −2** until repaired.",
          },
          {
            id: "drag",
            name: "Structural drag",
            stats: { speed: -50 },
            rolls: [
              { stationId: "helm", rollType: "Maneuver", disadvantage: 1 },
            ],
            description:
              "A bent frame reduces speed by **50 km** and imposes disadvantage on **Helm / Maneuver** rolls.",
          },
        ],
        [],
        [{ id: "breach", name: "Hull breach", stats: { ac: -3 } }],
      ],
    },
    {
      name: "Engines",
      damage: 0,
      applied: {},
      levels: [
        [],
        [coolant],
        [
          {
            id: "stall",
            name: "Engine stall",
            stats: { maxG: -2, speed: -150 },
          },
        ],
      ],
    },
    {
      name: "Weapons",
      damage: 0,
      applied: {},
      levels: [
        [misaligned],
        [
          {
            id: "tracking",
            name: "Tracking fault",
            rolls: [{ rollType: "Attack", disadvantage: 1 }],
            description:
              "All **Attack** rolls have disadvantage, regardless of station.",
          },
          {
            id: "feed",
            name: "Feed fault",
            rolls: [{ stationId: "weapons", rollType: "Damage", modifier: -2 }],
          },
        ],
        [],
      ],
    },
    {
      name: "Shields",
      damage: 2,
      applied: { 1: "coverage", 2: "flicker" },
      levels: [
        [{ id: "coverage", name: "Reduced coverage", stats: { ac: -1 } }],
        [
          {
            id: "flicker",
            name: "Shield flicker",
            stats: { ac: -1 },
            description:
              "Intermittent shields leave the ship exposed. **AC −1**.",
          },
        ],
        [],
      ],
    },
  ];
}
function stations(pilot: string): Station[] {
  return [
    {
      id: "helm",
      name: "Helm",
      type: "Piloting",
      seats: [pilot],
      selectedEffects: {},
      actions: [
        {
          id: "course",
          kind: "roll",
          name: "Change course",
          gs: { amount: 1 },
          ammunition: { name: "Autonomy", cost: 1 },
          type: "Piloting",
          rolls: [{ label: "Maneuver", type: "Maneuver", notation: "2d6" }],
          description:
            "Plot a new course. Roll **Piloting** and apply any active maneuver effects.\n\n> Your crew modifier is already included in the preview.",
        },
        { id: "hold", kind: "utility", name: "Hold position" },
        {
          id: "accelerate",
          kind: "utility",
          name: "Accelerate",
          gs: { amount: 1 },
          description:
            "Add **1 G** when activated. Gs may exceed maxG; the status indicator then turns red.",
        },
        {
          id: "trim-gs",
          kind: "utility",
          name: "Reduce thrust",
          gs: { amount: -1, on: "button" },
          description:
            "Use the explicit button to remove **1 G**, down to zero.",
        },
        {
          id: "clear-fault",
          kind: "remove-effect",
          name: "Clear fault",
          activationRoll: {
            label: "Repair",
            type: "Piloting",
            notation: "1d6",
          },
          ammunition: { name: "Autonomy", cost: 1 },
          cooldown: 2,
          effectType: "Malfunction",
          description:
            "Activate to roll Repair and spend Autonomy/cooldown, then choose one active **Malfunction** effect to remove without repairing damage. Cancel does not refund resources.",
        },
        {
          id: "g-save",
          kind: "roll",
          name: "G resilience",
          type: "Piloting",
          savingThrow: true,
          rolls: [{ label: "Save", type: "Saving throw", notation: "1d6" }],
          description:
            "A station-specific **saving throw**, available in compact ship status. Includes the seated crew member's Piloting modifier.",
        },
        {
          id: "support",
          kind: "utility",
          name: "Guided fire",
          activationRoll: {
            label: "Support",
            type: "Piloting",
            notation: "1d6",
          },
          shipSelector: true,
          cooldown: 2,
          grantsEffects: [
            {
              id: "guided-fire",
              name: "Guided fire",
              type: "Support",
              duration: { unit: "rounds", count: 2 },
              categories: [{ modifier: 1 }],
              description:
                "Improves all damage rolls by one CAT step (smaller number and die).",
            },
          ],
          description:
            "**Use** rolls Support and starts cooldown, then choose a ship to receive two rounds of improved damage CAT. Cancel keeps the spent cooldown. Repeated activations create separate effects.",
        },
        {
          id: "travel",
          kind: "utility",
          name: "Travel",
          ammunition: { name: "Autonomy", cost: 7 },
          description: "Spend **7 Autonomy** without rolling.",
        },
        {
          id: "flight-mode",
          kind: "effects",
          name: "Flight configuration",
          description:
            "Select any combination of flight modes.\n\nThe configuration **belongs to the station** and stays active when its crew leaves. Only enabled crew seated here can change it.",
          effects: [
            {
              id: "ion-lock",
              name: "Ionised controls",
              type: "Malfunction",
              duration: { unit: "rounds", count: 2 },
              disableStations: ["helm", "weapons"],
              description:
                "Disable all rolls at **Helm** and **Weapons** for two rounds. Forced rolls remain a deliberate override.",
            },
            {
              id: "steady",
              name: "Steady flight",
              type: "Stance",
              duration: { unit: "crewTurns", count: 2 },
              stats: { ac: 1 },
              description:
                "**AC +1** until the start of the triggering crew member's second upcoming turn.",
            },
            {
              id: "evasive",
              name: "Evasive flight",
              stats: { ac: 2 },
              rolls: [{ rollType: "Attack", disadvantage: 1 }],
              description:
                "**AC +2** at the cost of disadvantage on every **Attack** roll.",
            },
            {
              id: "boost",
              name: "Boost",
              stats: { maxG: 1, speed: 100 },
              rolls: [{ stationId: "weapons", disadvantage: 1 }],
              cooldowns: [{ stationId: "weapons", modifier: 1 }],
              description:
                "- maxG **+1**\n- Speed **+100 km**\n- Disadvantage on all rolls at **Weapons**",
            },
          ],
        },
      ],
    },
    {
      id: "weapons",
      name: "Weapons",
      type: "Gunnery",
      seats: [pilot === "mara" ? "ivo" : null, null],
      selectedEffects: {},
      actions: [
        {
          id: "fire",
          kind: "roll",
          name: "Fire cannons",
          values: [
            { name: "Range", value: "12 km" },
            { name: "Projectile", value: "4 km/s" },
          ],
          ammunition: { name: "Cannon rounds", cost: 1 },
          cooldown: [2, 3],
          type: "Gunnery",
          description:
            "Roll **Attack** and **Damage** independently. Effects can target either roll type.\n\n| Roll | Base |\n| --- | --- |\n| Attack | 2d6 |\n| Damage | 1d6 |",
          rolls: [
            { label: "Hit", type: "Attack", notation: "2d6" },
            { label: "Damage", type: "Damage", notation: "1d6" },
          ],
        },
        {
          id: "lock",
          kind: "roll",
          name: "Target lock",
          type: "Gunnery",
          rolls: [{ label: "Lock", type: "Targeting", notation: "1d6" }],
        },
        {
          id: "torpedo",
          kind: "roll",
          name: "Launch torpedo",
          cooldownName: "launchers",
          values: [
            { name: "Range", value: "80 km" },
            { name: "Speed", value: "2 km/s" },
          ],
          type: "Gunnery",
          activation: "use",
          cooldown: 2,
          ammunition: { name: "Torpedoes", cost: 1 },
          description:
            "**Use** launches a torpedo and starts the cooldown. Resolve **Hit** and **Damage** later without spending ammunition again, even after the last torpedo is launched.",
          rolls: [
            { label: "Hit", type: "Attack", notation: "2d6" },
            { label: "Damage", type: "Damage", notation: "3d6" },
          ],
        },
        {
          id: "torpedo-salvo",
          kind: "roll",
          name: "Torpedo salvo",
          type: "Gunnery",
          activation: "use",
          cooldownName: "launchers",
          cooldown: 2,
          ammunition: { name: "Torpedoes", cost: 2 },
          values: [
            { name: "Range", value: "80 km" },
            { name: "Speed", value: "2 km/s" },
          ],
          description:
            "Launch two torpedoes. Shares the station's **launchers** cooldown with Launch torpedo.",
          rolls: [
            { label: "Hit", type: "Attack", notation: "2d6" },
            { label: "Damage", type: "Damage", notation: "6d6" },
          ],
        },
        {
          id: "focused-burst",
          kind: "roll",
          name: "Focused burst",
          type: "Gunnery",
          requiresEffects: ["focus"],
          rolls: [{ label: "Hit", type: "Attack", notation: "2d6" }],
          description: "Requires **Focused targeting** to be active.",
        },
        {
          id: "target-mode",
          kind: "effects",
          name: "Targeting configuration",
          effects: [
            {
              id: "focus",
              name: "Focused targeting",
              type: "Targeting",
              rolls: [
                { stationId: "weapons", rollType: "Attack", advantage: 1 },
              ],
              description:
                "Advantage applies to **Weapons / Attack** only. Damage and targeting rolls are unchanged.",
            },
            {
              id: "precision-cat",
              name: "Precision cannon tuning",
              type: "Weapon",
              categories: [
                { stationId: "weapons", actionId: "fire", modifier: 1 },
              ],
              description: "Improves only Fire cannons damage by one CAT step.",
            },
            {
              id: "calibration",
              name: "Calibrated sights",
              cooldowns: [{ actionType: "Gunnery", modifier: -1 }],
              rolls: [{ rollType: "Attack", modifier: 2 }],
              description:
                "A **+2** modifier applies to Attack rolls at every station.",
            },
          ],
        },
      ],
    },
    {
      id: "engineering",
      name: "Engineering",
      type: "Engineering",
      seats: [pilot === "mara" ? "sol" : null],
      selectedEffects: {},
      actions: [
        {
          id: "repair",
          kind: "roll",
          name: "Repair system",
          type: "Engineering",
          rolls: [{ label: "Repair", type: "Repair", notation: "2d6" }],
        },
        {
          id: "power",
          kind: "effects",
          name: "Power allocation",
          description:
            "An enabled engineer must be seated here to change power allocation.",
          effects: [
            {
              id: "overdrive",
              name: "Engine overdrive",
              stats: { maxG: 2, speed: 150, ac: -1 },
            },
          ],
        },
      ],
    },
  ];
}
export const ships: Ship[] = [
  {
    id: "kestrel",
    name: "The Kestrel",
    kind: "Player",
    class: "Light freighter",

    gs: 0,
    ammunition: [
      { name: "Autonomy", current: 60, capacity: 80 },
      { name: "Cannon rounds", current: 40, capacity: 40 },
      { name: "Torpedoes", current: 3, capacity: 3 },
    ],
    stats: { ac: 15, maxG: 4, speed: 600 },
    parts: parts(),
    stations: stations("mara"),
  },
  {
    id: "shrike",
    name: "Red Shrike",
    kind: "NPC",
    class: "Raider interceptor",

    gs: 0,
    ammunition: [
      { name: "Autonomy", current: 60, capacity: 80 },
      { name: "Cannon rounds", current: 40, capacity: 40 },
      { name: "Torpedoes", current: 3, capacity: 3 },
    ],
    stats: { ac: 13, maxG: 6, speed: 900 },
    parts: parts().map((p) => ({ ...p, damage: 0, applied: {} })),
    stations: stations("raider"),
  },
  {
    id: "warden",
    name: "ISS Warden",
    kind: "NPC",
    class: "Patrol corvette",

    gs: 0,
    ammunition: [
      { name: "Autonomy", current: 60, capacity: 80 },
      { name: "Cannon rounds", current: 40, capacity: 40 },
      { name: "Torpedoes", current: 3, capacity: 3 },
    ],
    stats: { ac: 17, maxG: 3, speed: 450 },
    parts: parts().map((p) => ({ ...p, damage: 0, applied: {} })),
    stations: stations("captain"),
  },
];
