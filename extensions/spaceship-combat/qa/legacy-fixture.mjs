import { crew, ships } from "../src/sample-data.ts";

// Keep the existing mechanics regressions independent of the bundled defaults.
export async function loadLegacyFixture(panel) {
  await panel.getByRole("button", { name: "Import", exact: true }).click();
  await panel.locator("#json").fill(
    JSON.stringify({
      version: 1,
      ships,
      crew,
      encounters: [
        {
          id: "relay",
          name: "Ambush at the relay",
          shipIds: ships.map((s) => s.id),
          round: 1,
          turn: 0,
          currentCrewId: null,
          running: true,
        },
      ],
    }),
  );
  await panel
    .getByRole("button", { name: "Preview import", exact: true })
    .click();
  await panel
    .getByRole("button", { name: "Import library", exact: true })
    .click();
  await panel
    .locator(".notice")
    .getByText("Library imported.", { exact: true })
    .waitFor();
  await panel.getByRole("button", { name: "Run", exact: true }).click();
}
