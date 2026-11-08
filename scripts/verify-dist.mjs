import assert from "node:assert/strict";
import { access, readdir, readFile } from "node:fs/promises";
import { pagesBase } from "./manifest-urls.mjs";

const output = new URL("../dist/", import.meta.url);
let count = 0;
for (const entry of await readdir(output, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const base = new URL(`${entry.name}/`, output);
  const hostedBase = new URL(`${entry.name}/`, pagesBase);
  const localReference = (path) => {
    const url = new URL(path);
    assert.ok(
      url.href.startsWith(hostedBase.href),
      `${entry.name}: manifest URL must include the full hosted extension path: ${path}`,
    );
    return new URL(url.pathname.slice(hostedBase.pathname.length), base);
  };
  const manifest = JSON.parse(
    await readFile(new URL("manifest.json", base), "utf8"),
  );
  const pkg = JSON.parse(
    await readFile(
      new URL(`../extensions/${entry.name}/package.json`, import.meta.url),
      "utf8",
    ),
  );
  assert.equal(manifest.manifest_version, 1);
  assert.equal(manifest.version, pkg.version);
  assert.ok(manifest.name.length > 0 && manifest.name.length <= 45);
  assert.ok(manifest.description.length <= 128);
  for (const path of [
    manifest.icon,
    manifest.action.icon,
    manifest.action.popover,
    ...(manifest.background_url ? [manifest.background_url] : []),
  ]) {
    const url = localReference(path);
    assert.ok(
      url.href.startsWith(base.href),
      `${entry.name}: path escapes extension directory`,
    );
    await access(url);
  }
  for (const entryHtml of [
    manifest.action.popover,
    ...(manifest.background_url ? [manifest.background_url] : []),
  ]) {
    const localHtml = localReference(entryHtml);
    const html = await readFile(localHtml, "utf8");
    for (const match of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
      const path = match[1];
      assert.ok(
        path.startsWith("./"),
        `${entry.name}: built asset must be relative: ${path}`,
      );
      await access(new URL(path, localHtml));
    }
  }
  count++;
  console.log(
    `Verified ${entry.name}: manifest, version, icons, popover, and bundled assets`,
  );
}
assert.ok(count > 0, "No installable extensions were built");
