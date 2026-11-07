import { cp, mkdir, readdir, rm } from "node:fs/promises";

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
}
