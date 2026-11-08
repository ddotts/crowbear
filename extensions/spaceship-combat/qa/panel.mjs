import assert from "node:assert/strict";
import { chromium } from "playwright";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 400, height: 640 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.goto(process.env.CROWBEAR_QA_URL ?? "http://127.0.0.1:5174");
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
  .locator(".effect-list .description")
  .first()
  .locator("summary")
  .click();
assert.ok(
  (await page.locator(".effect-list .description[open] strong").count()) > 0,
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
assert.deepEqual(errors, []);
console.log("Feedback UI flows pass, no errors, no horizontal overflow.");
await browser.close();
