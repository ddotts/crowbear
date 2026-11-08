# Spaceship combat

The extension uses a 400 × 640 popover with inline damage and station controls.
Outside Owlbear, it runs an unsaved standalone demo with a role selector.
Inside Owlbear, the role comes from the SDK and cannot be switched in the panel.
The UI follows Owlbear theme changes; the standalone preview follows the system
or its light/dark selector. Descriptions render sanitized Markdown prose, lists,
links, tables, headings and code. Links open a new tab; embedded images, scripts
and form controls are excluded.

## Storage and collaboration

- Player ships, their base data, damage, station selections, seats and player crew
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

A ship has base `stats.ac`, `stats.maxG` and `stats.speed` (km). Active stat deltas
add to those bases; the status panel displays effective values and the base/delta.
Effects are scoped to their own ship. Values are not clamped or rounded.

Each damage section has `levels`, an array starting at damage level 1. Each level
contains zero or more effect alternatives. An empty level applies damage
immediately, a single alternative is selected automatically, and multiple
alternatives require a choice before the counter changes. Selected effects from
all damaged levels accumulate. The minus button repairs the highest damaged
level and removes that level's effect, if any. Damage is managed by these buttons;
station configuration actions do not apply or repair damage.

Actions have one of three `kind` values:

- `roll`: an action `type` for the crew modifier and one or more `rolls`. Each
  roll has a `label`, its own `type`, and Dice+ `notation`.
- `utility`: an action with no dice or automatic state change.
- `effects`: a station-owned set of effect options. Any combination may be
  selected, including none. Selections are stored by action ID on the station,
  once for all seats, and survive crew replacement, removal and disabling.
  At least one enabled crew member must occupy that station to change selections.

Crew define `modifiers` by action type and `stationActions` by station ID. Those
additional roll/utility actions appear when that crew member occupies a matching
station. Persistent effect configurations belong to station definitions rather
than to transient crew action lists. Disabled crew retain their seat and cannot
act. Player crew can move between any player ships; NPC crew remain on their own
ship.

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
player rolls always use `everyone`. Multiple rolls use Dice+ row labels and
independent results. Dice+ displays results; the extension does not publish or
persist private totals. See [the bridge contract](dice-plus.md) for upstream
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

An encounter contains `id`, `name`, `shipIds`, `round`, `turn`, and `running`.
Initiative is stored on each ship; the encounter orders ships by descending
initiative. Player ship IDs referenced by an encounter must exist in the current
scene. Saved encounters refer to the live ships, not independent cloned ship
instances. The first scene initialization includes a player freighter and crew;
the GM library includes two NPC ships/crew and a sample encounter.

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
  and choosing its total. Numerical crew modifiers apply to every roll in that
  action; roll-specific effect rules can distinguish Attack from Damage.
- Repairs remove the effect attached to the repaired damage level. They never
  change station configurations.

Rules/command tests and the SDK host fixture verify behavior without an Owlbear
account. The fixture runs the real SDK with a background controller, GM panel,
two player panels, scene changes, imported Markdown, private-storage/scene-write
failures and a simulated Dice+ protocol responder. It cannot verify authenticated
Owlbear hosting, actual dice physics, service-side private routing or the live
scene storage ceiling. A real-room installation and private/public roll check
remain the final external verification. No deployment is performed by these tests.

Primary references: [Owlbear scene metadata](https://docs.owlbear.rodeo/extensions/apis/scene/),
[broadcast](https://docs.owlbear.rodeo/extensions/apis/broadcast/),
[theme](https://docs.owlbear.rodeo/extensions/apis/theme/),
[Dice+ notation and integration](https://extensions.owlbear.rodeo/dice-plus).
