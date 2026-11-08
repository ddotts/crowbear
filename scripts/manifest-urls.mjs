import assert from "node:assert/strict";

export const pagesBase = new URL("https://ddotts.github.io/crowbear/");

export function hostedManifest(manifest, slug) {
  const base = new URL(`${slug}/`, pagesBase);
  const hosted = structuredClone(manifest);
  const resolve = (path) => {
    assert.ok(path.startsWith("/"), "Local manifest paths must start with /");
    const url = new URL(path.slice(1), base);
    assert.ok(
      url.href.startsWith(base.href),
      "Manifest path escapes extension",
    );
    return url.href;
  };
  hosted.icon = resolve(hosted.icon);
  hosted.action.icon = resolve(hosted.action.icon);
  hosted.action.popover = resolve(hosted.action.popover);
  if (hosted.background_url)
    hosted.background_url = resolve(hosted.background_url);
  return hosted;
}
