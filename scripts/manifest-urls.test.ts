import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { hostedManifest, pagesBase } from "./manifest-urls.mjs";

describe("Owlbear manifest URLs", () => {
  for (const slug of ["sandbox", "spaceship-combat"]) {
    it(`resolves ${slug} icons and iframes without relying on Owlbear's relative URL handling`, async () => {
      const source = JSON.parse(
        await readFile(
          new URL(
            `../extensions/${slug}/public/manifest.json`,
            import.meta.url,
          ),
          "utf8",
        ),
      );
      const manifest = hostedManifest(source, slug);
      for (const path of [
        manifest.icon,
        manifest.action.icon,
        manifest.action.popover,
        ...(manifest.background_url ? [manifest.background_url] : []),
      ]) {
        // The failing client concatenated the origin and './index.html',
        // producing https://ddotts.github.io./index.html instead of the repo path.
        const clientUrl = path.startsWith("https://")
          ? path
          : `${pagesBase.origin}${path}`;
        const resolved = new URL(clientUrl);
        expect(resolved.origin).toBe(pagesBase.origin);
        expect(resolved.pathname).toMatch(new RegExp(`^/crowbear/${slug}/`));
      }
      expect(manifest.action.popover).toBe(
        `https://ddotts.github.io/crowbear/${slug}/index.html`,
      );
      expect(source.action.popover).toBe("/index.html");
      expect(
        new URL(`http://127.0.0.1:5174${source.action.popover}`).pathname,
      ).toBe("/index.html");
      if (slug === "spaceship-combat")
        expect(manifest.background_url).toBe(
          "https://ddotts.github.io/crowbear/spaceship-combat/background.html",
        );
    });
  }
  it("rejects paths that leave the extension directory", () => {
    expect(() =>
      hostedManifest(
        { icon: "/../index.html", action: {} },
        "spaceship-combat",
      ),
    ).toThrow(/escapes extension/);
  });
});
