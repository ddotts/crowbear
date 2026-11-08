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
    disabled: false,
    modifiers: { Piloting: 4, Gunnery: 1, Engineering: 0 },
    stationActions: ability("helm", "Evasive maneuver", "Piloting", "Maneuver"),
  },
  {
    id: "ivo",
    name: "Ivo Chen",
    role: "Gunner",
    ship: "kestrel",
    disabled: false,
    modifiers: { Piloting: 1, Gunnery: 3, Engineering: 2 },
    stationActions: ability("weapons", "Called shot", "Gunnery", "Attack"),
  },
  {
    id: "sol",
    name: "Sol Reyes",
    role: "Engineer",
    ship: "kestrel",
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
    disabled: false,
    modifiers: { Piloting: 2, Gunnery: 2, Engineering: 0 },
    stationActions: ability("helm", "Evasive maneuver", "Piloting", "Maneuver"),
  },
  {
    id: "captain",
    name: "Patrol captain",
    role: "NPC crew",
    ship: "warden",
    disabled: false,
    modifiers: { Piloting: 3, Gunnery: 2, Engineering: 1 },
    stationActions: ability("helm", "Evasive maneuver", "Piloting", "Maneuver"),
  },
];
const scorched: Effect = {
  id: "scorched",
  name: "Scorched plating",
  stats: { ac: -1 },
  description:
    "The outer armour is **weakened**.\n\n- AC is reduced by 1.\n- Repair this damage level to restore it.",
};
const coolant: Effect = {
  id: "coolant",
  name: "Coolant leak",
  stats: { maxG: -1, speed: -100 },
  description: "A leaking cooling loop limits **acceleration** and *speed*.",
};
const misaligned: Effect = {
  id: "misaligned",
  name: "Misaligned weapons",
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
          type: "Piloting",
          rolls: [{ label: "Maneuver", type: "Maneuver", notation: "2d6" }],
          description:
            "Plot a new course. Roll **Piloting** and apply any active maneuver effects.\n\n> Your crew modifier is already included in the preview.",
        },
        { id: "hold", kind: "utility", name: "Hold position" },
        {
          id: "flight-mode",
          kind: "effects",
          name: "Flight configuration",
          description:
            "Select any combination of flight modes.\n\nThe configuration **belongs to the station** and stays active when its crew leaves. Only enabled crew seated here can change it.",
          effects: [
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
          id: "target-mode",
          kind: "effects",
          name: "Targeting configuration",
          effects: [
            {
              id: "focus",
              name: "Focused targeting",
              rolls: [
                { stationId: "weapons", rollType: "Attack", advantage: 1 },
              ],
              description:
                "Advantage applies to **Weapons / Attack** only. Damage and targeting rolls are unchanged.",
            },
            {
              id: "calibration",
              name: "Calibrated sights",
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
    initiative: 18,
    stats: { ac: 15, maxG: 4, speed: 600 },
    parts: parts(),
    stations: stations("mara"),
  },
  {
    id: "shrike",
    name: "Red Shrike",
    kind: "NPC",
    class: "Raider interceptor",
    initiative: 15,
    stats: { ac: 13, maxG: 6, speed: 900 },
    parts: parts().map((p) => ({ ...p, damage: 0, applied: {} })),
    stations: stations("raider"),
  },
  {
    id: "warden",
    name: "ISS Warden",
    kind: "NPC",
    class: "Patrol corvette",
    initiative: 11,
    stats: { ac: 17, maxG: 3, speed: 450 },
    parts: parts().map((p) => ({ ...p, damage: 0, applied: {} })),
    stations: stations("captain"),
  },
];
