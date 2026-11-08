# Architecture

Crowbear uses a pnpm workspace, TypeScript, and Vite. Each folder under
`extensions/` is a private application package and an independent Owlbear
extension. There is no npm publication step: Owlbear installs a hosted manifest.

## Extension contract

- `public/manifest.json` declares `manifest_version: 1`, the extension's version,
  icon, and action popover. Its version matches the package version. An optional
  `background_url` loads a controller independently of the action popover.
- Source manifest resources use origin-root paths (`/icon.svg`, `/index.html`)
  for local Vite servers. Vite uses `base: "./"` for bundled HTML assets.
  Assembly rewrites manifest icons, popovers and background URLs to full
  `https://ddotts.github.io/crowbear/<slug>/...` URLs. Owlbear does not resolve
  `./` references against the manifest directory: an installed relative path
  produced `https://ddotts.github.io./index.html`, losing the repository path
  and breaking both the icon and iframe. Keep bundled HTML assets relative;
  deployed manifest resources must be absolute and include the extension path.
  Each published resource also carries a `?v=<extension-version>` query so updated
  installations fetch new HTML and icons rather than cached entrypoints.
- Each package supplies `dev`, `typecheck`, and `build` scripts. Root recursive
  commands run the corresponding scripts across all extensions.
- `scripts/assemble.mjs` copies extension builds into `dist/<slug>/` after a
  successful build and publishes their manifest URLs using
  `scripts/manifest-urls.mjs`. `scripts/verify-dist.mjs` checks the built manifests and
  their referenced local files, including background entrypoints when present. The generated `dist/` tree is the deployment artifact.
- SDK calls wait for `OBR.onReady` and only run when `OBR.isAvailable` is true.
  An extension can render outside Owlbear for development.

The `packages/dice-plus` package is the shared typed adapter to the external
Dice+ service. Its [protocol contract](dice-plus.md) documents the boundary.
Add other shared packages only after real duplication across extensions emerges.
Each extension can evolve and version independently; a deployment publishes the
collection atomically while preserving each manifest's stable path.

## Hosting

GitHub Actions checks pull requests and pushes to `main`. A separate manual
workflow builds the collection and deploys the verified `dist/` artifact to
GitHub Pages from `main`. The repository's Pages
source must be set to GitHub Actions. Deployment jobs receive Pages and OIDC
permissions; ordinary validation jobs receive only read access to source.

Public hosting is required for installation by other players, even if the source
repository is private. Keep secrets out of frontend bundles and manifests.

## Primary sources

- [Owlbear extension architecture](https://docs.owlbear.rodeo/extensions/getting-started/)
- [Manifest reference](https://docs.owlbear.rodeo/extensions/reference/manifest/)
- [SDK availability and readiness](https://docs.owlbear.rodeo/extensions/apis/)
- [Install an extension](https://docs.owlbear.rodeo/extensions/tutorial-hello-world/install-your-extension/)
- [Hosting an extension](https://docs.owlbear.rodeo/extensions/tutorial-sharing-your-extension/hosting-your-extension/)
- [pnpm workspaces](https://pnpm.io/workspaces)
- [Vite static deployment](https://vite.dev/guide/static-deploy.html)

## Spaceship combat

The [spaceship combat contract](spaceship-combat.md) defines its scene/private
storage split, GM background controller, JSON format and effect rules.
