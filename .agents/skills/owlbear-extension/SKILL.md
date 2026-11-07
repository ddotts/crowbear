---

name: owlbear-extension
description: Add or modify an independently installable Owlbear Rodeo extension in the Crowbear pnpm monorepo, including its manifest, SDK integration, and build output.
---

Read docs/architecture.md and the affected extension before editing. Verify SDK
methods in the official Owlbear documentation or installed SDK types.

Each extension lives in extensions/<slug> with a private @crowbear/<slug> package,
its own version, Vite config, public/manifest.json, public/icon.svg, and src.
Use relative Vite asset paths and relative manifest references so the extension
works beneath a repository path as well as on localhost. Match package and
manifest versions. Do not rename a released slug without a migration decision.

Declare dev, typecheck, and build scripts. The root assembly script discovers
extension folders and copies each build to dist/<slug>; no registry edit is needed.
Document the extension's install URL and development command in README.md.

Guard SDK usage with OBR.isAvailable and wait for OBR.onReady before invoking
SDK methods. Keep standalone previews usable. Namespace persistent metadata,
broadcast channels, and tool IDs with the extension identity when introducing
them. Do not request permissions that the extension does not use.

Test domain behavior and the built manifest's actual referenced files. Inspect
the rendered app at the declared popover size, then run the relevant root checks.
An HTTP 200 or standalone preview does not prove installation in Owlbear Rodeo;
report authenticated room verification separately.
