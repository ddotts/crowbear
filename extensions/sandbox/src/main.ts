import { createDicePlusClient, type RollTarget } from "@crowbear/dice-plus";
import OBR from "@owlbear-rodeo/sdk";
import "./style.css";

const client = createDicePlusClient("com.ddotts.crowbear.sandbox");
const form = document.querySelector("#roll-form") as HTMLFormElement;
const notation = document.querySelector("#notation") as HTMLInputElement;
const target = document.querySelector("#target") as HTMLSelectElement;
const button = document.querySelector("#roll") as HTMLButtonElement;
const connection = document.querySelector(
  "#connection",
) as HTMLParagraphElement;
const result = document.querySelector("#result") as HTMLParagraphElement;

if (OBR.isAvailable) {
  OBR.onReady(() => {
    connection.textContent =
      "Connected to Owlbear. Enable Dice+ in this room to roll.";
    button.disabled = false;
  });
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  button.disabled = true;
  result.textContent = "Checking Dice+…";
  try {
    if (!(await client.isReady())) {
      result.textContent =
        "Dice+ did not respond. Enable it in this room, then try again.";
      return;
    }
    const validation = await client.validateNotation(notation.value);
    if (!validation.valid) {
      result.textContent =
        validation.error?.message ?? "Dice+ could not parse this notation.";
      return;
    }
    result.textContent = "Rolling…";
    // Dice+ handles audience visibility, including GM-only results.
    await client.roll({
      diceNotation: notation.value,
      rollTarget: target.value as RollTarget,
      showResults: true,
    });
    result.textContent =
      "Roll complete. Results are shown by Dice+ to the selected audience.";
  } catch (error) {
    result.textContent =
      error instanceof Error ? error.message : "The roll could not be sent.";
  } finally {
    button.disabled = false;
  }
});
