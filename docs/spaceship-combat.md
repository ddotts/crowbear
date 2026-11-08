# Spaceship combat

The extension uses a 400 × 640 popover with inline damage and station controls.
Outside Owlbear, it runs an unsaved standalone demo with a role selector.
Inside Owlbear, the role comes from the SDK and cannot be switched in the panel.
The GM encounter view follows the active crew member's actions, with a separate
**Ship controls** view. Clicking a tracker row inspects another crew member;
**Active** returns to the current turn. Each ship has a distinct tracker colour, shared by its crew. Ship mates keep
their shared highlight, while the active crew has a thick leading marker and a
**NOW** badge. The tracker scrolls the active member into view when the current
turn or initiative order changes, and preserves its scroll through state updates. Players and
GM crew views include read-only compact ship stats, damage bars and expandable
active effects; clicking the ship name opens full status controls. Initiative
and seat switching share a toolbar, separated from station actions.

Hit and effect buttons share an action row and show the roll label and notation.
Action titles expand Markdown descriptions. Cooldown slots each have a bar,
remaining-round counter and ready checkmark. Advantage/disadvantage badges sit on
button edges. Effect rows use **+**, **−**, **±** or **•** to identify benefits,
penalties, mixed or unclassified effects; the sign is based on numerical rules,
not game-specific judgment. Their names expand scope, source and Markdown details.
Damage reference sections group levels by ship part. The disclosure controls
follow the [W3C disclosure pattern](https://www.w3.org/WAI/ARIA/apg/patterns/disclosure/).

The UI follows Owlbear theme changes; the standalone preview follows the system
or its light/dark selector. Descriptions render sanitized Markdown prose, lists,
links, tables, headings and code. Links open a new tab; embedded images, scripts
and form controls are excluded.

## Storage and collaboration

- Player ships, their base data, damage, station selections, seats, action cooldowns and player crew
  (including initiative totals)
  are stored under `com.ddotts.crowbear.spaceship-combat/state` in scene metadata.
  Changing scenes loads that scene's fleet. No room metadata is used.
- NPC ships/crew, saved encounters, their round/turn and the active encounter are
  stored in the controlling GM's browser local storage, keyed by room. Keep a
  JSON export as backup; private data does not follow the GM across devices.
- A background iframe remains loaded when the action popover closes. The GM who
  initializes the scene owns its controller. Commands are queued through that
  GM's background iframe, so independent player edits do not replace stale ship
  snapshots. A move into an occupied seat is rejected. An explicit seat
  reassignment can replace the seated crew member.
- Requests carry a scene session ID; requests from another scene are rejected.
  Sender connection IDs are checked against the party, and player commands
  cannot access NPCs, libraries or encounters. Request chunks remain below the
  documented 16 KB broadcast limit. Private imports use local broadcasts; only
  the player fleet is written to shared metadata.
- The controlling GM must remain connected. Players can inspect their scene's
  ships while the GM is offline, but cannot save changes. Returning GM tabs can
  reclaim a controller whose connection has left. Multiple GM accounts and
  private-library handover are not supported; a different GM sees shared data
  without acquiring control.
- Save errors are displayed. Corrupt or incompatible stored data is not silently
  reset. Commands are not automatically retried: a timeout may mean the write
  succeeded without its acknowledgement, so refresh and inspect before retrying.
  Library imports spanning both stores use a compensating private-store rollback
  if the scene save fails; browser and Owlbear storage cannot form one atomic
  transaction if the browser closes midway through a save.

Shared metadata and Owlbear broadcasts are cooperative extension resources, not
an authentication boundary against arbitrary other extensions. Private NPC data
is kept out of those resources; the supplied demo NPCs are public sample assets.

## Effects and rolls

A ship has base `stats.ac`, `stats.maxG` and `stats.speed` (km), plus current `gs`
(default zero). Active stat deltas add to those bases. Full and compact status
show **Gs** prominently, with the effective **maxG** as a smaller limit. Gs turn
red when strictly above maxG; equality is allowed. Effects that alter maxG change
the limit without changing current Gs.
Effects modify the ship on which they are active, including effects granted by
another ship. Stat values are not clamped or rounded.

Each damage section has `levels`, an array starting at damage level 1. Each level
contains zero or more effect alternatives. An empty level applies damage
immediately, a single alternative is selected automatically, and multiple
alternatives require a choice before the counter changes. Selected effects from
all damaged levels accumulate. The minus button repairs the highest damaged
level and removes that level's effect, if any. Damage is managed by these buttons;
station configuration actions do not apply or repair damage.

Actions have one of four `kind` values:

- `roll`: an action `type` for the crew modifier and one or more `rolls`. Each
  roll has a `label`, its own `type`, Dice+ `notation`, and `kind` of `hitRoll`
  or `effectRoll`. Hit rolls receive crew modifiers and automatic advantage or
  disadvantage. Effect rolls receive neither, and remain available during hit
  cooldowns. Both receive matching numerical effect modifiers. Buttons roll each
  independently. If `kind` is omitted, the first roll is a hit and later rolls
  are effects, preserving existing multi-roll definitions.
- `utility`: an action with a **Use** button and no dice. It can spend ammunition
  and start cooldowns; without either, it simply records use in the notice.
- `remove-effect`: activates first, then opens a dropdown of active effects
  matching its `effectType`. Confirmation removes the chosen instance. Optional
  `activationRoll`, ammunition and cooldowns are handled before selection.
- `effects`: a station-owned set of effect options. Any combination may be
  selected, including none. Selections are stored by action ID on the station,
  once for all seats, and survive crew replacement, removal and disabling.
  At least one enabled crew member must occupy that station to change selections.

A roll action with `savingThrow: true` appears as a compact button in the seated
crew member's ship status, including the GM's crew view. Buttons show the save
name and adjusted notation on one line and wrap as a group when needed. There is
no separate action title, description toggle or section heading. Saving throws
are excluded from normal action lists. Its modifiers, requirements, roll audience and
station blocking behave like other rolls; empty stations cannot supply a save.

Actions can define `gs: {"amount": 1, "on": "activation"}` (the default `on`) to
add Gs when activated, or `gs: {"amount": -1, "on": "button"}` for a separate Gs
button. Direct hit activation, separate Use and changed station configurations
apply activation Gs once. Previews and later hit/damage resolution of a separate
Use action do not apply them again. Explicit Gs buttons do not spend ammunition
or restart cooldowns. Current Gs clamp at zero when reduced, and may exceed maxG.

Actions can optionally provide always-visible `values`, for example:

```json
"values": [
  { "name": "Range", "value": "80 km" },
  { "name": "Speed", "value": "2 km/s" },
  { "name": "Recoil", "value": 0 }
]
```

These label/value pairs appear independently of the Markdown description toggle,
including in unseated action previews and station configurations. Values are
plain text or finite numbers, displayed in definition order; they do not alter
rolls or other rules. Include units in the value string when needed.

Crew define `modifiers` by action type and `stationActions` by station ID. Those
additional roll/utility actions appear when that crew member occupies a matching
station. Persistent effect configurations belong to station definitions rather
than to transient crew action lists. Disabled crew retain their seat and cannot
act normally. Explicit forced rolls can override disabled crew. Player crew can move between any player ships; NPC crew remain on their own
ship.

### Giving effects to another ship

A utility action, or a roll action with separate `activation: "use"`, can define
`grantsEffects`. Add `shipSelector: true` to choose a target through an inline
selector after activation. Without a selector, grants apply directly to the
acting ship. For example:

```json
{
  "id": "support",
  "name": "Guided fire",
  "kind": "utility",
  "shipSelector": true,
  "cooldown": 2,
  "grantsEffects": [
    {
      "id": "guided-fire",
      "name": "Guided fire",
      "type": "Support",
      "duration": { "unit": "rounds", "count": 2 },
      "categories": [{ "modifier": 1 }]
    }
  ]
}
```

Players can target shared player ships. The GM can also target private NPCs;
NPC names and identifiers stay out of player target lists. Confirming a paid
activation adds independent effect instances to the target's `receivedEffects`, with opaque UUIDs.
Grants stack when used again; they persist through source seat changes and are
removed through their timers, GM **×**, or a matching removal action. They can
satisfy action requirements by effect ID. Their clocks and effects belong to the
target ship; crew-turn duration follows the crew member who activated the action, including
an opaque private trigger for NPC crew. The target must participate in the active
encounter for its timers to advance.

For ship-targeting and removal actions, activation spends ammunition, starts
cooldowns, and applies activation Gs on the acting ship, then completes any
associated roll before opening the inline selector. A roll action uses its hit
rolls for activation; damage buttons remain available afterward. Utility/removal
actions can associate a roll using `activationRoll`, for example:

```json
"activationRoll": { "label": "Support", "type": "Piloting", "notation": "1d6" }
```

The roll uses the crew modifier for that type (or the roll action's action type),
plus normal effect modifiers, station blocking and roll audience rules. Roll
buttons that initiate selection support right-click forced overrides. A selector
starts with no choice. Confirming applies/removes effects without spending or
rolling again, even if the action is now on cooldown or ammunition is empty.
Cancel discards the paid selection without refunding ammunition, cooldowns, Gs
changes or rolls. Closing the editor or navigating away retains a **Finish
selection…** button; opening it does not pay or roll again. A receipt can be
confirmed or cancelled only once. Requirements and crew availability are checked
at activation, rather than again on confirmation. Effect durations begin when
the selected effect is applied.

Paid receipts persist in the source ship's `pendingSelections`, including the
snapshotted effects/removal type and triggering crew reference. Each ship permits
up to 100 unfinished selections. Existing saves default to an empty list.
A stale removal choice or incompatible target leaves the paid receipt available
for another choice or cancellation; costs stay spent. A Dice+ availability or
notation error detected before activation spends nothing. If Dice+ fails to
confirm a roll after activation was saved, the panel explicitly reports the
uncertain result and retained costs before offering resolution/cancellation.

Application is explicit and independent of hit success; the extension does not
infer a successful hit from dice totals. Target station/weapon references are
validated on confirmation, after activation costs have been spent. Received
effects and their clocks survive JSON export/import and scene persistence. The
runtime limit is 500 received effect instances per ship.

### Damage CAT

| CAT | Die |
| --- | --- |
| 1   | d4  |
| 2   | d6  |
| 3   | d8  |
| 4   | d10 |
| 5   | d12 |

Improving CAT means a smaller category number and smaller die; smaller dice are
better under these rules. Worsening means a larger category and die. Damage
buttons show the effective CAT next to their adjusted notation. By default,
`effectRoll` is treated as damage; use `damage: false` on a non-damage effect roll,
or `damage: true` to mark another roll explicitly.

Effects can provide additive `categories` rules, using a positive modifier to
improve and a negative modifier to worsen. Omit selectors for all damage on the
ship; add `stationId` for a station's weapons, or `actionId` to target a weapon
(with optional `stationId` to disambiguate). For example:

```json
"categories": [{ "stationId": "weapons", "actionId": "fire", "modifier": 1 }]
```

The category is derived from the damage notation's die size. After summing
matching effect modifiers, CAT clamps to 1–5. Dice counts, existing keep/drop
notation and numerical modifiers are preserved. Hit rolls and non-damage rolls
are unchanged. CAT notation supports dice pools of one common size from the
five categories, including repeated pools and numerical terms; mixed sizes or
dice outside that mapping keep their notation and cannot be overridden by CAT.

Every damage roll's right-click force menu includes CAT controls. **Improve**
moves toward CAT1/d4, **Worsen** toward CAT5/d12, and **Reset** returns to the
current effect-adjusted CAT. Choose normal/advantage/disadvantage to roll using
the selected CAT. The adjustment applies to that roll only, clamps after effects,
and does not alter the weapon or create an effect. Station blocking and cooldown
force overrides still work; other requirements and ammunition rules still apply.

### Effect types, requirements and lifetime

Effects have a `type` (default `General` for existing definitions). An action's
`requiresEffects` array lists effect IDs that must all be active on its ship.
Unavailable actions name the missing effects. This applies to Use, configuration,
removal, Gs adjustments and all rolls, including later damage resolution. Forced
rolls do not bypass requirements or missing ammunition.

An effect can define `disableStations: ["weapons"]` to disable every normal roll
at those stations, including hit, damage and saving throws. Configuration and
other non-roll actions remain available. The UI names the blocking effects;
right-click forced rolls remain a deliberate override, as do overrides of crew
disabling and cooldowns.

```json
{
  "id": "ion-lock",
  "name": "Ionised controls",
  "type": "Malfunction",
  "disableStations": ["helm", "weapons"],
  "duration": { "unit": "rounds", "count": 2 }
}
```

Omitting `duration` makes an effect indefinite. `rounds` expires at the start of
the Xth upcoming round. `crewTurns` expires at the start of the triggering crew
member's Xth upcoming turn, regardless of seat changes. Other crew turns do not
count. Effects only advance when the GM advances an unpaused encounter containing
the affected ship. **Round +1** ticks round effects and the first crew member's
turn, while skipped crew turns are not invented. Initiative rerolls and manual
edits never tick effects. Disabling crew does not suspend their turn clocks.

Configuration editors identify the triggering crew member, defaulting to the
current crew view or the first enabled seated crew member in the full station
view. Retained selections keep their timers; newly selected effects start fresh.
For turn-based damage effects, player damage uses the selected crew; GM damage
uses the encounter's current crew or asks for a trigger if none is active.

The GM can remove an individual active effect with **×** in status. A
`remove-effect` action, for example `{"id":"clear-fault","name":"Clear fault",
"kind":"remove-effect","effectType":"Malfunction"}`, lets seated enabled crew
choose one matching active instance. Removing or expiring a damage effect leaves
the damage counter and selected damage alternative intact. A later repair clears
that level's timer/suppression; fresh damage can apply its effect again. Removing
a station effect deselects it without clearing other choices. Missing or already
removed dropdown targets are rejected without consuming the paid receipt or
charging again; the initial activation costs remain spent.

Per-source runtime `effectStates` retain remaining counts and damage suppression
on the ship. Encounter `effectTurnRounds` and `cooldownRound` prevent repeated
expiry when navigating backward and forward. Back does not restore removed
or expired effects. NPC-triggered effects on player ships use an opaque trigger
token; its association stays on private NPC crew, so NPC identifiers are not
published. Normal JSON exports preserve these runtime fields and trigger tokens.
Newly imported active timed definitions without clocks start at import, anchored
to their station's first seated crew or the damaged ship's first crew member.
An active crew-turn effect without an identifiable trigger is rejected.

Old effects load as `General`, old ships start at zero Gs, and existing damage,
station selections, ammunition and cooldowns are preserved. The samples add targeted Guided fire support, weapon CAT tuning, a
two-round station blackout, a two-turn stance, a requirement-gated attack,
type-based fault removal, acceleration/deceleration and a Helm saving throw.

An effect contains `id`, `name`, optional Markdown `description`, optional
`stats` deltas, and optional `rolls` adjustments. Each roll adjustment can specify:

```json
{
  "stationId": "weapons",
  "rollType": "Attack",
  "modifier": 2,
  "advantage": 1,
  "disadvantage": 0
}
```

Omit `stationId` to match every station. Omit `rollType` to match every roll type.
Provide both to target that roll type within that station. Matching numerical
modifiers add to the crew's action-type modifier. Advantage and disadvantage
cancel one-for-one across damage and station effects; the remaining count adds
that many dice while retaining the original pool count. For example, `2d6` with
one advantage and a +3 crew modifier becomes `3d6kh2+3`; disadvantage uses `kl`.
Effect-driven advantage currently requires a plain `NdS` pool. Advanced Dice+
expressions may be used without effect-driven advantage; split complex formulas
into separate roll definitions when adding advantage effects.

Dice+ must be installed and enabled separately. The bridge validates notation
before sending a roll. GM rolls always use `gm_only`, even on player ships;
player rolls always use `everyone`. Rolls use Dice+ row labels. GM action totals are not persisted or published.
Individual initiative rolls store their total on the crew: player crew initiative
is shared for encounter coordination, even when the GM rolled it privately; NPC
crew initiative remains local to the GM. See [the bridge contract](dice-plus.md) for upstream
privacy and protocol limits.

## Library JSON

Use **Import → Example JSON** to get a complete editable example, **Export** to
save a backup, or load/paste a JSON file and review it before importing.

```json
{
  "version": 1,
  "ships": [],
  "crew": [],
  "encounters": []
}
```

Each collection is optional. Entries replace existing entries with the same ID;
other entries are retained. Import a ship and its seated crew together. References,
unique IDs, legal seats, damage selections and effect configurations are validated
against the resulting library before saving. IDs use letters, numbers, underscores
or hyphens. Ship IDs and crew IDs are global within a scene/library; station IDs
are unique within a ship; action IDs are unique within a station. Crew action IDs
must not collide with the station's actions. Encounter IDs are unique in the GM
library. The runtime schemas are in
[`schema.ts`](../extensions/spaceship-combat/src/schema.ts); editable examples are
in [`sample-data.ts`](../extensions/spaceship-combat/src/sample-data.ts).

An encounter contains `id`, `name`, `shipIds`, `round`, `currentCrewId`, and
`running`. The legacy `turn` field remains in exports; `currentCrewId` determines
the active turn. Initiative belongs to each crew member. Crew define an optional
`initiativeRoll` (default `1d20`) and a nullable `initiative` total. Supported
initiative formulas are `NdS`, optionally followed by an integer `+N` or `-N`.
Individual initiative buttons use Dice+; a late result from a superseded roll is
rejected. The GM's **Roll NPCs · RNG** uses browser cryptographic RNG for NPC
crew in the encounter, including disabled NPC crew, without Dice+ requests.
Player initiatives and pending player rolls are preserved. Every encounter crew
member appears in the tracker before rolling, with an inline manual initiative
field. Enter or leaving the field saves the total; clearing it makes that crew
member unrolled again.
It selects the highest initiative as the active crew member without changing the
round or ticking cooldowns. Only rolled crew participate in turn navigation;
unrolled crew remain visible below them. Ties use
crew ID for stable ordering. The GM can also enter or clear totals in Crew.

Crew are associated with their current seated ship, or their home ship when
unseated. **Next** advances through rolled crew and starts a round on wrap;
**Back** returns to the preceding crew member, wrapping to the preceding round
but stopping at the first turn of round 1. **Round +1** starts a new round directly.
All three require an unpaused encounter. Backward navigation changes the active
turn and round without undoing actions or restoring cooldowns. The encounter's
`cooldownRound` records its highest processed round, so returning forward through
an already visited boundary does not tick cooldowns twice. Editing an encounter
preserves its turn, round and this marker. Players choose **Playing as** on **My actions**
for their current station actions, initiative and inline seat switching. This
selection is a convenience, not a claim of ownership; other players can still
manage the shared fleet.

Player ship IDs referenced by an encounter must exist in the current scene.
Saved encounters refer to live ships, not independent cloned instances. The first
scene initialization includes a player freighter and crew; the GM library includes
two NPC ships/crew and a sample encounter.

### Ammunition and Autonomy

Each ship owns optional `ammunition` pools. Actions with the same exact, trimmed
ammunition name draw from the same pool on that ship, including crew actions and
actions at different stations. Pools on different ships are independent. Player
pools follow their ship into scene metadata; NPC pools remain in the GM browser.
Old ships without ammunition load with an empty list and keep existing actions.

```json
{
  "ammunition": [
    { "name": "Autonomy", "current": 60, "capacity": 80 },
    { "name": "Torpedoes", "current": 3, "capacity": 3 }
  ]
}
```

Pool names must be unique per ship; amounts are nonnegative integers and cannot
exceed capacity. `Autonomy` is the reserved exact name for the status resource,
with a capacity of 40–120 points. Full status includes it alongside ship systems,
with ±1 and ±7 controls and segments worth up to ten points. Adjustments clamp at
zero/capacity. Compact crew status shows a single read-only label/bar row with its
current total. Other ammunition appears only in the full status ammunition list
(before systems), with ±1 restock controls, and beside actions that use it.

A roll or utility action can define `ammunition: {"name": "Torpedoes", "cost": 1}`.
Cost defaults to one and must be positive. A normal roll action spends ammunition
and starts one cooldown slot when its hit rolls. Previewing or rolling damage
spends nothing. Insufficient ammunition disables activation; the GM controller
checks and deducts it with cooldowns as one queued state change, so simultaneous
seats cannot spend the same last unit. Forced rolls can override disabled crew or
cooldowns, but cannot create missing ammunition.

A roll action with `activation: "use"` shows three independent controls when it
has hit and damage rolls: **Use**, **Hit**, **Damage**. Use spends ammunition and
starts cooldowns without Dice+. Hit still receives crew modifiers and automatic
advantage/disadvantage; damage does not. Those later rolls neither spend ammunition
nor start cooldowns, and remain available after the last unit is spent or while
Use is cooling down. They are manual resolution controls, without tracking a
pending projectile or requiring a previous Use. Crew must still be seated and
enabled for normal rolls. A utility action provides Use without any roll buttons.

The samples include shared cannon rounds, a separate torpedo launch/resolution
action, and a seven-point Autonomy Travel action. Import validation checks station
ammunition references; a travelling crew ability is unavailable on a ship lacking
its named pool. Export/import remains the way to define pools, capacities and
costs; status controls change current stock only.

### Cooldowns and forced rolls

A roll action can define `cooldown` as an integer (one slot), or an array such as
`[2, 3]` (two independent slots). An activation spends the ready slot with the shortest
effective duration; ties follow definition order. For `[2, 3]`, two hits produce
remaining values `[2, 0]`, then `[2, 3]`. Hit buttons are disabled only while all
slots are busy. Effect rolls never spend or require a slot. At the start of a new
round, every slot decreases independently, stopping at zero: `[2, 3]` becomes
`[1, 2]`, then `[0, 1]`; the shorter slot is now usable again. An action without
`cooldown` has no slots or cooldown restriction.

By default, slots belong to the station action, shared by all seats, including
crew-specific actions. To share slots between actions, give each action the same
`cooldownName` and the same base `cooldown` durations, for example:

```json
{ "cooldownName": "launchers", "cooldown": [2, 3] }
```

Names use the same letters/numbers/underscore/hyphen format as IDs. A named pool
is scoped to a station on one ship. Both station and eligible crew actions with
that name share availability and remaining counters. Each action must declare
its durations; conflicting definitions are rejected on import. Scalar `2` and
array `[2]` define the same one-slot pool. Actions without a name remain
independent. Pools persist as `named:<name>` keys in the station's `cooldowns`
map, preserving existing unnamed action keys. Each pool ticks once per round,
regardless of how many actions refer to it. The activating action's matching
effect modifiers determine the spent slot's duration; other actions immediately
see that counter. Replacing/removing crew does not clear slots. All encounter
ships tick, including empty stations. The sample torpedo launch and salvo share
`launchers`; the sample cannons keep independent `[2, 3]` slots.
An optional effect `cooldowns` array adds duration adjustments, for example:

```json
{
  "cooldowns": [
    { "stationId": "weapons", "actionType": "Gunnery", "modifier": -1 }
  ]
}
```

Omit either selector to match all stations or action types on that ship. Matching
adjustments add to each slot's base duration and clamp at zero. A zero-duration
slot is immediately reusable. Remaining counters are fixed when a hit is rolled;
changing effects does not rewrite an already running cooldown. The sample cannon
has `[2, 3]` slots, Boost adds one to both, and Calibrated sights subtracts one.
Bars compare remaining rounds against the current effective duration (or the
remaining value if greater); counters are authoritative after effect changes.

Roll buttons indicate automatic advantage/disadvantage. Right-click (or keyboard
context menu / Shift+F10) opens inline force choices: advantage, disadvantage or
normal. These replace automatic advantage with one extra keep-high die, one extra
keep-low die, or none. They retain numerical modifiers and audience rules, and can
override cooldowns or disabled crew, including on effect rolls. Crew must still be
seated at that station. For actions activated by rolling, a forced hit spends the shortest ready slot if available; when all are busy it
restarts only the slot with the least time remaining (ties use duration, then
definition order). A forced effect never touches slots.

Dice+ readiness and notation validation precede cooldown activation. The controller
reserves one slot before dispatching the hit, so simultaneous seats cannot
spend the same ready slot. A dispatch failure or timeout can therefore leave a cooldown
charged (and ammunition spent); inspect the state before retrying. A forced
retry also spends ammunition on a direct hit; use the separate activation flow
when launch and resolution must be independent. No automatic
retry or refund is performed because the dice may already have rolled.

Existing version-1 libraries and scene saves load with empty cooldowns, `1d20`
unrolled crew initiative, and positional hit/effect roll kinds when missing.
Existing scalar running cooldowns load as one-element arrays without losing
remaining rounds. Damage, seats and station effect selections are preserved. Old ship initiative is
ignored; roll crew initiative to populate the new tracker. Manifest URLs stay the
same; export backups before updating installed extensions.

JSON files are limited to 3 MB; pasted imports are limited to three million JSON characters and are also constrained by
browser storage availability and Owlbear scene write limits. Larger libraries can
be imported in smaller batches. A failed import leaves the previous library intact
under ordinary write failures; retain exported backups for browser shutdowns or
storage clearing.

## Review and verification

The following decisions need game-rule review, but do not block use:

- Any player can manage the shared player fleet and its crew. There is no per-user
  crew ownership policy yet.
- Stat modifiers are additive, without a minimum or maximum. Sample ship values,
  action definitions and effects illustrate the mechanics rather than a published
  spaceship combat ruleset.
- Advantage uses extra dice with keep-high/keep-low, not repeating an entire roll
  and choosing its total. Numerical crew modifiers apply only to hit rolls;
  roll-specific numerical effect rules can distinguish Attack from Damage.
- Repairs remove the effect attached to the repaired damage level. They never
  change station configurations.

Rules/command tests and the SDK host fixture verify behavior without an Owlbear
account. The fixture runs the real SDK with a background controller, GM panel,
two player panels, shared cooldowns, hit/effect rolls, forced overrides, crew
initiative, quick actions, typed/timed effects, Gs, compact saving throws, scene
changes, imported Markdown, private-storage/scene-write
failures and a simulated Dice+ protocol responder. It cannot verify authenticated
Owlbear hosting, actual dice physics, service-side private routing or the live
scene storage ceiling. A real-room installation and private/public roll check
remain the final external verification. No deployment is performed by these tests.

Primary references: [Owlbear scene metadata](https://docs.owlbear.rodeo/extensions/apis/scene/),
[broadcast](https://docs.owlbear.rodeo/extensions/apis/broadcast/),
[theme](https://docs.owlbear.rodeo/extensions/apis/theme/),
[Dice+ notation and integration](https://extensions.owlbear.rodeo/dice-plus).
