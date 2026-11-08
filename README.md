# Crowbear

A monorepo for independently installable [Owlbear Rodeo](https://www.owlbear.rodeo/)
extensions. Source lives in the public [ddotts/crowbear](https://github.com/ddotts/crowbear)
repository; built extensions are hosted on GitHub Pages.

Dice+ is an external extension by Missing Link Dev. Crowbear does not copy or
replace it. The internal `@crowbear/dice-plus` package provides a typed broadcast
bridge based on its [integration documentation](https://extensions.owlbear.rodeo/dice-plus#extension-integration).

## Development

Use Node.js 24 and pnpm 12.3.0 (`npm install -g pnpm@12.3.0` if needed).

```sh
pnpm install
pnpm dev
```

The sandbox opens at `http://127.0.0.1:5173`. To install locally, add
`http://127.0.0.1:5173/manifest.json` through your Owlbear profile's Extensions
page, then enable **Crowbear Sandbox** and [Dice+](https://extensions.owlbear.rodeo/dice-plus)
in the same room. The standalone preview explains the room requirement and
disables rolling; it does not simulate results.

| Command                                   | Purpose                                          |
| ----------------------------------------- | ------------------------------------------------ |
| `pnpm check`                              | Formatting, lint, and all workspace type checks  |
| `pnpm format`                             | Apply formatting and safe lint fixes             |
| `pnpm test`                               | Dice+ broadcast contract tests                   |
| `pnpm build`                              | Build all extensions and assemble `dist/<slug>/` |
| `pnpm verify:dist`                        | Check install manifests and their built assets   |
| `pnpm --filter @crowbear/sandbox preview` | Inspect the production sandbox build             |

## Layout

```text
extensions/sandbox/    Installable integration workbench; no local dice engine
extensions/spaceship-combat/  Compact GM/player spaceship combat extension
packages/dice-plus/    Typed Dice+ client and protocol tests
scripts/              Deployment assembly and manifest verification
.agents/skills/       Canonical project skills shared with Codex and Claude
```

To add an extension, follow the `owlbear-extension` skill or the
[extension contract](docs/architecture.md#extension-contract). Give it its own
slug, package, manifest, version, and build scripts. Assembly discovers extension
directories automatically; users install only the manifests they choose.

## Spaceship combat

Run `pnpm --filter @crowbear/spaceship-combat dev` and open
<http://127.0.0.1:5174> for the standalone demo. Install
`http://127.0.0.1:5174/manifest.json` in Owlbear for live use, then enable the
extension and Dice+ in the room and open a scene. The GM initializes the sample
player ship and a private library with two NPC ships and a sample encounter.

The compact panel supports encounters, crew assignments, damage effects,
station configurations, AC/maxG/Speed modifiers, Markdown descriptions and Dice+
rolls. In Owlbear, player ships/crew sync to scene metadata; NPCs and encounters
persist in the GM browser. Outside Owlbear, changes are an unsaved demo.
See the [storage, JSON and rules contract](docs/spaceship-combat.md), including
operating limits and rules to review. Use **Import → Export** for backups.

With the dev server running, execute the SDK host fixture:

```sh
pnpm --filter @crowbear/spaceship-combat exec playwright install chromium
pnpm --filter @crowbear/spaceship-combat qa:room
pnpm --filter @crowbear/spaceship-combat qa:panel
```

This tests SDK integration against a local host and Dice+ protocol fixture;
actual room installation and audience routing still require real-room testing.
After deployment, the install URL will be
<https://ddotts.github.io/crowbear/spaceship-combat/manifest.json>.

## Dice+ bridge

Declare `"@crowbear/dice-plus": "workspace:*"` in the consuming extension.
Call it after `OBR.onReady` in a room with Dice+ enabled:

```ts
import { createDicePlusClient } from "@crowbear/dice-plus";

const dice = createDicePlusClient("com.ddotts.crowbear.my-extension");
if (await dice.isReady()) {
  const check = await dice.validateNotation("2d20kh1+5");
  if (check.valid) {
    const roll = await dice.roll({
      diceNotation: check.notation,
      rollTarget: "everyone",
      showResults: true,
    });
    console.log(roll.result.totalValue);
  }
}
```

See [the bridge contract](docs/dice-plus.md) for audience behavior, timeouts,
response validation, and upstream documentation caveats.

## Hosting and installation

`pnpm build` produces a static `dist/` tree suitable for public HTTPS hosting.
The sandbox's install link is `<hosting-base>/sandbox/manifest.json`. Keep that
URL stable once installed.

CI verifies pushes and pull requests. The separate **Deploy extensions** workflow
is manually triggered on `main`; it deploys only built files to GitHub Pages.
Pages uses the GitHub Actions publishing source. Install the sandbox using
<https://ddotts.github.io/crowbear/sandbox/manifest.json>.

Add the manifest URL to your Owlbear profile, enable the sandbox
and Dice+ in a room, and roll once to verify the real integration. Local protocol
tests cannot verify an authenticated Owlbear room or the deployed Dice+ service.
