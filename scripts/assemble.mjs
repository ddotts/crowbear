import { cp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { hostedManifest } from "./manifest-urls.mjs";

await rm(new URL("../dist/", import.meta.url), {
  recursive: true,
  force: true,
});
await mkdir(new URL("../dist/", import.meta.url));
for (const entry of await readdir(new URL("../extensions/", import.meta.url), {
  withFileTypes: true,
})) {
  if (!entry.isDirectory()) continue;
  await cp(
    new URL(`../extensions/${entry.name}/dist/`, import.meta.url),
    new URL(`../dist/${entry.name}/`, import.meta.url),
    { recursive: true },
  );
  const manifestUrl = new URL(
    `../dist/${entry.name}/manifest.json`,
    import.meta.url,
  );
  const manifest = JSON.parse(await readFile(manifestUrl, "utf8"));
  await writeFile(
    manifestUrl,
    `${JSON.stringify(hostedManifest(manifest, entry.name), null, 2)}\n`,
  );
}
