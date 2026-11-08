import "@fontsource/roboto/latin-400.css";
import "@fontsource/roboto/latin-500.css";
import "@fontsource/roboto/latin-700.css";
import OBR, { type Theme } from "@owlbear-rodeo/sdk";
import { markdown } from "./markdown";
import {
  type Action,
  activeEffects,
  type Crew,
  crewActions,
  type Effect,
  effectiveStats,
  effectSummary,
  rollNotation,
  type Ship,
  type Station,
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
let importError = "";
let screen = "Encounter";
let shipId = "kestrel";
let section = "Status";
let encounterName = "Ambush at the relay";
let encounterIds = ships.map((s) => s.id);
let running = true;
let round = 1;
let turn = 0;
let message = "";
let editing:
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
  "damage",
  "repair",
  "configure",
  "seat",
  "move",
  "disable",
  "roll",
  "pause",
  "next",
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
function effectInfo(effect: Effect, key: string) {
  return `<small class="effect-rules">${escapeHtml(effectSummary(effect))}</small>${description(effect.description, key)}`;
}
function render() {
  const view = `${screen}:${shipId}:${section}`;
  const sameView = view === renderedView;
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
          ["My ships", "Ships"],
          ["My crew", "Crew"],
        ];
  app.innerHTML = `<header class="topbar"><strong>↗ Spaceship combat</strong><label class="sr-only" for="role">Preview role</label><select id="role" ${OBR.isAvailable ? "disabled" : ""}><option ${role === "GM" ? "selected" : ""}>GM</option><option ${role === "Player" ? "selected" : ""}>Player</option></select></header><nav class="main-nav" aria-label="Main navigation">${nav.map(([value, label]) => button(label, "nav", `data-value="${value}" aria-current="${screen === value ? "page" : "false"}"`)).join("")}</nav><div class="connection-status ${connected ? "" : "disconnected"}" role="status">${escapeHtml(connectionStatus)}${button("↻", "refresh", 'aria-label="Refresh state"')}</div><main ${busy ? "inert" : ""}>${screen === "Edit encounter" ? encounterEditor() : screen === "Encounter" ? encounter() : screen === "Ships" || screen === "My ships" ? fleet() : screen === "Crew" || screen === "My crew" ? crewScreen() : screen === "Encounters" ? encounters() : importScreen()}</main><div class="notice" role="status">${escapeHtml(message)}</div><footer><span>${OBR.isAvailable ? "Owlbear" : "Demo"} · ${busy ? "Working…" : role === "GM" ? "GM rolls private" : "Player rolls public"}</span>${!OBR.isAvailable ? `<label class="sr-only" for="theme-mode">Preview theme</label><select id="theme-mode" aria-label="Preview theme">${["system", "light", "dark"].map((mode) => `<option value="${mode}" ${mode === themePreference ? "selected" : ""}>${mode[0].toUpperCase() + mode.slice(1)}</option>`).join("")}</select>` : ""}${!OBR.isAvailable ? button("Reset", "reset") : ""}</footer>`;
  const main = app.querySelector("main");
  if (main) main.scrollTop = scroll;
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
}
function encounter() {
  if (!activeEncounterId)
    return `${heading("No encounter selected")}${button("Choose encounter", "nav", 'data-value="Encounters"')}`;
  const ordered = ships
    .filter((s) => encounterIds.includes(s.id))
    .sort((a, b) => b.initiative - a.initiative);
  return `${heading(escapeHtml(encounterName), button("Edit", "edit-encounter"))}<div class="turn-controls"><span>Round <strong>${round}</strong> · ${running ? "In progress" : "Paused"}</span><div>${button(running ? "Pause" : "Resume", "pause")}${button("Next →", "next", `class="primary" ${!ordered.length || !running ? "disabled" : ""}`)}</div></div><div class="initiative-strip" aria-label="Initiative order">${ordered.map((s, i) => button(`<span class="initiative-score">${s.initiative}</span><span>${escapeHtml(s.name)}<small>${i === turn ? "● Acting" : s.kind}</small></span>`, "ship", `data-value="${s.id}" aria-pressed="${shipId === s.id}"`)).join("")}</div><details class="initiative-edit"><summary>Edit initiative</summary>${ordered.map((s) => `<label class="initiative-input">${escapeHtml(s.name)}<input type="number" aria-label="${escapeHtml(s.name)} initiative" value="${s.initiative}" data-init="${s.id}" /></label>`).join("")}</details>${ordered.length ? shipDetail() : `<p class="empty">No ships. Edit the encounter to add some.</p>`}`;
}
function shipDetail() {
  const s = ship();
  if (!s)
    return `<p class="empty">No ships loaded. The GM can import ships from the Import tab.</p>`;
  return `<section class="ship-detail"><div class="ship-heading"><h2>${escapeHtml(s.name)}</h2><span class="muted">${s.kind} · ${escapeHtml(s.class)}</span></div><nav class="tabs" aria-label="Ship sections">${["Status", "Stations", "Crew"].map((t) => button(t, "section", `data-value="${t}" aria-current="${section === t ? "page" : "false"}"`)).join("")}</nav><div class="ship-content">${section === "Status" ? status(s) : section === "Stations" ? stationScreen(s) : crewCards(s.kind === "Player" ? playerCrew() : crew.filter((c) => c.ship === s.id))}</div></section>`;
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
    .map(
      ([key, label]) =>
        `<div><span>${label}</span><strong>${stats[key]}${key === "speed" ? "<small>km</small>" : ""}</strong><small>${stats[key] === s.stats[key] ? "Base value" : `Base ${s.stats[key]} · ${stats[key] - s.stats[key] > 0 ? "+" : ""}${stats[key] - s.stats[key]}`}</small></div>`,
    )
    .join("")}</div>
  <div class="section-label"><h3>Damage</h3><span>current / max</span></div><div class="systems">${s.parts.map((p, i) => `<article class="system"><div class="system-row"><div class="system-name"><strong>${escapeHtml(p.name)}</strong><span class="damage-track" aria-hidden="true">${p.levels.map((_, j) => `<i class="${j < p.damage ? `severity-${Math.min(p.damage, 3)}` : ""}"></i>`).join("")}</span></div><span class="damage-count">${p.damage}/${p.levels.length}</span>${button("−", "repair", `data-part="${i}" aria-label="Repair ${escapeHtml(p.name)}" ${!p.damage ? "disabled" : ""}`)}${button("+", "damage", `data-part="${i}" aria-label="Damage ${escapeHtml(p.name)}" ${p.damage === p.levels.length ? "disabled" : ""}`)}</div>${editing?.kind === "damage" && editing.part === i ? `<form class="inline-editor" data-form="damage" data-part="${i}" data-from="${p.damage}"><label for="effect">${escapeHtml(p.name)}: ${p.damage} → ${p.damage + 1} · select effect</label><select id="effect" name="effect" required><option value="">Choose an effect…</option>${p.levels[p.damage].map((e) => `<option value="${e.id}">${escapeHtml(e.name)}</option>`).join("")}</select>${p.levels[p.damage].map((e) => `<div class="choice-info"><strong>${escapeHtml(e.name)}</strong>${effectInfo(e, `damage-choice:${s.id}:${i}:${e.id}`)}</div>`).join("")}<div class="form-actions">${button("Cancel", "cancel")}<button class="primary">Apply damage</button></div></form>` : ""}</article>`).join("")}</div>
  <details class="reference"><summary>Damage levels & effects</summary>${s.parts.map((p, i) => `<p><strong>${escapeHtml(p.name)}</strong></p>${p.levels.map((options, level) => `<div class="level-reference"><span>Level ${level + 1}</span>${options.length ? options.map((e) => `<div><strong>${escapeHtml(e.name)}</strong>${effectInfo(e, `level:${s.id}:${i}:${level}:${e.id}`)}</div>`).join("<small>or</small>") : "<small>No additional effect</small>"}</div>`).join("")}`).join("")}</details>
  <div class="section-label"><h3>Active effects</h3>${pill(String(effects.length))}</div><ul class="effect-list">${effects.map(({ effect, source }) => `<li><div class="effect-heading"><strong>${escapeHtml(effect.name)}</strong><span>${escapeHtml(source)}</span></div>${effectInfo(effect, `active:${s.id}:${source}:${effect.id}`)}</li>`).join("") || '<li class="muted">No active effects.</li>'}</ul>`;
}
function rollPreview(s: Ship, st: Station, action: Action, c: Crew) {
  if (action.kind !== "roll") return "No roll";
  try {
    return action.rolls
      .map(
        (roll) => `${roll.label}: ${rollNotation(s, st, action.type, roll, c)}`,
      )
      .join(" · ");
  } catch (error) {
    return error instanceof Error
      ? error.message
      : "Notation is not supported.";
  }
}
function configuration(s: Ship, st: Station, index: number, action: Action) {
  if (action.kind !== "effects") return "";
  const enabled = usableCrew(st, crew);
  const selected = st.selectedEffects[action.id] ?? [];
  const key = `config:${s.id}:${st.id}:${action.id}`;
  return `<div class="configuration"><div class="action-row"><div><strong>${escapeHtml(action.name)}</strong><small>${
    selected.length
      ? action.effects
          .filter((e) => selected.includes(e.id))
          .map((e) => escapeHtml(e.name))
          .join(" · ")
      : "No effects selected"
  }</small></div>${button("Configure", "configure", `data-station="${index}" data-value="${action.id}" ${enabled ? "" : "disabled"}`)}</div>${description(action.description, key)}${!enabled ? '<p class="context">Seat enabled crew here to change effects. Existing effects remain active.</p>' : ""}${editing?.kind === "effects" && editing.station === index && editing.action === action.id ? `<form class="inline-editor" data-form="effects" data-station="${index}" data-action-id="${action.id}"><p class="context">Select any combination. Clear all to disable this configuration.</p>${action.effects.map((e) => `<div class="effect-option"><label class="check-row"><input type="checkbox" name="effect" value="${e.id}" ${selected.includes(e.id) ? "checked" : ""} ${enabled ? "" : "disabled"}/><strong>${escapeHtml(e.name)}</strong></label>${effectInfo(e, `${key}:${e.id}`)}</div>`).join("")}<div class="form-actions">${button("Cancel", "cancel")}<button class="primary" ${enabled ? "" : "disabled"}>Apply effects</button></div></form>` : ""}</div>`;
}
function stationScreen(s: Ship) {
  return `<p class="context">${role === "GM" ? "Private GM rolls" : "Public player rolls"} · effect-adjusted notation</p>${s.stations
    .map(
      (st, i) =>
        `<details class="station" data-station-panel="${i}" ${expandedStations.has(i) ? "open" : ""}><summary><strong>${escapeHtml(st.name)}</strong><span>${st.seats.filter(Boolean).length}/${st.seats.length} seated</span></summary><div class="station-body">${st.actions.map((a) => configuration(s, st, i, a)).join("")}${st.seats
          .map((id, j) => {
            const c = crew.find((c) => c.id === id);
            return `<div class="seat ${c?.disabled ? "disabled-seat" : ""}"><div class="seat-heading"><div><strong>${c ? escapeHtml(c.name) : "Empty seat"}</strong><small>Seat ${j + 1} · ${c ? `${escapeHtml(st.type)} +${c.modifiers[st.type] ?? 0}${c.disabled ? " · Disabled" : ""}` : st.type}</small></div>${button(c ? "Change" : "Assign", "seat", `data-station="${i}" data-seat="${j}"`)}</div>${editing?.kind === "seat" && editing.station === i && editing.seat === j ? seatEditor(s, i, j) : ""}${
              c
                ? crewActions(st, c)
                    .map(
                      (a) =>
                        `<div class="action-item"><div class="action-row"><div><strong>${escapeHtml(a.name)}</strong><small class="notation">${escapeHtml(rollPreview(s, st, a, c))}</small></div>${button(a.kind === "roll" ? (a.rolls.length > 1 ? "Roll all" : "Roll") : "Use", "roll", `data-station="${i}" data-crew="${c.id}" data-value="${a.id}" ${c.disabled ? "disabled" : ""}`)}</div>${description(a.description, `action:${s.id}:${i}:${c.id}:${a.id}`)}</div>`,
                    )
                    .join("")
                : `<div class="context">When seated:${st.actions
                    .filter((a) => a.kind !== "effects")
                    .map(
                      (a) =>
                        `<div>${escapeHtml(a.name)}${description(a.description, `empty:${s.id}:${i}:${j}:${a.id}`)}</div>`,
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
        )}</p><div class="toolbar">${button("Move crew", "move", `data-value="${c.id}"`)}${button(c.disabled ? "Enable" : "Disable", "disable", `data-value="${c.id}"`)}</div>${editing?.kind === "move" && editing.crew === c.id ? moveEditor(c) : ""}</div></details>`,
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
  return `${heading("Library JSON", button("Export", "export"))}<p class="context">Import or replace entries by ID. Player ships and crew go to this scene; NPCs and encounters stay in this GM browser.</p><label for="import-file">Open JSON file</label><input id="import-file" type="file" accept="application/json,.json"/><label for="json">Or paste JSON</label><textarea id="json" rows="9" spellcheck="false">${escapeHtml(importText)}</textarea><div class="toolbar">${button("Preview import", "preview-json", 'class="primary"')}${button("Example JSON", "sample-json")}</div><div id="import-result" role="status">${importError ? `<p class="error">${escapeHtml(importError)}</p>` : importPreview ? `<p>${importPreview.ships?.length ?? 0} ships · ${importPreview.crew?.length ?? 0} crew · ${importPreview.encounters?.length ?? 0} encounters</p><p class="context">Matching IDs replace existing entries. All references and assignments are validated together before saving.</p>${button("Import library", "import-library", 'class="primary"')}` : ""}</div>`;
}
app.addEventListener(
  "toggle",
  (e) => {
    const d = e.target as HTMLDetailsElement;
    if (!d.isConnected) return;
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
    expandedDetails.clear();
    renderedView = "";
  }
  const wasPlayer = role === "Player";
  ships = view.ships;
  crew = view.crew;
  savedEncounters = view.encounters;
  activeEncounterId = view.activeEncounterId;
  role = view.role;
  connected = view.ready;
  connectionStatus = view.status;
  const active = savedEncounters.find((e) => e.id === activeEncounterId);
  encounterName = active?.name ?? "";
  encounterIds =
    active?.shipIds.filter((id) => ships.some((s) => s.id === id)) ?? [];
  round = active?.round ?? 1;
  turn = active?.turn ?? 0;
  running = active?.running ?? false;
  if (role === "Player" && !["My ships", "My crew"].includes(screen))
    screen = "My ships";
  if (role === "GM" && wasPlayer) screen = "Encounter";
  if (
    !ships.some(
      (s) => s.id === shipId && (role === "GM" || s.kind === "Player"),
    )
  )
    shipId = ships.find((s) => role === "GM" || s.kind === "Player")?.id ?? "";
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
  if (input.id === "theme-mode") {
    themePreference = input.value;
    applyPreviewTheme();
  } else if (input.id === "role" && !OBR.isAvailable) {
    editing = null;
    message = "";
    session.setDemoRole(input.value as "GM" | "Player");
  } else if (input.id === "ship-select") {
    shipId = input.value;
    editing = null;
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
      shipId: input.dataset.init,
      value: Number(input.value),
    });
});
app.addEventListener("submit", async (e) => {
  const form = e.target as HTMLFormElement;
  e.preventDefault();
  if (busy) return;
  const data = new FormData(form);
  let command: Command;
  switch (form.dataset.form) {
    case "damage":
      command = {
        op: "damage",
        shipId,
        part: Number(form.dataset.part),
        from: Number(form.dataset.from),
        choice: String(data.get("effect")),
      };
      break;
    case "effects":
      command = {
        op: "effects",
        shipId,
        stationId: ship().stations[Number(form.dataset.station)].id,
        actionId: form.dataset.actionId as string,
        choices: data.getAll("effect").map(String),
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
          id: freshEncounter
            ? `enc-${crypto.randomUUID()}`
            : (editingEncounterId ?? (activeEncounterId as string)),
          name: String(data.get("name")),
          shipIds: data.getAll("ship").map(String),
          round: 1,
          turn: 0,
          running: true,
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
      break;
    case "section":
      section = value;
      editing = null;
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
    case "next":
      if (await commit({ op: "next" })) {
        const ordered = ships
          .filter((s) => encounterIds.includes(s.id))
          .sort((a, b) => b.initiative - a.initiative);
        shipId = ordered[turn]?.id ?? shipId;
      }
      editing = null;
      break;
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
    case "repair":
      editing = null;
      await commit({ op: "repair", shipId, part: Number(b.dataset.part) });
      return;
    case "damage": {
      const part = Number(b.dataset.part);
      const p = ship().parts[part];
      if (p.levels[p.damage]?.length > 1) editing = { kind: "damage", part };
      else {
        editing = null;
        await commit({ op: "damage", shipId, part, from: p.damage });
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
      editing = null;
      break;
    case "roll": {
      busy = true;
      render();
      try {
        message = await session.roll({
          op: "roll",
          shipId,
          stationId: ship().stations[Number(b.dataset.station)].id,
          actionId: value,
          crewId: b.dataset.crew as string,
        });
      } catch (error) {
        message = error instanceof Error ? error.message : "Could not roll.";
      } finally {
        busy = false;
        render();
      }
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
        (await commit({ op: "import", library: importPreview }))
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
