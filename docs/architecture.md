# Architecture

Crowbear uses a pnpm workspace, TypeScript, and Vite. Each folder under
`extensions/` is a private application package and an independent Owlbear
extension. There is no npm publication step: Owlbear installs a hosted manifest.

## Extension contract

- `public/manifest.json` declares `manifest_version: 1`, the extension's version,
  icon, and action popover. Its version matches the package version.
- Manifest URLs are relative (`./icon.svg`, `./index.html`), and Vite uses
  `base: "./"`. This keeps paths valid under `/crowbear/<slug>/` on GitHub Pages
  and at `/` during local development.
- Each package supplies `dev`, `typecheck`, and `build` scripts. Root recursive
  commands run the corresponding scripts across all extensions.
- `scripts/assemble.mjs` copies extension builds into `dist/<slug>/` after a
  successful build. `scripts/verify-dist.mjs` checks the built manifests and
  their referenced local files. The generated `dist/` tree is the deployment artifact.
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
