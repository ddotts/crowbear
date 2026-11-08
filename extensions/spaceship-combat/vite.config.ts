import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";
export default defineConfig({
  base: "./",
  build: {
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL("./index.html", import.meta.url)),
        background: fileURLToPath(
          new URL("./background.html", import.meta.url),
        ),
      },
    },
  },
});
