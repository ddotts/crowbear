import assert from "node:assert/strict";
import { chromium } from "playwright";
import { loadLegacyFixture } from "./legacy-fixture.mjs";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 400, height: 640 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.goto(process.env.CROWBEAR_QA_URL ?? "http://127.0.0.1:5174");
await page.locator(".initiative-entry").first().waitFor();
assert.equal(await page.locator(".initiative-entry").count(), 13);
assert.match(await page.locator("main").innerText(), /Debt Collection/);
await page.screenshot({ path: "/tmp/crowbear-naranja-default.png" });
await page.getByRole("button", { name: "Import", exact: true }).click();
await page
  .getByRole("button", { name: "Replace with Naranja preset", exact: true })
  .click();
await page
  .locator(".notice")
  .getByText("Naranja preset loaded.", { exact: true })
  .waitFor();
await page.screenshot({ path: "/tmp/crowbear-naranja-preset.png" });
await loadLegacyFixture(page);
await page.waitForSelector(".stats-strip");
await page.screenshot({ path: "/tmp/crowbear-feedback-light.png" });
await page.getByRole("button", { name: "Damage Engines", exact: true }).click();
await page.waitForFunction(() =>
  document.querySelectorAll(".system-row")[1].innerText.includes("1/3"),
);
assert.equal(await page.locator('[data-form="damage"]').count(), 0);
await page.getByRole("button", { name: "Damage Engines", exact: true }).click();
await page.waitForFunction(() =>
  document.querySelectorAll(".system-row")[1].innerText.includes("2/3"),
);
assert.equal(await page.locator('[data-form="damage"]').count(), 0);
assert.match(await page.locator(".stats-strip").innerText(), /500/);
await page.getByRole("button", { name: "Damage Hull", exact: true }).click();
assert.equal(
  await page.locator('[data-form="damage"]').evaluate((f) => f.checkValidity()),
  false,
);
await page.locator("#effect").selectOption("drag");
await page.getByRole("button", { name: "Apply damage", exact: true }).click();
await page.waitForSelector('[data-form="damage"]', { state: "detached" });
assert.match(await page.locator(".stats-strip").innerText(), /450/);
await page.getByRole("button", { name: "Stations", exact: true }).click();
await page
  .locator('[data-action="configure"][data-value="flight-mode"]')
  .click();
await page.locator('[data-form="effects"] input[value="boost"]').check();
await page.locator('[data-form="effects"] input[value="evasive"]').check();
await page.getByRole("button", { name: "Apply effects", exact: true }).click();
await page.waitForSelector('[data-form="effects"]', { state: "detached" });
await page.locator('[data-action="seat"][data-station="0"]').click();
await page.locator("#crew-select").selectOption("");
await page.locator('[data-form="seat"] button.primary').click();
await page.waitForSelector('[data-form="seat"]', { state: "detached" });
assert.equal(
  await page
    .locator('[data-action="configure"][data-value="flight-mode"]')
    .isDisabled(),
  true,
);
await page.getByRole("button", { name: "Status", exact: true }).click();
assert.match(await page.locator(".effect-list").innerText(), /Boost/);
await page
  .locator(".effect-list .effect-entry")
  .first()
  .locator("summary")
  .click();
assert.ok(
  (await page.locator(".effect-list .effect-entry[open] strong").count()) > 0,
);
await page.locator("#theme-mode").selectOption("dark");
await page.screenshot({ path: "/tmp/crowbear-feedback-dark.png" });
await page.setViewportSize({ width: 320, height: 560 });
assert.equal(
  await page.evaluate(
    () =>
      document.documentElement.scrollWidth > innerWidth ||
      document.querySelector("main").scrollWidth >
        document.querySelector("main").clientWidth,
  ),
  false,
);
// Personal controls remain compact, with an accessible force menu on disabled rolls.
await page.locator("#role").selectOption("Player");
await page.getByRole("button", { name: "Actions", exact: true }).click();
await page.locator("#crew-self").selectOption("ivo");
const hit = page.getByRole("button", {
  name: "Roll Fire cannons hit",
  exact: true,
});
const effect = page.getByRole("button", {
  name: "Roll Fire cannons effect",
  exact: true,
});
assert.equal(await hit.locator("..").locator(".disadvantage").count(), 1);
await hit.click();
assert.equal(await hit.getAttribute("aria-disabled"), "false");
await hit.click();
assert.equal(await hit.getAttribute("aria-disabled"), "true");
assert.equal(await effect.getAttribute("aria-disabled"), "false");
await hit.focus();
await hit.press("Shift+F10");
await page.getByRole("button", { name: "normal", exact: true }).click();
assert.match(await page.locator(".notice").innerText(), /Public demo/);
await page.screenshot({ path: "/tmp/crowbear-player-actions-320.png" });
assert.equal(
  await page.evaluate(
    () =>
      document.documentElement.scrollWidth > innerWidth ||
      document.querySelector("main").scrollWidth >
        document.querySelector("main").clientWidth,
  ),
  false,
);
await page.locator("#crew-self").selectOption("sol");
const repair = page.getByRole("button", {
  name: "Roll Repair system hit",
  exact: true,
});
assert.equal(await repair.getAttribute("aria-disabled"), "true");
await repair.click({ button: "right", force: true });
await page.getByRole("button", { name: "advantage", exact: true }).click();
assert.match(await page.locator(".notice").innerText(), /Public demo/);
await page.locator("#role").selectOption("GM");
await page.getByRole("button", { name: "Run", exact: true }).click();
await page
  .getByRole("button", { name: "Roll NPC initiatives · RNG", exact: true })
  .click();
assert.equal(
  await page.locator('.crew-order [data-action="actor"]').count(),
  5,
);
await page.setViewportSize({ width: 400, height: 640 });
await page.screenshot({ path: "/tmp/crowbear-crew-initiative.png" });
assert.equal(
  await page.locator('.crew-order [aria-current="step"]').count(),
  1,
);
const current = await page
  .locator('.crew-order [aria-current="step"]')
  .getAttribute("data-value");
await page.getByRole("button", { name: "Next →", exact: true }).click();
assert.notEqual(
  await page
    .locator('.crew-order [aria-current="step"]')
    .getAttribute("data-value"),
  current,
);
await page.getByRole("button", { name: "← Back", exact: true }).click();
assert.equal(
  await page
    .locator('.crew-order [aria-current="step"]')
    .getAttribute("data-value"),
  current,
);
assert.equal(await page.locator(".crew-actions .ship-snapshot").count(), 1);
await page.locator('[data-action="actor"][data-value="ivo"]').click();
assert.equal(
  await page.locator('.crew-order [aria-pressed="true"]').count(),
  3,
);
assert.equal(
  await page.locator('.crew-order [aria-current="step"]').count(),
  1,
);
await page.locator("main").evaluate((el) => (el.scrollTop = 0));
await page.screenshot({ path: "/tmp/crowbear-gm-actions-400.png" });
assert.equal(
  await page
    .locator('.crew-order [aria-pressed="true"]:not([aria-current="step"])')
    .first()
    .evaluate((el) => getComputedStyle(el).borderLeftColor),
  "rgba(0, 0, 0, 0)",
);
assert.notEqual(
  await page
    .locator('.crew-order [aria-current="step"]')
    .evaluate((el) => getComputedStyle(el).borderLeftColor),
  "rgba(0, 0, 0, 0)",
);
const hitBounds = await page
  .getByRole("button", { name: "Roll Fire cannons hit", exact: true })
  .boundingBox();
const mainBounds = await page.locator("main").boundingBox();
assert.ok(
  hitBounds.y + hitBounds.height <= mainBounds.y + mainBounds.height,
  "GM hit controls should be visible without scrolling at 400 × 640",
);
await page
  .locator('[data-action="toggle-description"]')
  .filter({ hasText: "Fire cannons" })
  .click();
assert.equal(await page.locator(".action-copy .markdown").count(), 0);
assert.ok((await page.locator(".action-copy").count()) > 0);
await page.setViewportSize({ width: 320, height: 560 });
await page.screenshot({ path: "/tmp/crowbear-gm-actions-320.png" });
assert.equal(
  await page.evaluate(
    () =>
      document.documentElement.scrollWidth > innerWidth ||
      document.querySelector("main").scrollWidth >
        document.querySelector("main").clientWidth,
  ),
  false,
);
await page.locator(".snapshot-effects > summary").click();
assert.ok((await page.locator(".snapshot-effects .effect-entry").count()) >= 5);
await page
  .locator(".snapshot-effects .effect-entry")
  .first()
  .locator("summary")
  .click();
await page.screenshot({ path: "/tmp/crowbear-compact-effects.png" });
await page.getByRole("button", { name: "Ship controls", exact: true }).click();
await page.getByRole("button", { name: "Status", exact: true }).click();
await page.screenshot({ path: "/tmp/crowbear-status-320.png" });
await page.locator("main").evaluate((el) => (el.scrollTop = el.scrollHeight));
await page.screenshot({ path: "/tmp/crowbear-status-effects-320.png" });
await page.locator("#theme-mode").selectOption("light");
await page.screenshot({ path: "/tmp/crowbear-status-effects-light.png" });

// Ammunition is shared by name on a ship; Autonomy is available in both views.
await page.reload();
await loadLegacyFixture(page);
await page.setViewportSize({ width: 400, height: 640 });
await page.locator(".stats-strip").waitFor();
const autonomy = page.getByRole("meter", {
  name: "Autonomy; each segment is up to 10 points",
  exact: true,
});
assert.equal(await autonomy.getAttribute("aria-valuenow"), "60");
for (const [label, expected] of [
  ["Decrease Autonomy by 7", 53],
  ["Decrease Autonomy by 1", 52],
  ["Increase Autonomy by 7", 59],
  ["Increase Autonomy by 1", 60],
]) {
  await page.getByRole("button", { name: label, exact: true }).click();
  assert.equal(await autonomy.getAttribute("aria-valuenow"), String(expected));
}
await page
  .getByRole("button", { name: "Decrease Torpedoes by 1", exact: true })
  .click();
await page
  .getByRole("button", { name: "Decrease Torpedoes by 1", exact: true })
  .click();
await page.screenshot({ path: "/tmp/crowbear-ammunition-status.png" });
await page.locator("#role").selectOption("Player");
await page.locator("#crew-self").selectOption("ivo");
assert.equal(await page.locator(".ammunition-list").count(), 0);
assert.equal(
  await page.locator(".ship-snapshot [data-action=ammunition]").count(),
  0,
);
assert.equal(await autonomy.getAttribute("aria-valuenow"), "60");
const torpedo = page.locator(".action-item").filter({
  has: page.getByRole("button", { name: "Use Launch torpedo", exact: true }),
});
assert.equal(await torpedo.locator(".action-rolls button").count(), 3);
await torpedo
  .getByRole("button", { name: "Use Launch torpedo", exact: true })
  .click();
assert.match(await torpedo.locator(".action-ammunition").innerText(), /0\/3/);
assert.equal(
  await torpedo
    .getByRole("button", { name: "Use Launch torpedo", exact: true })
    .isDisabled(),
  true,
);
await torpedo
  .getByRole("button", { name: "Roll Launch torpedo hit", exact: true })
  .click();
await torpedo
  .getByRole("button", { name: "Roll Launch torpedo effect", exact: true })
  .click();
assert.match(
  await torpedo.locator(".cooldown-slot").getAttribute("aria-label"),
  /2 rounds remaining/,
);
await page
  .getByRole("button", { name: "Roll Fire cannons hit", exact: true })
  .click();
await page
  .getByRole("button", { name: "Roll Called shot hit", exact: true })
  .click();
const cannonCounts = await page
  .locator(".action-ammunition")
  .filter({ hasText: "Cannon rounds" })
  .allTextContents();
assert.ok(cannonCounts.every((text) => text.includes("38/40")));
await page.setViewportSize({ width: 320, height: 560 });
await torpedo.scrollIntoViewIfNeeded();
await page.screenshot({ path: "/tmp/crowbear-ammunition-actions-320.png" });
await page.locator("#theme-mode").selectOption("dark");
await page.screenshot({
  path: "/tmp/crowbear-ammunition-actions-dark-320.png",
});
assert.equal(
  await page.evaluate(
    () =>
      document.documentElement.scrollWidth > innerWidth ||
      document.querySelector("main").scrollWidth >
        document.querySelector("main").clientWidth,
  ),
  false,
);
await page.locator("#crew-self").selectOption("mara");
await page.getByRole("button", { name: "Use Travel", exact: true }).click();
assert.equal(await autonomy.getAttribute("aria-valuenow"), "53");
await page.locator("#role").selectOption("GM");
await page.getByRole("button", { name: "Run", exact: true }).click();
// All crew, including unrolled players, have editable initiative fields.
assert.equal(await page.locator(".initiative-entry").count(), 5);
for (const name of ["Mara Voss", "Ivo Chen", "Sol Reyes"])
  assert.equal(
    await page
      .getByRole("spinbutton", { name: `Initiative for ${name}`, exact: true })
      .inputValue(),
    "",
  );
await page
  .getByRole("spinbutton", { name: "Initiative for Ivo Chen", exact: true })
  .fill("27");
await page
  .getByRole("spinbutton", { name: "Initiative for Ivo Chen", exact: true })
  .press("Enter");
await page
  .getByRole("button", { name: "Roll NPC initiatives · RNG", exact: true })
  .click();
assert.equal(
  await page
    .getByRole("spinbutton", { name: "Initiative for Ivo Chen", exact: true })
    .inputValue(),
  "27",
);
assert.equal(
  await page
    .getByRole("spinbutton", { name: "Initiative for Mara Voss", exact: true })
    .inputValue(),
  "",
);
for (const [name, value] of [
  ["Mara Voss", "11"],
  ["Sol Reyes", "7"],
]) {
  await page
    .getByRole("spinbutton", { name: `Initiative for ${name}`, exact: true })
    .fill(value);
  await page
    .getByRole("spinbutton", { name: `Initiative for ${name}`, exact: true })
    .press("Tab");
}
const colours = await page
  .locator(".crew-ship-dot")
  .evaluateAll((dots) =>
    dots.map((dot) => getComputedStyle(dot).backgroundColor),
  );
assert.equal(new Set(colours).size, 3);
for (let i = 0; i < 6; i++) {
  await page.getByRole("button", { name: "Next →", exact: true }).click();
  assert.equal(
    await page.locator(".crew-order").evaluate((el) => {
      const outer = el.getBoundingClientRect(),
        inner = el
          .querySelector('[aria-current="step"]')
          .getBoundingClientRect();
      return inner.top >= outer.top - 1 && inner.bottom <= outer.bottom + 1;
    }),
    true,
  );
}
await page.setViewportSize({ width: 400, height: 640 });
await page.locator("main").evaluate((el) => (el.scrollTop = 0));
await page.screenshot({ path: "/tmp/crowbear-initiative-colours.png" });
// Typed/timed effects, requirements, removal, Gs and compact station saves.
await page.reload();
await loadLegacyFixture(page);
await page.setViewportSize({ width: 400, height: 640 });
await page.locator(".stats-strip").waitFor();
await page.locator("#role").selectOption("Player");
await page.locator("#crew-self").selectOption("mara");
const saving = page.getByRole("button", {
  name: "Roll G resilience hit",
  exact: true,
});
assert.equal(
  await page
    .locator(".saving-throws")
    .getByRole("button", { name: "Roll G resilience hit", exact: true })
    .count(),
  1,
);
assert.equal(
  await page.locator('.available-actions [data-value="g-save"]').count(),
  0,
);
for (let i = 0; i < 5; i++)
  await page
    .getByRole("button", { name: "Use Accelerate", exact: true })
    .click();
assert.match(await page.locator(".g-indicator.over-limit").innerText(), /5/);
await page.getByRole("button", { name: "−1 Gs", exact: true }).click();
assert.equal(await page.locator(".g-indicator.over-limit").count(), 0);
await page.getByRole("button", { name: "Use Accelerate", exact: true }).click();
await page.getByRole("button", { name: "The Kestrel", exact: true }).click();
assert.match(
  await page.locator(".stats-strip .g-indicator.over-limit").innerText(),
  /5/,
);
assert.match(
  await page.locator(".stats-strip .g-indicator").innerText(),
  /maxG 4/,
);
await page.screenshot({ path: "/tmp/crowbear-gs-status.png" });
await page.getByRole("button", { name: "Actions", exact: true }).click();
await page.locator("#crew-self").selectOption("ivo");
const focused = page.getByRole("button", {
  name: "Roll Focused burst hit",
  exact: true,
});
assert.equal(await focused.getAttribute("aria-disabled"), "true");
assert.match(
  await page.locator(".action-missing").innerText(),
  /Focused targeting/,
);
await page
  .locator('[data-action="configure"][data-value="target-mode"]')
  .click();
await page.locator('input[value="focus"]').check();
await page.getByRole("button", { name: "Apply effects", exact: true }).click();
assert.equal(await focused.getAttribute("aria-disabled"), "false");
await page.locator("#crew-self").selectOption("mara");
await page
  .locator('[data-action="configure"][data-value="flight-mode"]')
  .click();
await page.locator('input[value="ion-lock"]').check();
await page.locator('input[value="steady"]').check();
assert.equal(await page.locator("#effect-actor").inputValue(), "mara");
await page.getByRole("button", { name: "Apply effects", exact: true }).click();
assert.equal(await saving.getAttribute("aria-disabled"), "true");
await saving.click({ button: "right", force: true });
await page.getByRole("button", { name: "normal", exact: true }).click();
assert.match(await page.locator(".notice").innerText(), /Public demo/);
await page
  .locator('[data-action="choose-remove-effect"][data-value="clear-fault"]')
  .click({ button: "right", force: true });
await page.getByRole("button", { name: "normal", exact: true }).click();
assert.equal(
  await page
    .locator("#remove-effect-choice option")
    .filter({ hasText: "Scorched" })
    .count(),
  0,
);
await page
  .locator("#remove-effect-choice")
  .selectOption("station:helm:flight-mode:ion-lock");
await page.screenshot({ path: "/tmp/crowbear-effect-removal.png" });
await page.getByRole("button", { name: "Remove effect", exact: true }).click();
assert.equal(await saving.getAttribute("aria-disabled"), "false");
await page.locator("#role").selectOption("GM");
await page
  .getByRole("button", { name: "Remove Scorched plating", exact: true })
  .click();
assert.equal(
  await page
    .locator(".effect-list .effect-entry")
    .filter({ hasText: "Scorched plating" })
    .count(),
  0,
);
assert.match(
  await page.locator(".systems .system").first().innerText(),
  /1\/4/,
);
await page
  .getByRole("spinbutton", { name: "Initiative for Mara Voss", exact: true })
  .fill("30");
await page
  .getByRole("spinbutton", { name: "Initiative for Mara Voss", exact: true })
  .press("Enter");
await page
  .getByRole("spinbutton", { name: "Initiative for Ivo Chen", exact: true })
  .fill("20");
await page
  .getByRole("spinbutton", { name: "Initiative for Ivo Chen", exact: true })
  .press("Enter");
await page
  .getByRole("button", { name: "Roll NPC initiatives · RNG", exact: true })
  .click();
await page
  .locator('[data-action="configure"][data-value="flight-mode"]')
  .click();
await page.locator('input[value="ion-lock"]').check();
await page.getByRole("button", { name: "Apply effects", exact: true }).click();
await page.locator(".snapshot-effects > summary").click();
await page.locator("main").evaluate((el) => (el.scrollTop = 0));
await page.screenshot({ path: "/tmp/crowbear-timed-effects-400.png" });
await page.setViewportSize({ width: 320, height: 560 });
await page.screenshot({ path: "/tmp/crowbear-saving-throws-320.png" });
await page.locator(".snapshot-effects").scrollIntoViewIfNeeded();
await page.screenshot({ path: "/tmp/crowbear-effect-timers-320.png" });
await page.locator("#theme-mode").selectOption("dark");
await page.screenshot({ path: "/tmp/crowbear-effect-timers-dark-320.png" });
assert.equal(
  await page.evaluate(
    () =>
      document.documentElement.scrollWidth > innerWidth ||
      document.querySelector("main").scrollWidth >
        document.querySelector("main").clientWidth,
  ),
  false,
);
for (let i = 0; i < 4; i++)
  await page.getByRole("button", { name: "Next →", exact: true }).click();
const steady = page
  .locator(".snapshot-effects .effect-entry")
  .filter({ hasText: "Steady flight" });
assert.match(await steady.textContent(), /1 turn/);
for (let i = 0; i < 4; i++)
  await page.getByRole("button", { name: "Next →", exact: true }).click();
assert.equal(
  await page
    .locator(".snapshot-effects .effect-entry")
    .filter({ hasText: "Steady flight" })
    .count(),
  0,
);
assert.equal(
  await page
    .locator(".snapshot-effects .effect-entry")
    .filter({ hasText: "Ionised controls" })
    .count(),
  0,
);
assert.equal(await saving.getAttribute("aria-disabled"), "false");
// Named pools update sibling actions; metadata stays visible through description toggles.
await page.reload();
await loadLegacyFixture(page);
await page.setViewportSize({ width: 400, height: 640 });
await page.locator(".stats-strip").waitFor();
await page.locator("#role").selectOption("Player");
await page.locator("#crew-self").selectOption("ivo");
const launch = page.getByRole("button", {
  name: "Use Launch torpedo",
  exact: true,
});
const salvo = page.getByRole("button", {
  name: "Use Torpedo salvo",
  exact: true,
});
const launchAction = page.locator(".action-item").filter({ has: launch });
const salvoAction = page.locator(".action-item").filter({ has: salvo });
assert.equal(await salvo.isDisabled(), false);
assert.match(
  await launchAction.locator(".action-values").textContent(),
  /Range80 km/,
);
await launchAction.locator(".action-name").click();
assert.equal(await launchAction.locator(".action-copy").count(), 1);
assert.match(
  await launchAction.locator(".action-values").textContent(),
  /Speed2 km\/s/,
);
await launchAction.locator(".action-name").click();
assert.equal(await launchAction.locator(".action-copy").count(), 0);
assert.equal(await launchAction.locator(".action-values").isVisible(), true);
await launch.click();
assert.equal(await salvo.isDisabled(), true);
assert.match(
  await salvoAction.locator(".cooldown-slot").getAttribute("aria-label"),
  /2 rounds remaining/,
);
assert.equal(
  await salvoAction.locator(".cooldown-name").textContent(),
  "launchers",
);
await launchAction.scrollIntoViewIfNeeded();
await page.screenshot({ path: "/tmp/crowbear-named-cooldowns-400.png" });
await page.setViewportSize({ width: 320, height: 560 });
await salvoAction.scrollIntoViewIfNeeded();
await page.screenshot({ path: "/tmp/crowbear-named-cooldowns-320.png" });
assert.equal(
  await page.locator("main").evaluate((el) => el.scrollWidth > el.clientWidth),
  false,
);
await page.locator("#crew-self").selectOption("mara");
await page.locator(".saving-throws").scrollIntoViewIfNeeded();
assert.equal(
  await page
    .locator(".saving-throws .action-name, .saving-throws .action-copy")
    .count(),
  0,
);
assert.match(
  await page.locator(".saving-throws .roll-button").textContent(),
  /G resilience1d6\+4/,
);
const saveLayout = await page
  .locator(".saving-throws .roll-button")
  .evaluate((el) => ({
    height: el.getBoundingClientRect().height,
    display: getComputedStyle(el).flexDirection,
  }));
assert.equal(saveLayout.display, "row");
assert.ok(saveLayout.height <= 32);
await page.screenshot({ path: "/tmp/crowbear-save-buttons-320.png" });
await page.locator("#theme-mode").selectOption("dark");
await page.screenshot({ path: "/tmp/crowbear-save-buttons-dark-320.png" });
// Grant effects through an explicit target selector, then preview/force damage CAT.
await page.reload();
await loadLegacyFixture(page);
await page.setViewportSize({ width: 400, height: 640 });
await page.locator(".stats-strip").waitFor();
await page.locator("#role").selectOption("Player");
await page.locator("#crew-self").selectOption("mara");
assert.equal(
  await page
    .locator('[aria-label="Target ship for Guided fire"] option')
    .count(),
  0,
);
await page
  .getByRole("button", { name: "Use Guided fire", exact: true })
  .click();
await page.locator("#target-ship-choice").selectOption("kestrel");
await page.getByRole("button", { name: "Apply effects", exact: true }).click();
await page.locator("#crew-self").selectOption("ivo");
const categoryDamage = page.getByRole("button", {
  name: "Roll Fire cannons effect",
  exact: true,
});
assert.match(await categoryDamage.textContent(), /1d4.*CAT1/);
await categoryDamage.click({ button: "right" });
assert.equal(
  await page.getByRole("button", { name: "Improve", exact: true }).isDisabled(),
  true,
);
await page.getByRole("button", { name: "Worsen", exact: true }).click();
assert.match(await page.locator(".category-menu").textContent(), /CAT2 · d6/);
await page
  .locator(".category-menu")
  .getByRole("button", { name: "Reset", exact: true })
  .click();
assert.match(await page.locator(".category-menu").textContent(), /CAT1 · d4/);
await page.getByRole("button", { name: "Worsen", exact: true }).click();
await page.locator(".roll-menu").scrollIntoViewIfNeeded();
await page.screenshot({ path: "/tmp/crowbear-category-400.png" });
await page.setViewportSize({ width: 320, height: 560 });
await page.screenshot({ path: "/tmp/crowbear-category-320.png" });
assert.equal(
  await page.locator("main").evaluate((el) => el.scrollWidth > el.clientWidth),
  false,
);
await page.getByRole("button", { name: "normal", exact: true }).click();
assert.match(await page.locator(".notice").textContent(), /1d6#Damage/);
assert.match(await categoryDamage.textContent(), /1d4.*CAT1/);
await page.locator("#role").selectOption("GM");
await page.getByRole("button", { name: "Ships", exact: true }).click();
await page.locator("#ship-select").selectOption("shrike");
await page.getByRole("button", { name: "Stations", exact: true }).click();
const helmSummary = page.locator('[data-station-panel="0"] > summary');
if (
  (await page.locator('[data-station-panel="0"]').getAttribute("open")) === null
)
  await helmSummary.click();
await page
  .getByRole("button", { name: "Use Guided fire", exact: true })
  .click();
await page
  .getByRole("combobox", { name: "Target ship for Guided fire", exact: true })
  .selectOption("kestrel");
await page.locator('[data-form="target-ship"]').scrollIntoViewIfNeeded();
await page.screenshot({ path: "/tmp/crowbear-ship-target-320.png" });
await page.getByRole("button", { name: "Apply effects", exact: true }).click();
assert.match(await page.locator(".notice").textContent(), /Selection applied/);
await page.locator("#role").selectOption("Player");
await page.locator("#crew-self").selectOption("ivo");
assert.equal(
  await page
    .locator(".ship-snapshot .snapshot-effects > summary")
    .textContent()
    .then((text) => text.includes("Effects")),
  true,
);
assert.match(await categoryDamage.textContent(), /CAT1/);
// Cancelling either selector preserves paid resources and unfinished selections can resume.
await page.reload();
await loadLegacyFixture(page);
await page.setViewportSize({ width: 400, height: 640 });
await page.locator(".stats-strip").waitFor();
await page.getByRole("button", { name: "Damage Weapons", exact: true }).click();
await page.locator("#role").selectOption("Player");
await page.locator("#crew-self").selectOption("mara");
await page
  .getByRole("button", { name: "Use Clear fault", exact: true })
  .click();
await page.locator("#remove-effect-choice").waitFor();
assert.equal(
  await page
    .locator(".ship-snapshot .ammunition-track")
    .getAttribute("aria-valuenow"),
  "59",
);
await page.locator('[data-form="remove-effect"]').scrollIntoViewIfNeeded();
await page.screenshot({ path: "/tmp/crowbear-paid-removal-400.png" });
await page.getByRole("button", { name: "Cancel", exact: true }).click();
assert.equal(await page.locator("#remove-effect-choice").count(), 0);
assert.equal(
  await page
    .locator(".ship-snapshot .ammunition-track")
    .getAttribute("aria-valuenow"),
  "59",
);
assert.match(
  await page.locator(".snapshot-damage").textContent(),
  /Weapons.*1\/3/,
);
assert.equal(
  await page
    .getByRole("button", { name: "Use Clear fault", exact: true })
    .getAttribute("aria-disabled"),
  "true",
);
await page
  .getByRole("button", { name: "Use Guided fire", exact: true })
  .click();
assert.equal(await page.locator("#target-ship-choice").inputValue(), "");
await page.getByRole("button", { name: "Crew", exact: true }).click();
await page.getByRole("button", { name: "Actions", exact: true }).click();
await page
  .getByRole("button", { name: "Finish selection…", exact: true })
  .click();
await page.locator("#target-ship-choice").selectOption("kestrel");
await page.setViewportSize({ width: 320, height: 560 });
await page.locator('[data-form="target-ship"]').scrollIntoViewIfNeeded();
await page.screenshot({ path: "/tmp/crowbear-paid-target-320.png" });
await page.locator("#theme-mode").selectOption("dark");
await page.screenshot({ path: "/tmp/crowbear-paid-target-dark-320.png" });
assert.equal(
  await page.locator("main").evaluate((el) => el.scrollWidth > el.clientWidth),
  false,
);
await page.getByRole("button", { name: "Cancel", exact: true }).click();
assert.equal(await page.locator("#target-ship-choice").count(), 0);
assert.equal(
  await page
    .getByRole("button", { name: "Finish selection…", exact: true })
    .count(),
  0,
);
assert.equal(
  await page
    .getByRole("button", { name: "Use Guided fire", exact: true })
    .getAttribute("aria-disabled"),
  "true",
);
assert.match(await page.locator(".notice").textContent(), /not refunded/);
// Replace is the default import mode; sample collections do not survive a new library.
await page.reload();
await loadLegacyFixture(page);
await page.setViewportSize({ width: 400, height: 640 });
await page.locator(".stats-strip").waitFor();
await page.getByRole("button", { name: "Import", exact: true }).click();
assert.equal(await page.locator("#import-mode").inputValue(), "replace");
await page.getByRole("button", { name: "Example JSON", exact: true }).click();
const importExample = JSON.parse(await page.locator("#json").inputValue());
const customShip = importExample.ships[0];
customShip.id = "custom-ship";
customShip.name = "Imported ship";
for (const station of customShip.stations)
  station.seats = station.seats.map(() => null);
customShip.stations[0].seats[0] = "custom-crew";
const customCrew = {
  ...importExample.crew[0],
  id: "custom-crew",
  ship: "custom-ship",
};
const importedLibrary = {
  version: 1,
  ships: [customShip],
  crew: [customCrew],
  encounters: [
    {
      id: "custom-encounter",
      name: "Imported encounter",
      shipIds: ["custom-ship"],
      round: 1,
      turn: 0,
      currentCrewId: null,
      running: true,
    },
  ],
};
await page.locator("#json").fill(JSON.stringify(importedLibrary));
await page.getByRole("button", { name: "Preview import", exact: true }).click();
assert.match(
  await page.locator("#import-result").textContent(),
  /Removes 3 ships, 5 crew and 1 encounters/,
);
await page.locator("#import-mode").selectOption("merge");
assert.equal(
  await page
    .getByRole("button", { name: "Import library", exact: true })
    .count(),
  0,
);
await page.getByRole("button", { name: "Preview import", exact: true }).click();
assert.match(
  await page.locator("#import-result").textContent(),
  /other entries are kept/,
);
await page.locator("#import-mode").selectOption("replace");
await page.getByRole("button", { name: "Preview import", exact: true }).click();
await page.locator("#import-result").scrollIntoViewIfNeeded();
await page.screenshot({ path: "/tmp/crowbear-replace-import-400.png" });
await page.setViewportSize({ width: 320, height: 560 });
await page
  .getByRole("button", { name: "Import library", exact: true })
  .scrollIntoViewIfNeeded();
await page.screenshot({ path: "/tmp/crowbear-replace-import-320.png" });
assert.equal(
  await page.locator("main").evaluate((el) => el.scrollWidth > el.clientWidth),
  false,
);
await page.getByRole("button", { name: "Import library", exact: true }).click();
assert.match(await page.locator(".notice").textContent(), /Library imported/);
await page.getByRole("button", { name: "Ships", exact: true }).click();
assert.equal(await page.locator("#ship-select option").count(), 1);
assert.match(await page.locator("#ship-select").textContent(), /Imported ship/);
await page
  .getByRole("navigation", { name: "Main navigation" })
  .getByRole("button", { name: "Crew", exact: true })
  .click();
assert.equal(await page.locator(".crew-item").count(), 1);
await page.getByRole("button", { name: "Saved", exact: true }).click();
assert.equal(await page.locator(".saved-encounter").count(), 1);
assert.match(
  await page.locator(".saved-encounter").textContent(),
  /Imported encounter/,
);
assert.deepEqual(errors, []);
console.log("Feedback UI flows pass, no errors, no horizontal overflow.");
await browser.close();
