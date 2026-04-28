import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";
import { resolve } from "path";

// Output directory contract — these must stay in sync with:
//   • package.json  "main": "out/main/index.js"
//   • window.ts     join(__dirname, "../preload/index.js")   (preload)
//   • window.ts     join(__dirname, "../renderer/index.html") (renderer)
//   • electron-builder.yml  files: ["out/**/*"]
const OUT_MAIN = "out/main";
const OUT_PRELOAD = "out/preload";
const OUT_RENDERER = "out/renderer";

export default defineConfig({
  main: {
    // sql.js and drizzle-orm must be bundled into the main-process output so
    // that the packaged app does not need a node_modules directory at runtime.
    // The sql-wasm.wasm binary is handled separately via electron-builder's
    // extraResources (see electron-builder.yml) and resolved at runtime by
    // locateSqlJsWasm() in database.ts.
    plugins: [externalizeDepsPlugin({ exclude: ["sql.js", "drizzle-orm"] })],
    build: {
      outDir: OUT_MAIN,
      rollupOptions: {
        input: {
          index: resolve("electron/main/index.ts"),
        },
      },
    },
    resolve: {
      alias: {
        "@shared": resolve("src/types"),
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: OUT_PRELOAD,
      rollupOptions: {
        input: resolve("electron/preload/index.ts"),
      },
    },
  },
  renderer: {
    root: ".",
    build: {
      outDir: OUT_RENDERER,
      rollupOptions: {
        input: resolve("index.html"),
      },
    },
    resolve: {
      alias: {
        "@": resolve("src"),
      },
    },
    plugins: [react()],
  },
});
