import "@fontsource/roboto/latin-400.css";
import "@fontsource/roboto/latin-500.css";
import "@fontsource/roboto/latin-700.css";
import OBR, { type Theme } from "@owlbear-rodeo/sdk";
import { markdown } from "./markdown";
import {
  type Action,
  type Ammunition,
  actionRolls,
  activationRolls,
  activationType,
  activeEffects,
  ammunitionAvailable,
  ammunitionPool,
  type Crew,
  categoryDie,
  cooldownBlocked,
  cooldownSlots,
  crewActions,
  damageCategory,
  type Effect,
  type EffectState,
  effectiveStats,
  effectSummary,
  effectTone,
  initiativeActors,
  isDamageRoll,
  isSavingThrow,
  missingEffects,
  type RollOverride,
  requiresSelection,
  rollAdjustments,
  rollBlockers,
  rollNotation,
  type Ship,
  type Station,
  separateActivation,
  usableCrew,
} from "./rules";
import {
  type Command,
  type Encounter,
  type Library,
  librarySchema,
} from "./schema";
import { createSession } from "./session";
import "./style.css";

let ships: Ship[] = [];
let crew: Crew[] = [];
let savedEncounters: Encounter[] = [];
let activeEncounterId: string | null = null;
let editingEncounterId: string | null = null;
let role = "GM";
let connectionStatus = "Loading…";
let connected = false;
let busy = false;
let importText = JSON.stringify(
  { version: 1, ships: [], crew: [], encounters: [] },
  null,
  2,
);
let importPreview: Library | null = null;
let importMode: "replace" | "merge" = "replace";
let importError = "";
let screen = "Encounter";
let shipId = "kestrel";
let section = "Status";
let encounterName = "Ambush at the relay";
let encounterIds = ships.map((s) => s.id);
let running = true;
let round = 1;
let activeCrewId: string | null = null;
let inspectedCrewId: string | null = null;
let encounterView = "actions";
let renderedActiveCrew: string | null = null;
let renderedRound = 0;
let renderedInitiativeOrder = "";
let selectedCrewId = "mara";
let rollMenu: {
  shipId: string;
  stationId: string;
  crewId: string;
  actionId: string;
  rollIndex: number;
  categoryShift: number;
  activation: boolean;
} | null = null;
let message = "";
let editing:
  | {
      kind: "selection";
      selectionId: string;
      shipId: string;
      crew: string;
      action: string;
    }
  | { kind: "damage"; part: number }
  | { kind: "seat"; station: number; seat: number }
  | { kind: "move"; crew: string }
  | { kind: "effects"; station: number; action: string }
  | null = null;
let freshEncounter = false;
const expandedStations = new Set([0]);
const expandedCrew = new Set<string>();
const expandedDetails = new Set<string>();
let themePreference = "system";
let renderedView = "";
let sceneSession: string | null = null;
const app = document.querySelector<HTMLDivElement>("#app")!;
const escapeHtml = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
const mutationButtons = new Set([
  "dismiss-effect",
  "choose-remove-effect",
  "activate-selection",
  "resume-selection",
  "action-gs",
  "ammunition",
  "use",
  "damage",
  "repair",
  "configure",
  "seat",
  "move",
  "disable",
  "roll",
  "pause",
  "next",
  "previous",
  "next-round",
  "roll-all-initiatives",
  "roll-initiative",
  "force-roll",
  "edit-encounter",
  "new-encounter",
  "open-encounter",
  "import-library",
]);
const button = (label: string, action: string, extra = "") =>
  `<button type="button" data-action="${action}" ${extra} ${OBR.isAvailable && !connected && mutationButtons.has(action) ? "disabled" : ""}>${label}</button>`;
const pill = (text: string) => `<span class="pill">${text}</span>`;
const ship = () => ships.find((s) => s.id === shipId)!;
const playerCrew = () =>
  crew.filter((c) => ships.find((s) => s.id === c.ship)?.kind === "Player");
function whereabouts(id: string) {
  for (const s of ships)
    for (const st of s.stations) {
      const index = st.seats.indexOf(id);
      if (index !== -1) return `${s.name} · ${st.name} ${index + 1}`;
    }
  return "Unassigned";
}
function heading(title: string, action = "") {
  return `<div class="view-heading"><h1>${title}</h1>${action}</div>`;
}
function description(text: string | undefined, key: string) {
  return text
    ? `<details class="description" data-detail="${escapeHtml(key)}" ${expandedDetails.has(key) ? "open" : ""}><summary>Description</summary><div class="markdown">${markdown(text)}</div></details>`
    : "";
}
function actionName(action: Action, key: string) {
  return action.description
    ? button(
        `${escapeHtml(action.name)} <span aria-hidden="true">${expandedDetails.has(key) ? "⌃" : "⌄"}</span>`,
        "toggle-description",
        `class="action-name" data-value="${escapeHtml(key)}" aria-expanded="${expandedDetails.has(key)}" aria-controls="desc-${encodeURIComponent(key)}"`,
      )
    : `<strong class="action-name">${escapeHtml(action.name)}</strong>`;
}
function actionValues(action: Action) {
  return action.values?.length
    ? `<dl class="action-values">${action.values.map(({ name, value }) => `<div><dt>${escapeHtml(name)}</dt><dd>${escapeHtml(String(value))}</dd></div>`).join("")}</dl>`
    : "";
}
function actionDescription(action: Action, key: string) {
  return action.description && expandedDetails.has(key)
    ? `<div class="markdown action-copy" id="desc-${encodeURIComponent(key)}">${markdown(action.description)}</div>`
    : "";
}
function effectBadges(effect: Effect) {
  const signed = (n: number) => (n > 0 ? `+${n}` : String(n));
  const signTone = (n: number) =>
    n > 0 ? "positive" : n < 0 ? "negative" : "neutral";
  const items = [
    ...(effect.disableStations?.length
      ? [{ text: "Rolls off", tone: "negative" }]
      : []),
    ...Object.entries(effect.stats ?? {}).map(([key, n]) => ({
      text: `${key === "ac" ? "AC" : key === "speed" ? "km" : "G"} ${signed(n)}`,
      tone: signTone(n),
    })),
    ...(effect.rolls ?? []).map((r) => ({
      text: `${r.rollType ?? "Rolls"} ${[r.modifier ? signed(r.modifier) : "", r.advantage ? `↑${r.advantage}` : "", r.disadvantage ? `↓${r.disadvantage}` : ""].filter(Boolean).join(" ")}`,
      tone: effectTone({ id: effect.id, name: effect.name, rolls: [r] }),
    })),
    ...(effect.categories ?? []).map((r) => ({
      text: `CAT ${r.modifier > 0 ? "↑" : "↓"}${Math.abs(r.modifier)}`,
      tone: signTone(r.modifier),
    })),
    ...(effect.cooldowns ?? []).map((r) => ({
      text: `CD ${signed(r.modifier)}`,
      tone: signTone(-r.modifier),
    })),
  ];
  return items
    .map(
      (item) =>
        `<span class="effect-chip ${item.tone}">${escapeHtml(item.text)}</span>`,
    )
    .join("");
}
function effectEntry(
  effect: Effect,
  key: string,
  source = "",
  timer?: EffectState,
) {
  const tone = effectTone(effect);
  const sign = { positive: "+", negative: "−", mixed: "±", neutral: "•" }[tone];
  const unit = timer?.unit ?? effect.duration?.unit,
    remaining = timer?.remaining ?? effect.duration?.count;
  const trigger = crew.find(
    (c) =>
      c.id === timer?.trigger ||
      (timer?.trigger && c.effectTrigger === timer.trigger),
  );
  const lifetime =
    unit && remaining !== undefined
      ? `<span class="effect-chip neutral" title="${unit === "crewTurns" ? `Upcoming turns of ${escapeHtml(trigger?.name ?? "the triggering crew member")}` : "Upcoming round starts"}">${remaining} ${unit === "rounds" ? (remaining === 1 ? "round" : "rounds") : remaining === 1 ? "turn" : "turns"}</span>`
      : "";
  return `<details class="effect-entry ${tone}" data-detail="${escapeHtml(key)}" ${expandedDetails.has(key) ? "open" : ""}><summary><span class="effect-sign" aria-label="${tone} effect">${sign}</span><strong>${escapeHtml(effect.name)}</strong><span class="effect-chips">${effectBadges(effect)}<span class="effect-chip neutral">${escapeHtml(effect.type ?? "General")}</span>${lifetime}</span></summary><div class="effect-expanded">${source ? `<small>${escapeHtml(source)}</small>` : ""}<p class="effect-rules">${escapeHtml(effectSummary(effect))}</p>${effect.description ? `<div class="markdown">${markdown(effect.description)}</div>` : ""}</div></details>`;
}
function effectInfo(effect: Effect, key: string) {
  return effectEntry(effect, key);
}
function effectList(s: Ship, key: string) {
  const effects = activeEffects(s);
  return `<ul class="effect-list">${effects.map(({ effect, source, key: sourceKey }) => `<li class="active-effect-row">${effectEntry(effect, `${key}:${source}:${effect.id}`, source, s.effectStates?.[sourceKey])}${role === "GM" ? button("×", "dismiss-effect", `data-ship="${s.id}" data-value="${escapeHtml(sourceKey)}" aria-label="Remove ${escapeHtml(effect.name)}" title="Remove effect without repairing damage"`) : ""}</li>`).join("") || '<li class="muted">No active effects.</li>'}</ul>`;
}
function ammunitionTrack(pool: Ammunition) {
  const size = 10;
  return `<span class="ammunition-track ${pool.current === 0 ? "empty" : pool.current / pool.capacity <= 0.25 ? "low" : ""}" role="meter" aria-label="${escapeHtml(pool.name)}; each segment is up to ${size} points" aria-valuenow="${pool.current}" aria-valuemin="0" aria-valuemax="${pool.capacity}">${Array.from({ length: Math.ceil(pool.capacity / size) }, (_, index) => `<i style="--fill:${Math.max(0, Math.min(1, (pool.current - index * size) / Math.min(size, pool.capacity - index * size))) * 100}%"></i>`).join("")}</span>`;
}
function ammunitionButton(s: Ship, pool: Ammunition, delta: number) {
  return button(
    delta === -1
      ? "−"
      : delta === 1
        ? "+"
        : delta > 0
          ? `+${delta}`
          : `−${-delta}`,
    "ammunition",
    `data-ship="${s.id}" data-value="${escapeHtml(pool.name)}" data-delta="${delta}" aria-label="${delta > 0 ? "Increase" : "Decrease"} ${escapeHtml(pool.name)} by ${Math.abs(delta)}" ${delta > 0 ? (pool.current >= pool.capacity ? "disabled" : "") : pool.current === 0 ? "disabled" : ""}`,
  );
}
function autonomyControl(s: Ship, compact = false) {
  const pool = s.ammunition?.find((pool) => pool.name === "Autonomy");
  if (!pool) return "";
  if (compact)
    return `<div class="autonomy-summary"><span>Autonomy <small>${pool.current}/${pool.capacity}</small></span>${ammunitionTrack(pool)}</div>`;
  return `<div class="autonomy-row"><div class="autonomy-name"><strong>Autonomy</strong>${ammunitionTrack(pool)}</div><span class="ammunition-amount">${pool.current}<small>/${pool.capacity}</small></span><div class="ammunition-adjust">${[-7, -1, 1, 7].map((delta) => ammunitionButton(s, pool, delta)).join("")}</div></div>`;
}
function ammunitionList(s: Ship) {
  const pools = s.ammunition?.filter((pool) => pool.name !== "Autonomy") ?? [];
  return pools.length
    ? `<section class="ammunition-list" aria-label="Ammunition"><div class="section-label"><h3>Ammunition</h3></div>${pools.map((pool) => `<div class="ammunition-row"><strong>${escapeHtml(pool.name)}</strong><span class="ammunition-amount">${pool.current}<small>/${pool.capacity}</small></span><div class="ammunition-adjust">${[-1, 1].map((delta) => ammunitionButton(s, pool, delta)).join("")}</div></div>`).join("")}</section>`
    : "";
}
function shipSnapshot(s: Ship, c?: Crew) {
  const stats = effectiveStats(s),
    effects = activeEffects(s);
  const key = `snapshot:${s.id}`;
  return `<section class="ship-snapshot" aria-label="Ship status"><div class="snapshot-heading">${button(escapeHtml(s.name), "inspect-ship", `data-value="${s.id}" title="Open full ship status"`)}<div class="snapshot-stats"><span>AC <b>${stats.ac}</b></span><span class="g-indicator ${(s.gs ?? 0) > stats.maxG ? "over-limit" : ""}">Gs <b>${s.gs ?? 0}</b> <small>max ${stats.maxG}</small></span><span><b>${stats.speed}</b> km</span></div></div><div class="snapshot-damage">${s.parts.map((p) => `<div><span>${escapeHtml(p.name)}</span><span class="damage-track" aria-hidden="true">${p.levels.map((_, index) => `<i class="${index < p.damage ? `severity-${Math.min(p.damage, 3)}` : ""}"></i>`).join("")}</span><b>${p.damage}/${p.levels.length}</b></div>`).join("")}</div>${autonomyControl(s, true)}${c ? savingThrows(s, c) : ""}<details class="snapshot-effects" data-detail="${key}" ${expandedDetails.has(key) ? "open" : ""}><summary>Effects <b>${effects.length}</b><span class="effect-counts">${[
    "positive",
    "negative",
    "mixed",
  ]
    .map((tone) => {
      const n = effects.filter(
        ({ effect }) => effectTone(effect) === tone,
      ).length;
      return n
        ? `<span class="${tone}">${{ positive: "+", negative: "−", mixed: "±" }[tone as "positive" | "negative" | "mixed"]}${n}</span>`
        : "";
    })
    .join("")}</span></summary>${effectList(s, key)}</details></section>`;
}
function render() {
  const view = `${screen}:${shipId}:${section}`;
  const sameView = view === renderedView;
  const initiativeOrder = initiativeActors(ships, crew, encounterIds, false)
    .map((a) => `${a.crew.id}:${a.crew.initiative ?? ""}`)
    .join("|");
  const previousTracker = app.querySelector<HTMLElement>(".crew-order");
  const trackerScroll = previousTracker?.scrollTop ?? 0;
  const scroll = sameView ? (app.querySelector("main")?.scrollTop ?? 0) : 0;
  renderedView = view;
  const oldForm = sameView
    ? app.querySelector<HTMLFormElement>("main form")
    : null;
  const draft = oldForm
    ? {
        key: JSON.stringify(oldForm.dataset),
        fields: Array.from(
          oldForm.querySelectorAll<HTMLInputElement | HTMLSelectElement>(
            "input[name], select[name]",
          ),
        ).map((field) => ({
          name: field.name,
          value: field.value,
          checked: field instanceof HTMLInputElement && field.checked,
        })),
      }
    : null;
  const nav =
    role === "GM"
      ? [
          ["Encounter", "Run"],
          ["Ships", "Ships"],
          ["Crew", "Crew"],
          ["Encounters", "Saved"],
          ["Import JSON", "Import"],
        ]
      : [
          ["My actions", "Actions"],
          ["My ships", "Ships"],
          ["My crew", "Crew"],
        ];
  app.innerHTML = `<header class="topbar"><strong>↗ Spaceship combat</strong><label class="sr-only" for="role">Preview role</label><select id="role" ${OBR.isAvailable ? "disabled" : ""}><option ${role === "GM" ? "selected" : ""}>GM</option><option ${role === "Player" ? "selected" : ""}>Player</option></select></header><nav class="main-nav" aria-label="Main navigation">${nav.map(([value, label]) => button(label, "nav", `data-value="${value}" aria-current="${screen === value ? "page" : "false"}"`)).join("")}</nav><div class="connection-status ${connected ? "" : "disconnected"}" role="status">${escapeHtml(connectionStatus)}${button("↻", "refresh", 'aria-label="Refresh state"')}</div><main ${busy ? "inert" : ""}>${screen === "My actions" ? quickActions() : screen === "Edit encounter" ? encounterEditor() : screen === "Encounter" ? encounter() : screen === "Ships" || screen === "My ships" ? fleet() : screen === "Crew" || screen === "My crew" ? crewScreen() : screen === "Encounters" ? encounters() : importScreen()}</main><div class="notice" role="status">${escapeHtml(message)}</div><footer><span>${OBR.isAvailable ? "Owlbear" : "Demo"} · ${busy ? "Working…" : role === "GM" ? "GM rolls private" : "Player rolls public"}</span>${!OBR.isAvailable ? `<label class="sr-only" for="theme-mode">Preview theme</label><select id="theme-mode" aria-label="Preview theme">${["system", "light", "dark"].map((mode) => `<option value="${mode}" ${mode === themePreference ? "selected" : ""}>${mode[0].toUpperCase() + mode.slice(1)}</option>`).join("")}</select>` : ""}${!OBR.isAvailable ? button("Reset", "reset") : ""}</footer>`;
  const main = app.querySelector("main");
  if (main) main.scrollTop = scroll;
  const tracker = app.querySelector<HTMLElement>(".crew-order");
  if (tracker) tracker.scrollTop = sameView ? trackerScroll : 0;
  if (
    activeCrewId !== renderedActiveCrew ||
    round !== renderedRound ||
    initiativeOrder !== renderedInitiativeOrder ||
    !previousTracker ||
    !sameView
  )
    scrollToActiveCrew();
  renderedActiveCrew = activeCrewId;
  renderedRound = round;
  renderedInitiativeOrder = initiativeOrder;

  if (OBR.isAvailable && !connected)
    for (const submit of app.querySelectorAll<HTMLButtonElement>(
      "form button:not([type=button])",
    ))
      submit.disabled = true;
  const nextForm = app.querySelector<HTMLFormElement>("main form");
  if (draft && nextForm && draft.key === JSON.stringify(nextForm.dataset)) {
    for (const field of nextForm.querySelectorAll<
      HTMLInputElement | HTMLSelectElement
    >("input[name], select[name]")) {
      const previous = draft.fields.find(
        (old) =>
          old.name === field.name &&
          (field instanceof HTMLInputElement && field.type === "checkbox"
            ? old.value === field.value
            : true),
      );
      if (!previous) continue;
      if (field instanceof HTMLInputElement && field.type === "checkbox")
        field.checked = previous.checked;
      else if (
        !(field instanceof HTMLSelectElement) ||
        Array.from(field.options).some(
          (option) => option.value === previous.value,
        )
      )
        field.value = previous.value;
    }
  }
  updateDamageTrigger();
}
function shipColour(id: string) {
  const index = ships.findIndex((ship) => ship.id === id);
  return `light-dark(hsl(${(index * 137.508 + 270) % 360} 55% 38%), hsl(${(index * 137.508 + 270) % 360} 65% 74%))`;
}
function scrollToActiveCrew() {
  const tracker = app.querySelector<HTMLElement>(".crew-order"),
    active = tracker?.querySelector<HTMLElement>(".active-turn");
  if (!tracker || !active) return;
  const outer = tracker.getBoundingClientRect(),
    inner = active.getBoundingClientRect();
  if (inner.top < outer.top) tracker.scrollTop += inner.top - outer.top;
  else if (inner.bottom > outer.bottom)
    tracker.scrollTop += inner.bottom - outer.bottom;
}
function encounter() {
  if (!activeEncounterId)
    return `${heading("No encounter selected")}${button("Choose encounter", "nav", 'data-value="Encounters"')}`;
  const actors = initiativeActors(ships, crew, encounterIds);
  const waiting =
    initiativeActors(ships, crew, encounterIds, false).length - actors.length;
  const index = actors.findIndex((a) => a.crew.id === activeCrewId);
  const trackerActors = initiativeActors(ships, crew, encounterIds, false);
  const focused = trackerActors.find(
    (a) => a.crew.id === (inspectedCrewId ?? activeCrewId),
  );
  return `<div class="encounter-toolbar"><div class="encounter-caption"><h1 title="${escapeHtml(encounterName)}">${escapeHtml(encounterName)}</h1><small>Round ${round}${!running ? " · Paused" : ""}</small></div><div class="turn-buttons">${button("←", "previous", `aria-label="← Back" title="Previous crew" ${!actors.length || !running || (round === 1 && index <= 0) ? "disabled" : ""}`)}${button(running ? "Ⅱ" : "▶", "pause", `aria-label="${running ? "Pause" : "Resume"}" title="${running ? "Pause" : "Resume"} encounter"`)}${button("Next →", "next", `class="primary" ${!actors.length || !running ? "disabled" : ""}`)}${button("⋯", "edit-encounter", 'aria-label="Edit" title="Edit encounter"')}</div></div><details class="crew-tracker" data-detail="tracker" ${expandedDetails.has("tracker-closed") ? "" : "open"}><summary>Initiative · ${actors.length} rolled${waiting ? ` · ${waiting} waiting` : ""}${!running ? " · Paused" : ""}</summary><div class="initiative-strip crew-order" aria-label="Crew initiative">${trackerActors.map(({ crew: c, ship: s }) => `<div class="initiative-entry">${button(`<span class="actor-name">${escapeHtml(c.name)}<small><i class="crew-ship-dot" aria-hidden="true"></i>${escapeHtml(s.name)}${c.disabled ? " · Disabled" : ""}</small></span>${c.id === activeCrewId ? '<span class="now-badge">▶ NOW</span>' : ""}`, "actor", `data-value="${c.id}" class="${c.id === activeCrewId ? "active-turn" : ""}" style="--crew-ship-color:${shipColour(s.id)}" aria-current="${c.id === activeCrewId ? "step" : "false"}" aria-pressed="${s.id === shipId}"`)}<input type="number" data-init="${c.id}" value="${c.initiative ?? ""}" placeholder="—" aria-label="Initiative for ${escapeHtml(c.name)}" /></div>`).join("") || '<p class="context">Roll crew initiative to populate the tracker.</p>'}</div><div class="toolbar initiative-tools">${button("Roll NPCs · RNG", "roll-all-initiatives", 'aria-label="Roll NPC initiatives · RNG"')}${button("Round +1", "next-round")}</div></details><div class="encounter-view">${button("Crew actions", "encounter-view", `data-value="actions" aria-pressed="${encounterView === "actions"}"`)}${button("Ship controls", "encounter-view", `data-value="ship" aria-pressed="${encounterView === "ship"}"`)}</div>${encounterView === "actions" && focused ? crewPanel(focused.crew, true) : encounterIds.length ? shipDetail() : '<p class="empty">No ships. Edit the encounter to add some.</p>'}`;
}
function seatOf(c: Crew) {
  for (const s of ships)
    for (let index = 0; index < s.stations.length; index++) {
      const st = s.stations[index],
        seat = st.seats.indexOf(c.id);
      if (seat !== -1) return { ship: s, station: st, index, seat };
    }
  return null;
}
function initiativeControl(c: Crew) {
  return `<div class="initiative-personal"><span>Initiative <strong>${c.initiative ?? "—"}</strong><small>${escapeHtml(c.initiativeRoll ?? "1d20")}</small></span>${button("Roll initiative", "roll-initiative", `data-value="${c.id}"`)}</div>`;
}
function quickActions() {
  const members = playerCrew();
  const c = members.find((c) => c.id === selectedCrewId) ?? members[0];
  if (!c) return '<p class="empty">No player crew loaded yet.</p>';
  return `<label class="sr-only" for="crew-self">Playing as</label><select id="crew-self" aria-label="Playing as">${members.map((m) => `<option value="${m.id}" ${m.id === c.id ? "selected" : ""}>${escapeHtml(m.name)}${m.disabled ? " · Disabled" : ""}</option>`).join("")}</select>${crewPanel(c)}`;
}
function crewPanel(c: Crew, gmView = false) {
  const location = seatOf(c),
    vessel = location?.ship ?? ships.find((s) => s.id === c.ship);
  return `<section class="crew-actions" aria-label="${escapeHtml(c.name)} actions"><div class="crew-tools"><span class="crew-position">${gmView ? `<strong>${escapeHtml(c.name)}</strong><small>${location ? escapeHtml(location.station.name) : "Unassigned"} · <span class="turn-label">${c.id === activeCrewId ? "Acting now" : "Inspecting"}</span></small>` : location ? escapeHtml(location.station.name) : "Unassigned"}${c.disabled ? ' <span class="disabled-label">Disabled</span>' : ""}</span><div>${button(`Init <b>${c.initiative ?? "—"}</b> ↻`, "roll-initiative", `data-value="${c.id}" aria-label="Roll initiative" title="${escapeHtml(c.initiativeRoll ?? "1d20")}"`)}${button("⇄ Seat", "move", `data-value="${c.id}" aria-label="Switch seat"`)}${gmView && inspectedCrewId && inspectedCrewId !== activeCrewId && activeCrewId ? button("↩", "follow-active", 'aria-label="↩ Active" title="Return to active crew"') : ""}</div></div>${editing?.kind === "move" && editing.crew === c.id ? moveEditor(c) : ""}${location ? stationWarning(location.ship, location.station) : ""}${vessel ? shipSnapshot(vessel, c) : ""}${
    location
      ? `<div class="available-actions">${crewActions(location.station, c)
          .filter((a) => !isSavingThrow(a))
          .map((a) =>
            actionItem(location.ship, location.station, location.index, a, c),
          )
          .join(
            "",
          )}${location.station.actions.map((a) => configuration(location.ship, location.station, location.index, a, c)).join("")}</div>`
      : '<p class="context">Choose a seat to access its actions.</p>'
  }</section>`;
}
function savingThrows(s: Ship, c: Crew) {
  const location = seatOf(c);
  if (!location || location.ship.id !== s.id) return "";
  const saves = crewActions(location.station, c).filter(isSavingThrow);
  return saves.length
    ? `<section class="saving-throws" aria-label="Saving throws">${saves.map((a) => actionItem(s, location.station, location.index, a, c, true)).join("")}</section>`
    : "";
}
function stationWarning(s: Ship, st: Station) {
  const blocked = rollBlockers(s, st);
  return blocked.length
    ? `<p class="station-warning">Rolls disabled: ${blocked.map(escapeHtml).join(", ")} · right-click to force</p>`
    : "";
}
function shipDetail() {
  const s = ship();
  if (!s)
    return `<p class="empty">No ships loaded. The GM can import ships from the Import tab.</p>`;
  return `<section class="ship-detail"><div class="ship-heading"><h2>${escapeHtml(s.name)}</h2><span class="muted">${s.kind} · ${escapeHtml(s.class)}</span></div><nav class="tabs" aria-label="Ship sections">${["Status", "Stations", "Crew"].map((t) => button(t, "section", `data-value="${t}" aria-current="${section === t ? "page" : "false"}"`)).join("")}</nav><div class="ship-content">${section === "Status" ? status(s) : section === "Stations" ? stationScreen(s) : crewCards(s.kind === "Player" ? playerCrew() : crew.filter((c) => c.ship === s.id))}</div></section>`;
}
function damageActor() {
  return role === "Player"
    ? selectedCrewId || undefined
    : (activeCrewId ?? undefined);
}
function updateDamageTrigger() {
  const select = app.querySelector<HTMLSelectElement>("#damage-actor");
  if (!select || editing?.kind !== "damage") return;
  const choices =
    ship().parts[editing.part].levels[ship().parts[editing.part].damage];
  const selected = app.querySelector<HTMLSelectElement>("#effect")?.value;
  const effect =
    choices.length === 1 ? choices[0] : choices.find((e) => e.id === selected);
  const needed = effect?.duration?.unit === "crewTurns";
  select.required = needed;
  select.disabled = !needed;
  select.closest<HTMLElement>("[data-damage-trigger]")!.hidden = !needed;
}
function status(s: Ship) {
  const stats = effectiveStats(s);
  const effects = activeEffects(s);
  return `<div class="stats-strip">${(
    [
      ["ac", "AC"],
      ["maxG", "maxG"],
      ["speed", "Speed"],
    ] as const
  )
    .map(([key, label]) =>
      key === "maxG"
        ? `<div class="g-indicator ${(s.gs ?? 0) > stats.maxG ? "over-limit" : ""}"><span>Gs</span><strong>${s.gs ?? 0}</strong><small>maxG ${stats.maxG}</small></div>`
        : `<div><span>${label}</span><strong>${stats[key]}${key === "speed" ? "<small>km</small>" : ""}</strong><small>${stats[key] === s.stats[key] ? "Base value" : `Base ${s.stats[key]} · ${stats[key] - s.stats[key] > 0 ? "+" : ""}${stats[key] - s.stats[key]}`}</small></div>`,
    )
    .join("")}</div>
  ${ammunitionList(s)}<div class="systems">${s.parts.map((p, i) => `<article class="system"><div class="system-row"><div class="system-name"><strong>${escapeHtml(p.name)}</strong><span class="damage-track" aria-hidden="true">${p.levels.map((_, j) => `<i class="${j < p.damage ? `severity-${Math.min(p.damage, 3)}` : ""}"></i>`).join("")}</span></div><span class="damage-count">${p.damage}/${p.levels.length}</span>${button("−", "repair", `data-part="${i}" aria-label="Repair ${escapeHtml(p.name)}" ${!p.damage ? "disabled" : ""}`)}${button("+", "damage", `data-part="${i}" aria-label="Damage ${escapeHtml(p.name)}" ${p.damage === p.levels.length ? "disabled" : ""}`)}</div>${editing?.kind === "damage" && editing.part === i ? `<form class="inline-editor" data-form="damage" data-part="${i}" data-from="${p.damage}"><label for="effect">${escapeHtml(p.name)}: ${p.damage} → ${p.damage + 1} · select effect</label>${p.levels[p.damage].length > 1 ? `<select id="effect" name="effect" required><option value="">Choose an effect…</option>${p.levels[p.damage].map((e) => `<option value="${e.id}">${escapeHtml(e.name)}</option>`).join("")}</select>` : ""}${!damageActor() && p.levels[p.damage].some((e) => e.duration?.unit === "crewTurns") ? `<div data-damage-trigger><label for="damage-actor">Triggering crew</label><select id="damage-actor" name="damageActor" required><option value="">Choose crew…</option>${crew.map((c) => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join("")}</select></div>` : ""}${p.levels[p.damage].map((e) => `<div class="choice-info"><strong>${escapeHtml(e.name)}</strong>${effectInfo(e, `damage-choice:${s.id}:${i}:${e.id}`)}</div>`).join("")}<div class="form-actions">${button("Cancel", "cancel")}<button class="primary">Apply damage</button></div></form>` : ""}</article>`).join("")}${autonomyControl(s)}</div>
  <details class="reference"><summary>Damage levels & effects</summary>${s.parts.map((p, i) => `<details class="part-reference"><summary>${escapeHtml(p.name)} · ${p.levels.length} levels</summary>${p.levels.map((options, level) => `<div class="level-reference"><span>${level + 1}</span><div>${options.length ? options.map((e) => effectEntry(e, `level:${s.id}:${i}:${level}:${e.id}`)).join("") : "<small>No additional effect</small>"}</div></div>`).join("")}</details>`).join("")}</details>
  <div class="section-label"><h3>Active effects</h3>${pill(String(effects.length))}</div>${effectList(s, `active:${s.id}`)}`;
}
function selectionEditor(s: Ship, st: Station, a: Action, c: Crew) {
  const pending =
    s.pendingSelections?.filter(
      (p) => p.actionId === a.id && p.stationId === st.id && p.crewId === c.id,
    ) ?? [];
  return pending
    .map((p) =>
      editing?.kind === "selection" && editing.selectionId === p.id
        ? `<form class="inline-editor" data-form="${p.kind === "remove" ? "remove-effect" : "target-ship"}" data-ship="${s.id}" data-selection="${p.id}"><p class="context">Activation costs spent. Cancel does not refund ammunition or cooldowns.</p>${
            p.kind === "remove"
              ? `<label for="remove-effect-choice">Choose a ${escapeHtml(p.effectType ?? "General")} effect</label><select id="remove-effect-choice" name="effectKey" required><option value="">Choose effect…</option>${activeEffects(
                  s,
                )
                  .filter(
                    (entry) =>
                      (entry.effect.type ?? "General") === p.effectType,
                  )
                  .map(
                    (entry) =>
                      `<option value="${escapeHtml(entry.key)}">${escapeHtml(entry.effect.name)} · ${escapeHtml(entry.source)}</option>`,
                  )
                  .join("")}</select>`
              : `<label for="target-ship-choice">Choose target ship</label><select id="target-ship-choice" name="targetShip" required aria-label="Target ship for ${escapeHtml(a.name)}"><option value="">Choose ship…</option>${ships
                  .filter((v) => role === "GM" || v.kind === "Player")
                  .map(
                    (v) =>
                      `<option value="${v.id}">${escapeHtml(v.name)}</option>`,
                  )
                  .join("")}</select>`
          }<div class="form-actions">${button("Cancel", "cancel")}<button class="primary">${p.kind === "remove" ? "Remove effect" : "Apply effects"}</button></div></form>`
        : button(
            "Finish selection…",
            "resume-selection",
            `data-ship="${s.id}" data-value="${p.id}" title="Activation already paid"`,
          ),
    )
    .join("");
}
function actionItem(
  s: Ship,
  st: Station,
  stationIndex: number,
  a: Action,
  c: Crew,
  compactSave = false,
) {
  const key = `action:${s.id}:${st.id}:${c.id}:${a.id}`;
  const missing = missingEffects(s, a);
  const unavailable = c.disabled || missing.length > 0;
  const removable =
    a.kind === "remove-effect"
      ? activeEffects(s).filter(
          (entry) => (entry.effect.type ?? "General") === a.effectType,
        )
      : [];
  const slots = cooldownSlots(s, st, a);
  const cooldowns = slots.length
    ? `<div class="cooldown-slots" aria-label="Action cooldowns">${a.cooldownName ? `<span class="cooldown-name" title="Shared station cooldown">${escapeHtml(a.cooldownName)}</span>` : ""}${slots.map((slot) => `<span class="cooldown-slot ${slot.remaining ? "charging" : "ready"}" role="img" aria-label="Cooldown ${slot.index + 1}: ${slot.remaining ? `${slot.remaining} rounds remaining` : "ready"}, duration ${slot.duration}" title="Slot ${slot.index + 1} · ${slot.remaining ? `${slot.remaining} rounds remaining` : "Ready"} · ${slot.duration} round cooldown"><i style="--fill:${slot.remaining ? Math.min(100, (100 * slot.remaining) / Math.max(slot.duration, slot.remaining)) : 0}%"></i><span>${slot.remaining || `✓ ${slot.duration}`}</span></span>`).join("")}</div>`
    : "";
  const pool = ammunitionPool(s, a);
  const ammunition = a.ammunition
    ? `<small class="action-ammunition ${ammunitionAvailable(s, a) ? "" : "depleted"}">${escapeHtml(a.ammunition.name)} ${pool ? `${pool.current}/${pool.capacity}` : "unavailable"} · −${a.ammunition.cost ?? 1}</small>`
    : "";
  const activation = activationRolls(a);
  let activationLabel = "";
  try {
    activationLabel = activation
      .map((r) => rollNotation(s, st, activationType(a), r, c, undefined, a.id))
      .join(", ");
  } catch (error) {
    activationLabel = error instanceof Error ? error.message : "Invalid roll";
  }
  const useButton =
    separateActivation(a) &&
    !(
      a.kind === "utility" &&
      a.gs?.on === "button" &&
      !a.ammunition &&
      a.cooldown === undefined
    )
      ? button(
          `${a.kind === "remove-effect" ? "Remove…" : "Use"}${activationLabel ? `<small>${escapeHtml(activationLabel)}</small>` : ""}${a.ammunition ? `<small>−${a.ammunition.cost ?? 1}</small>` : ""}`,
          requiresSelection(a)
            ? a.kind === "remove-effect"
              ? "choose-remove-effect"
              : "activate-selection"
            : "use",
          `class="roll-button" data-ship="${s.id}" data-station="${stationIndex}" data-crew="${c.id}" data-value="${a.id}" ${activation.length ? 'data-activation-roll="true"' : ""} aria-label="Use ${escapeHtml(a.name)}" ${activation.length ? `aria-disabled="${Boolean(unavailable || (a.kind === "remove-effect" && !removable.length) || rollBlockers(s, st).length || cooldownBlocked(s, st, a) || !ammunitionAvailable(s, a))}"` : unavailable || (a.kind === "remove-effect" && !removable.length) || cooldownBlocked(s, st, a) || !ammunitionAvailable(s, a) ? "disabled" : ""}`,
        )
      : "";
  const activationAdvantage = activation[0]
    ? rollAdjustments(s, st, activationType(a), activation[0], c).advantage
    : 0;
  const activationButton = activation.length
    ? `<span class="roll-control">${useButton}${activationAdvantage ? `<span class="adv-indicator ${activationAdvantage > 0 ? "advantage" : "disadvantage"}" aria-label="${activationAdvantage > 0 ? "Advantage" : "Disadvantage"} ${Math.abs(activationAdvantage)}">${activationAdvantage > 0 ? "↑" : "↓"}${Math.abs(activationAdvantage)}</span>` : ""}</span>`
    : useButton;
  const rolls = actionRolls(a)
    .map((r, index) => {
      if (requiresSelection(a) && r.kind === "hitRoll") return "";
      const adjusted = rollAdjustments(
        s,
        st,
        a.kind === "roll" ? a.type : "",
        r,
        c,
      );
      const disabled =
        unavailable ||
        rollBlockers(s, st).length > 0 ||
        (r.kind === "hitRoll" &&
          !separateActivation(a) &&
          (cooldownBlocked(s, st, a) || !ammunitionAvailable(s, a)));
      let notation: string;
      try {
        notation = rollNotation(
          s,
          st,
          a.kind === "roll" ? a.type : "",
          r,
          c,
          undefined,
          a.id,
        );
      } catch (error) {
        notation =
          error instanceof Error ? error.message : "Unsupported notation";
      }
      const cat = damageCategory(s, st, a.id, r);
      return `<span class="roll-control">${button(`${escapeHtml(compactSave ? `${a.name}${actionRolls(a).length > 1 ? ` · ${r.label}` : ""}` : r.label)}<small>${escapeHtml(notation)}${cat !== undefined ? ` <span class="cat-label">CAT${cat}</span>` : ""}</small>`, "roll", `class="roll-button" data-ship="${s.id}" data-station="${stationIndex}" data-crew="${c.id}" data-value="${a.id}" data-roll-index="${index}" aria-label="Roll ${escapeHtml(a.name)} ${r.kind === "effectRoll" ? "effect" : "hit"}" aria-disabled="${disabled}" title="${r.kind === "hitRoll" ? "Hit roll" : "Effect roll"}. ${disabled ? "Unavailable for normal rolls. " : ""}Right-click or Shift+F10 to force a roll."`)}${adjusted.advantage ? `<span class="adv-indicator ${adjusted.advantage > 0 ? "advantage" : "disadvantage"}" aria-label="${adjusted.advantage > 0 ? "Advantage" : "Disadvantage"} ${Math.abs(adjusted.advantage)}">${adjusted.advantage > 0 ? "↑" : "↓"}${Math.abs(adjusted.advantage)}</span>` : ""}</span>`;
    })
    .join("");
  const menu =
    rollMenu &&
    rollMenu.shipId === s.id &&
    rollMenu.stationId === st.id &&
    rollMenu.crewId === c.id &&
    rollMenu.actionId === a.id;
  const menuRoll = menu
    ? rollMenu!.activation
      ? activationRolls(a)[0]
      : actionRolls(a)[rollMenu!.rollIndex]
    : undefined;
  const menuCategory = menuRoll
    ? damageCategory(s, st, a.id, menuRoll, rollMenu!.categoryShift)
    : undefined;
  const categoryMenu =
    menuRoll && isDamageRoll(menuRoll)
      ? `<div class="category-menu">${menuCategory !== undefined ? `${button("Improve", "category-shift", `data-value="1" ${menuCategory === 1 ? "disabled" : ""} title="Improve CAT: smaller number and die"`)}<strong>CAT${menuCategory} · d${categoryDie(menuCategory)}</strong>${button("Worsen", "category-shift", `data-value="-1" ${menuCategory === 5 ? "disabled" : ""} title="Worsen CAT: larger number and die"`)}${button("Reset", "category-reset", `title="Use effect-adjusted CAT" ${!rollMenu!.categoryShift ? "disabled" : ""}`)}` : "<small>CAT needs one damage die size: d4, d6, d8, d10 or d12.</small>"}</div>`
      : "";
  return `<article class="action-item ${compactSave ? "compact-save" : ""}"><div class="action-line"><div class="action-identity">${compactSave ? "" : actionName(a, key)}${actionValues(a)}${a.grantsEffects ? `<small class="granted-effects">Gives: ${a.grantsEffects.map((e) => escapeHtml(e.name)).join(", ")}</small>` : ""}${cooldowns}${ammunition}${missing.length ? `<small class="action-missing">Requires: ${missing.map(escapeHtml).join(", ")}</small>` : ""}${a.kind === "remove-effect" && !removable.length ? `<small>No ${escapeHtml(a.effectType)} effects</small>` : ""}</div><div class="action-rolls ${a.kind === "roll" && separateActivation(a) ? "separate-rolls" : ""}">${activationButton}${rolls}${gsButton(s, stationIndex, a, c)}</div></div>${compactSave ? "" : actionDescription(a, key)}${selectionEditor(s, st, a, c)}${menu ? `<div class="roll-menu" aria-label="Force roll">${categoryMenu}<span>Force ${escapeHtml(menuRoll?.label ?? "action")}</span>${(["advantage", "disadvantage", "normal"] as const).map((mode) => button(mode, "force-roll", `data-value="${mode}"`)).join("")}${button("×", "close-roll-menu", 'aria-label="Close roll options"')}</div>` : ""}</article>`;
}
function gsButton(s: Ship, index: number, a: Action, c: Crew) {
  return a.gs?.on === "button"
    ? button(
        `${a.gs.amount >= 0 ? "+" : "−"}${Math.abs(a.gs.amount)} Gs`,
        "action-gs",
        `data-ship="${s.id}" data-station="${index}" data-value="${a.id}" data-crew="${c.id}" ${c.disabled || missingEffects(s, a).length ? "disabled" : ""}`,
      )
    : "";
}
function configuration(
  s: Ship,
  st: Station,
  index: number,
  action: Action,
  actor?: Crew,
) {
  if (action.kind !== "effects") return "";
  const missing = missingEffects(s, action);
  const actors = crew.filter((c) => st.seats.includes(c.id) && !c.disabled);
  const enabled =
    (actor
      ? !actor.disabled && st.seats.includes(actor.id)
      : usableCrew(st, crew)) && missing.length === 0;
  const selected = st.selectedEffects[action.id] ?? [];
  const key = `config:${s.id}:${st.id}:${action.id}`;
  return `<div class="configuration"><div class="action-row"><div>${actionName(action, key)}<small>${
    selected.length
      ? action.effects
          .filter((e) => selected.includes(e.id))
          .map((e) => escapeHtml(e.name))
          .join(" · ")
      : ""
  }</small></div>${button("Configure", "configure", `data-station="${index}" data-value="${action.id}" ${enabled ? "" : "disabled"}`)}</div>${(actor ?? actors[0]) ? gsButton(s, index, action, (actor ?? actors[0])!) : ""}${actionValues(action)}${actionDescription(action, key)}${missing.length ? `<small class="action-missing">Requires: ${missing.map(escapeHtml).join(", ")}</small>` : ""}${!enabled ? '<p class="context">Seat enabled crew here to change effects. Existing effects remain active.</p>' : ""}${editing?.kind === "effects" && editing.station === index && editing.action === action.id ? `<form class="inline-editor" data-form="effects" data-station="${index}" data-action-id="${action.id}"><label for="effect-actor">Triggering crew</label><select id="effect-actor" name="actor" required>${actors.map((c) => `<option value="${c.id}" ${c.id === (actor?.id ?? actors[0]?.id) ? "selected" : ""}>${escapeHtml(c.name)}</option>`).join("")}</select>${action.effects.map((e) => `<div class="effect-option"><input type="checkbox" name="effect" aria-label="${escapeHtml(e.name)}" value="${e.id}" ${selected.includes(e.id) ? "checked" : ""} ${enabled ? "" : "disabled"}/>${effectEntry(e, `${key}:${e.id}`)}</div>`).join("")}<div class="form-actions">${button("Cancel", "cancel")}<button class="primary" ${enabled ? "" : "disabled"}>Apply effects</button></div></form>` : ""}</div>`;
}
function stationScreen(s: Ship) {
  return `<p class="context">${role === "GM" ? "Private GM rolls" : "Public player rolls"} · effect-adjusted notation</p>${s.stations
    .map(
      (st, i) =>
        `<details class="station" data-station-panel="${i}" ${expandedStations.has(i) ? "open" : ""}><summary><strong>${escapeHtml(st.name)}</strong><span>${st.seats.filter(Boolean).length}/${st.seats.length} seated</span></summary><div class="station-body">${stationWarning(s, st)}${st.actions.map((a) => configuration(s, st, i, a)).join("")}${st.seats
          .map((id, j) => {
            const c = crew.find((c) => c.id === id);
            return `<div class="seat ${c?.disabled ? "disabled-seat" : ""}"><div class="seat-heading"><div><strong>${c ? escapeHtml(c.name) : "Empty seat"}</strong><small>Seat ${j + 1} · ${c ? `${escapeHtml(st.type)} +${c.modifiers[st.type] ?? 0}${c.disabled ? " · Disabled" : ""}` : st.type}</small></div>${button(c ? "Change" : "Assign", "seat", `data-station="${i}" data-seat="${j}"`)}</div>${editing?.kind === "seat" && editing.station === i && editing.seat === j ? seatEditor(s, i, j) : ""}${
              c
                ? crewActions(st, c)
                    .filter((a) => !isSavingThrow(a))
                    .map((a) => actionItem(s, st, i, a, c))
                    .join("")
                : `<div class="context">When seated:${st.actions
                    .filter((a) => a.kind !== "effects" && !isSavingThrow(a))
                    .map(
                      (a) =>
                        `<div>${escapeHtml(a.name)}${actionValues(a)}${description(a.description, `empty:${s.id}:${i}:${j}:${a.id}`)}</div>`,
                    )
                    .join("")}</div>`
            }</div>`;
          })
          .join("")}</div></details>`,
    )
    .join("")}`;
}
function seatEditor(s: Ship, station: number, seat: number) {
  const available =
    s.kind === "Player" ? playerCrew() : crew.filter((c) => c.ship === s.id);
  return `<form class="inline-editor" data-form="seat" data-station="${station}" data-seat="${seat}"><label for="crew-select">Crew member</label><select id="crew-select" name="crew"><option value="">Leave empty</option>${available.map((c) => `<option value="${c.id}" ${s.stations[station].seats[seat] === c.id ? "selected" : ""}>${escapeHtml(c.name)}${c.disabled ? " (disabled)" : ""}</option>`).join("")}</select><p class="context">Moves crew out of their previous seat.</p><div class="form-actions">${button("Cancel", "cancel")}<button class="primary">Assign</button></div></form>`;
}
function crewCards(members: Crew[]) {
  return members
    .map(
      (c) =>
        `<details class="crew-item" data-crew-panel="${c.id}" ${expandedCrew.has(c.id) || (editing?.kind === "move" && editing.crew === c.id) ? "open" : ""}><summary><span><strong>${escapeHtml(c.name)}</strong><small>${escapeHtml(whereabouts(c.id))}</small></span>${pill(c.disabled ? "Disabled" : "Ready")}</summary><div class="crew-body"><div class="modifiers">${Object.entries(
          c.modifiers,
        )
          .map(
            ([key, value]) =>
              `<span>${escapeHtml(key)} <strong>+${value}</strong></span>`,
          )
          .join(
            "",
          )}</div><p class="context">${escapeHtml(c.role)} · ${escapeHtml(
          Object.values(c.stationActions)
            .flat()
            .map((a) => a.name)
            .join(" · "),
        )}</p>${initiativeControl(c)}${role === "GM" ? `<label class="initiative-input">Manual initiative<input type="number" value="${c.initiative ?? ""}" data-init="${c.id}"/></label>` : ""}<div class="toolbar">${button("Move crew", "move", `data-value="${c.id}"`)}${button(c.disabled ? "Enable" : "Disable", "disable", `data-value="${c.id}"`)}</div>${editing?.kind === "move" && editing.crew === c.id ? moveEditor(c) : ""}</div></details>`,
    )
    .join("");
}
function moveEditor(c: Crew) {
  const eligible = ships.filter((s) =>
    s.kind === "Player" ? playerCrew().includes(c) : s.id === c.ship,
  );
  return `<form class="inline-editor" data-form="move" data-crew="${c.id}"><label for="destination">Destination seat</label><select id="destination" name="destination">${eligible.flatMap((s) => s.stations.flatMap((st, i) => st.seats.map((id, j) => `<option value="${s.id}:${i}:${j}" ${id && id !== c.id ? "disabled" : ""}>${escapeHtml(s.name)} / ${escapeHtml(st.name)} ${j + 1}${id ? " (occupied)" : ""}</option>`))).join("")}</select><div class="form-actions">${button("Cancel", "cancel")}<button class="primary">Move</button></div></form>`;
}
function fleet() {
  const visible =
    role === "GM" ? ships : ships.filter((s) => s.kind === "Player");
  return `<div class="fleet-select"><label for="ship-select">${role === "GM" ? "Ship library" : "Your fleet"}</label><select id="ship-select">${visible.map((s) => `<option value="${s.id}" ${shipId === s.id ? "selected" : ""}>${escapeHtml(s.name)} · ${s.kind}</option>`).join("")}</select></div>${shipDetail()}`;
}
function crewScreen() {
  return `${heading(role === "GM" ? "Crew roster" : "Your crew")}<p class="context">${role === "GM" ? "NPC crew stay with their ship." : "Mara Voss · player fleet crew"}</p>${crewCards(role === "GM" ? crew : playerCrew())}`;
}
function encounters() {
  return `${heading("Saved encounters", button("+ New", "new-encounter"))}${savedEncounters.map((e) => `<article class="saved-encounter"><h2>${escapeHtml(e.name)}</h2><p class="context">${e.shipIds.length} ships · Round ${e.round} · ${e.running ? "In progress" : "Paused"}</p><div class="toolbar">${button("Edit", "edit-encounter", `data-value="${e.id}"`)}${button("Open →", "open-encounter", `data-value="${e.id}" class="primary"`)}</div></article>`).join("") || '<p class="empty">Create or import your first encounter.</p>'}`;
}
function encounterEditor() {
  const selected = savedEncounters.find((e) => e.id === editingEncounterId);
  return `${heading(freshEncounter ? "New encounter" : "Edit encounter")}<form data-form="encounter" class="encounter-form"><label for="encounter-name">Name</label><input id="encounter-name" name="name" required value="${freshEncounter ? "" : escapeHtml(selected?.name ?? encounterName)}" placeholder="Encounter name"/><h3>Include ships</h3>${ships.map((s) => `<label class="check-row"><input type="checkbox" name="ship" value="${s.id}" ${!freshEncounter && (selected?.shipIds ?? encounterIds).includes(s.id) ? "checked" : ""}/><span><strong>${escapeHtml(s.name)}</strong><small>${s.kind} · ${escapeHtml(s.class)}</small></span></label>`).join("")}<div class="form-actions">${button("Cancel", "nav", 'data-value="Encounters"')}<button class="primary">${freshEncounter ? "Create" : "Save"} encounter</button></div></form>`;
}
function importScreen() {
  return `${heading("Library JSON", button("Export", "export"))}<p class="context">Player ships and crew go to this scene; NPCs and encounters stay in this GM browser. Export a backup before replacing a library.</p><label for="import-mode">Import mode</label><select id="import-mode"><option value="replace" ${importMode === "replace" ? "selected" : ""}>Replace library</option><option value="merge" ${importMode === "merge" ? "selected" : ""}>Merge entries</option></select><label for="import-file">Open JSON file</label><input id="import-file" type="file" accept="application/json,.json"/><label for="json">Or paste JSON</label><textarea id="json" rows="9" spellcheck="false">${escapeHtml(importText)}</textarea><div class="toolbar">${button("Preview import", "preview-json", 'class="primary"')}${button("Example JSON", "sample-json")}</div><div id="import-result" role="status">${importError ? `<p class="error">${escapeHtml(importError)}</p>` : importPreview ? `<p>${importPreview.ships?.length ?? 0} ships · ${importPreview.crew?.length ?? 0} crew · ${importPreview.encounters?.length ?? 0} encounters</p><p class="context">${importMode === "replace" ? `Replaces the entire current library, including starter data. Removes ${ships.filter((s) => !importPreview!.ships?.some((entry) => entry.id === s.id)).length} ships, ${crew.filter((c) => !importPreview!.crew?.some((entry) => entry.id === c.id)).length} crew and ${savedEncounters.filter((e) => !importPreview!.encounters?.some((entry) => entry.id === e.id)).length} encounters absent from this JSON. Omitted collections become empty.` : "Merges entries by ID; matching entries are replaced and other entries are kept."} All references and assignments are validated before saving.</p>${button("Import library", "import-library", 'class="primary"')}` : ""}</div>`;
}
app.addEventListener(
  "toggle",
  (e) => {
    const d = e.target as HTMLDetailsElement;
    if (!d.isConnected) return;
    if (d.dataset.detail === "tracker") {
      if (d.open) {
        expandedDetails.delete("tracker-closed");
        scrollToActiveCrew();
      } else expandedDetails.add("tracker-closed");
    }
    if (d.dataset.detail) {
      if (d.open) expandedDetails.add(d.dataset.detail);
      else expandedDetails.delete(d.dataset.detail);
    }
    if (d.dataset.crewPanel) {
      if (d.open) expandedCrew.add(d.dataset.crewPanel);
      else expandedCrew.delete(d.dataset.crewPanel);
    }
    if (d.dataset.stationPanel !== undefined) {
      const i = Number(d.dataset.stationPanel);
      if (d.open) expandedStations.add(i);
      else expandedStations.delete(i);
    }
  },
  true,
);
const session = createSession((view) => {
  if (sceneSession !== view.sessionId) {
    sceneSession = view.sessionId;
    editing = null;
    rollMenu = null;
    inspectedCrewId = null;
    expandedDetails.clear();
    renderedView = "";
  }
  const wasPlayer = role === "Player";
  ships = view.ships;
  crew = view.crew;
  savedEncounters = view.encounters;
  if (activeEncounterId !== view.activeEncounterId) inspectedCrewId = null;
  activeEncounterId = view.activeEncounterId;
  role = view.role;
  connected = view.ready;
  connectionStatus = view.status;
  const active = savedEncounters.find((e) => e.id === activeEncounterId);
  encounterName = active?.name ?? "";
  encounterIds =
    active?.shipIds.filter((id) => ships.some((s) => s.id === id)) ?? [];
  round = active?.round ?? view.round;
  activeCrewId = active?.currentCrewId ?? null;
  running = active?.running ?? false;
  if (
    role === "Player" &&
    !["My actions", "My ships", "My crew"].includes(screen)
  )
    screen = "My actions";
  if (role === "GM" && wasPlayer) screen = "Encounter";
  if (
    !ships.some(
      (s) => s.id === shipId && (role === "GM" || s.kind === "Player"),
    )
  )
    shipId = ships.find((s) => role === "GM" || s.kind === "Player")?.id ?? "";
  if (!playerCrew().some((c) => c.id === selectedCrewId))
    selectedCrewId = playerCrew()[0]?.id ?? "";
  if (screen === "Encounter" && encounterView === "actions") {
    const c = crew.find((c) => c.id === (inspectedCrewId ?? activeCrewId));
    if (c) shipId = seatOf(c)?.ship.id ?? c.ship;
  }
  if (screen === "My actions") {
    const c = playerCrew().find((c) => c.id === selectedCrewId);
    const location = c ? seatOf(c) : null;
    if (location) shipId = location.ship.id;
  }
  render();
});
async function commit(command: Command) {
  busy = true;
  render();
  try {
    const result = await session.command(command);
    message = result.notice || "Saved.";
    return true;
  } catch (error) {
    message =
      error instanceof Error ? error.message : "Could not save the change.";
    return false;
  } finally {
    busy = false;
    render();
  }
}
async function performSelection(
  command: Extract<Command, { op: "activate-selection" | "selection-preview" }>,
) {
  busy = true;
  render();
  try {
    const result = await session.activateSelection(command);
    editing = {
      kind: "selection",
      selectionId: result.selectionId,
      shipId: command.shipId,
      crew: command.crewId,
      action: command.actionId,
    };
    message = result.notice;
  } catch (error) {
    message =
      error instanceof Error ? error.message : "Could not activate action.";
  } finally {
    busy = false;
    render();
  }
}
async function performRoll(command: Command) {
  busy = true;
  render();
  try {
    message = await session.roll(command);
  } catch (error) {
    message = error instanceof Error ? error.message : "Could not roll.";
  } finally {
    busy = false;
    render();
  }
}
app.addEventListener("contextmenu", (e) => {
  const b = (e.target as HTMLElement).closest<HTMLButtonElement>(
    '[data-action="roll"][data-roll-index], [data-action="activate-selection"][data-activation-roll], [data-action="choose-remove-effect"][data-activation-roll]',
  );
  if (!b || busy) return;
  e.preventDefault();
  const s = ships.find((s) => s.id === b.dataset.ship);
  if (!s) return;
  rollMenu = {
    shipId: s.id,
    stationId: s.stations[Number(b.dataset.station)].id,
    crewId: b.dataset.crew as string,
    actionId: b.dataset.value as string,
    rollIndex: Number(b.dataset.rollIndex ?? 0),
    categoryShift: 0,
    activation: b.dataset.action !== "roll",
  };
  render();
  app.querySelector<HTMLButtonElement>(".roll-menu button")?.focus();
});
app.addEventListener("keydown", (e) => {
  if (
    e.key === "Enter" &&
    e.target instanceof HTMLInputElement &&
    e.target.dataset.init
  ) {
    e.preventDefault();
    e.target.blur();
    return;
  }
  if ((e.key === "F10" && e.shiftKey) || e.key === "ContextMenu") {
    const target = (e.target as HTMLElement).closest(
      '[data-action="roll"][data-roll-index], [data-action="activate-selection"][data-activation-roll], [data-action="choose-remove-effect"][data-activation-roll]',
    );
    if (target) {
      e.preventDefault();
      target.dispatchEvent(
        new MouseEvent("contextmenu", { bubbles: true, cancelable: true }),
      );
    }
  }
  if (e.key === "Escape" && rollMenu) {
    rollMenu = null;
    render();
  }
});
app.addEventListener("input", (e) => {
  const input = e.target as HTMLInputElement;
  if (input.id === "json") {
    importText = input.value;
    importPreview = null;
    importError = "";
    const result = app.querySelector("#import-result");
    if (result) result.textContent = "";
  }
});
app.addEventListener("change", async (e) => {
  const input = e.target as HTMLInputElement;
  if (input.id === "effect") {
    updateDamageTrigger();
  } else if (input.id === "theme-mode") {
    themePreference = input.value;
    applyPreviewTheme();
  } else if (input.id === "role" && !OBR.isAvailable) {
    editing = null;
    rollMenu = null;
    message = "";
    session.setDemoRole(input.value as "GM" | "Player");
  } else if (input.id === "crew-self") {
    selectedCrewId = input.value;
    editing = null;
    rollMenu = null;
    const c = playerCrew().find((c) => c.id === selectedCrewId);
    const location = c ? seatOf(c) : null;
    if (location) shipId = location.ship.id;
    render();
  } else if (input.id === "ship-select") {
    shipId = input.value;
    editing = null;
    render();
  } else if (input.id === "import-mode") {
    importMode = input.value as "replace" | "merge";
    importPreview = null;
    importError = "";
    render();
  } else if (input.id === "import-file") {
    const file = input.files?.[0];
    if (!file) return;
    try {
      if (file.size > 3000000)
        throw new Error(
          "File too large. Split the library into smaller files.",
        );
      importText = await file.text();
      importPreview = null;
      importError = "";
    } catch (error) {
      importError =
        error instanceof Error ? error.message : "Could not read the file.";
    }
    render();
  } else if (input.dataset.init)
    await commit({
      op: "initiative",
      crewId: input.dataset.init,
      value: input.value === "" ? null : Number(input.value),
    });
});
app.addEventListener("submit", async (e) => {
  const form = e.target as HTMLFormElement;
  e.preventDefault();
  if (busy) return;
  const data = new FormData(form);
  let command: Command;
  switch (form.dataset.form) {
    case "remove-effect":
    case "target-ship":
      command = {
        op: "resolve-selection",
        shipId: form.dataset.ship as string,
        selectionId: form.dataset.selection as string,
        key: String(data.get("effectKey") ?? "") || undefined,
        targetShipId: String(data.get("targetShip") ?? "") || undefined,
      };
      break;
    case "damage":
      command = {
        op: "damage",
        shipId,
        part: Number(form.dataset.part),
        from: Number(form.dataset.from),
        choice: String(data.get("effect")) || undefined,
        crewId: damageActor() ?? (String(data.get("damageActor")) || undefined),
      };
      break;
    case "effects":
      command = {
        op: "effects",
        shipId,
        stationId: ship().stations[Number(form.dataset.station)].id,
        actionId: form.dataset.actionId as string,
        choices: data.getAll("effect").map(String),
        crewId: String(data.get("actor")) || undefined,
      };
      break;
    case "seat":
      command = {
        op: "seat",
        shipId,
        stationId: ship().stations[Number(form.dataset.station)].id,
        seat: Number(form.dataset.seat),
        crewId: String(data.get("crew")) || null,
      };
      break;
    case "move": {
      const [id, i, j] = String(data.get("destination")).split(":");
      command = {
        op: "move",
        shipId: id,
        stationId: ships.find((s) => s.id === id)!.stations[Number(i)].id,
        seat: Number(j),
        crewId: form.dataset.crew as string,
      };
      break;
    }
    case "encounter":
      command = {
        op: "encounter",
        encounter: {
          ...(freshEncounter
            ? { round: 1, turn: 0, currentCrewId: null, running: true }
            : (savedEncounters.find(
                (e) => e.id === (editingEncounterId ?? activeEncounterId),
              ) ?? { round: 1, turn: 0, currentCrewId: null, running: true })),
          id: freshEncounter
            ? `enc-${crypto.randomUUID()}`
            : (editingEncounterId ?? (activeEncounterId as string)),
          name: String(data.get("name")),
          shipIds: data.getAll("ship").map(String),
        },
      };
      break;
    default:
      return;
  }
  if (await commit(command)) {
    editing = null;
    if (form.dataset.form === "encounter") screen = "Encounter";
    render();
  }
});
app.addEventListener("click", async (e) => {
  const b = (e.target as HTMLElement).closest<HTMLButtonElement>(
    "button[data-action]",
  );
  if (!b || busy) return;
  const value = b.dataset.value ?? "";
  message = "";
  switch (b.dataset.action) {
    case "nav":
      screen = value;
      editing = null;
      rollMenu = null;
      break;
    case "section":
      section = value;
      editing = null;
      rollMenu = null;
      break;
    case "ship":
      shipId = value;
      editing = null;
      break;
    case "reset":
      if (!OBR.isAvailable) location.reload();
      return;
    case "refresh":
      await session.refresh();
      return;
    case "pause":
      await commit({ op: "pause" });
      return;
    case "roll-all-initiatives":
    case "next-round":
    case "previous":
    case "next":
      inspectedCrewId = null;
      if (
        await commit({
          op: b.dataset.action as
            | "next"
            | "previous"
            | "next-round"
            | "roll-all-initiatives",
        })
      ) {
        const actor = initiativeActors(ships, crew, encounterIds).find(
          (a) => a.crew.id === activeCrewId,
        );
        if (actor) shipId = actor.ship.id;
      }
      editing = null;
      break;
    case "toggle-description":
      if (expandedDetails.has(value)) expandedDetails.delete(value);
      else expandedDetails.add(value);
      render();
      Array.from(
        app.querySelectorAll<HTMLButtonElement>(
          '[data-action="toggle-description"]',
        ),
      )
        .find((button) => button.dataset.value === value)
        ?.focus({ preventScroll: true });
      return;
    case "encounter-view":
      encounterView = value;
      editing = null;
      rollMenu = null;
      break;
    case "follow-active": {
      inspectedCrewId = null;
      const c = crew.find((c) => c.id === activeCrewId);
      if (c) shipId = seatOf(c)?.ship.id ?? c.ship;
      editing = null;
      break;
    }
    case "inspect-ship":
      shipId = value;
      section = "Status";
      if (role === "GM" && screen === "Encounter") encounterView = "ship";
      else screen = role === "GM" ? "Ships" : "My ships";
      editing = null;
      break;
    case "actor": {
      inspectedCrewId = value;
      editing = null;
      rollMenu = null;
      const c = crew.find((c) => c.id === value);
      if (c) {
        shipId = seatOf(c)?.ship.id ?? c.ship;
      }
      break;
    }
    case "new-encounter":
      freshEncounter = true;
      editingEncounterId = null;
      screen = "Edit encounter";
      editing = null;
      break;
    case "edit-encounter":
      freshEncounter = false;
      editingEncounterId = value || activeEncounterId;
      screen = "Edit encounter";
      editing = null;
      break;
    case "open-encounter":
      if (await commit({ op: "open-encounter", id: value })) {
        screen = "Encounter";
        shipId = encounterIds[0] ?? shipId;
      }
      break;
    case "dismiss-effect":
      await commit({
        op: "dismiss-effect",
        shipId: b.dataset.ship as string,
        key: value,
      });
      return;
    case "choose-remove-effect":
    case "activate-selection": {
      if (b.getAttribute("aria-disabled") === "true") return;
      const s = ships.find((s) => s.id === b.dataset.ship);
      if (!s) return;
      await performSelection({
        op: "activate-selection",
        shipId: s.id,
        stationId: s.stations[Number(b.dataset.station)].id,
        crewId: b.dataset.crew as string,
        actionId: value,
      });
      return;
    }
    case "resume-selection": {
      const s = ships.find((s) => s.id === b.dataset.ship),
        p = s?.pendingSelections?.find((p) => p.id === value);
      if (s && p)
        editing = {
          kind: "selection",
          selectionId: p.id,
          shipId: s.id,
          crew: p.crewId,
          action: p.actionId,
        };
      break;
    }
    case "action-gs": {
      const s = ships.find((s) => s.id === b.dataset.ship);
      if (s)
        await commit({
          op: "action-gs",
          shipId: s.id,
          stationId: s.stations[Number(b.dataset.station)].id,
          crewId: b.dataset.crew as string,
          actionId: value,
        });
      return;
    }
    case "ammunition":
      await commit({
        op: "ammunition",
        shipId: b.dataset.ship as string,
        name: value,
        delta: Number(b.dataset.delta) as -7 | -1 | 1 | 7,
      });
      return;
    case "use": {
      const s = ships.find((s) => s.id === b.dataset.ship);
      if (!s) return;
      await commit({
        op: "use",
        shipId: s.id,
        stationId: s.stations[Number(b.dataset.station)].id,
        actionId: value,
        crewId: b.dataset.crew as string,
      });
      return;
    }
    case "repair":
      editing = null;
      await commit({ op: "repair", shipId, part: Number(b.dataset.part) });
      return;
    case "damage": {
      const part = Number(b.dataset.part);
      const p = ship().parts[part];
      if (
        p.levels[p.damage]?.length > 1 ||
        (!damageActor() &&
          p.levels[p.damage]?.some(
            (effect) => effect.duration?.unit === "crewTurns",
          ))
      )
        editing = { kind: "damage", part };
      else {
        editing = null;
        await commit({
          op: "damage",
          shipId,
          part,
          from: p.damage,
          crewId: damageActor(),
        });
        return;
      }
      break;
    }
    case "configure": {
      const station = Number(b.dataset.station);
      if (usableCrew(ship().stations[station], crew))
        editing = { kind: "effects", station, action: value };
      break;
    }
    case "seat":
      expandedStations.add(Number(b.dataset.station));
      editing = {
        kind: "seat",
        station: Number(b.dataset.station),
        seat: Number(b.dataset.seat),
      };
      break;
    case "move":
      expandedCrew.add(value);
      editing = { kind: "move", crew: value };
      break;
    case "disable": {
      const c = crew.find((c) => c.id === value)!;
      await commit({ op: "disable", crewId: value, disabled: !c.disabled });
      return;
    }
    case "cancel":
      if (
        editing?.kind === "selection" &&
        !(await commit({
          op: "cancel-selection",
          shipId: editing.shipId,
          selectionId: editing.selectionId,
        }))
      )
        return;
      editing = null;
      break;
    case "close-roll-menu":
      rollMenu = null;
      break;
    case "category-shift":
      if (rollMenu)
        rollMenu.categoryShift = Math.max(
          -4,
          Math.min(4, rollMenu.categoryShift + Number(value)),
        );
      break;
    case "category-reset":
      if (rollMenu) rollMenu.categoryShift = 0;
      break;
    case "force-roll": {
      const target = rollMenu;
      if (!target) return;
      rollMenu = null;
      if (target.activation)
        await performSelection({
          op: "activate-selection",
          ...target,
          override: value as RollOverride,
        });
      else
        await performRoll({
          op: "roll",
          ...target,
          override: value as RollOverride,
        });
      return;
    }
    case "roll-initiative":
      await performRoll({ op: "initiative-roll", crewId: value });
      return;
    case "roll": {
      if (b.getAttribute("aria-disabled") === "true") return;
      const s = ships.find((s) => s.id === (b.dataset.ship || shipId));
      if (!s) return;
      await performRoll({
        op: "roll",
        shipId: s.id,
        stationId: s.stations[Number(b.dataset.station)].id,
        actionId: value,
        crewId: b.dataset.crew as string,
        ...(b.dataset.rollIndex !== undefined
          ? { rollIndex: Number(b.dataset.rollIndex) }
          : {}),
      });
      return;
    }
    case "preview-json":
      try {
        importPreview = librarySchema.parse(JSON.parse(importText));
        importError = "";
      } catch (error) {
        importPreview = null;
        importError = error instanceof Error ? error.message : "Invalid JSON.";
      }
      break;
    case "sample-json":
      importText = JSON.stringify(
        { version: 1, ships, crew, encounters: savedEncounters },
        null,
        2,
      );
      importPreview = null;
      importError = "";
      break;
    case "import-library":
      if (
        importPreview &&
        (await commit({
          op: "import",
          library: importPreview,
          mode: importMode,
        }))
      ) {
        importPreview = null;
        message = "Library imported.";
      }
      break;
    case "export": {
      const blob = new Blob(
        [
          JSON.stringify(
            { version: 1, ships, crew, encounters: savedEncounters },
            null,
            2,
          ),
        ],
        { type: "application/json" },
      );
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "crowbear-library.json";
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      return;
    }
  }
  render();
});
function applyTheme(theme: Theme) {
  const root = document.documentElement;
  root.dataset.theme = theme.mode.toLowerCase();
  for (const [key, value] of Object.entries({
    "--background": theme.background.default,
    "--surface": theme.background.paper,
    "--text": theme.text.primary,
    "--muted": theme.text.secondary,
    "--accent": theme.primary.main,
    "--on-accent": theme.primary.contrastText,
  }))
    root.style.setProperty(key, value);
}
function applyPreviewTheme() {
  document.documentElement.dataset.theme =
    themePreference === "system"
      ? matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light"
      : themePreference;
}
session.start();
applyPreviewTheme();
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
  if (!OBR.isAvailable && themePreference === "system") applyPreviewTheme();
});
if (OBR.isAvailable)
  OBR.onReady(async () => {
    OBR.theme.onChange(applyTheme);
    try {
      applyTheme(await OBR.theme.getTheme());
    } catch {
      message = "Could not read Owlbear theme; using the system theme.";
      render();
    }
  });
