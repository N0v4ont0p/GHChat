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

/**
 * Vite transform plugin that fixes a Rollup CJS bundling incompatibility with
 * sql.js 1.x (sql-wasm.js).
 *
 * The problem:
 *   sql.js intentionally sets `module = undefined` inside initSqlJs() to
 *   prevent the emscripten-generated code from doing its own CJS export.
 *   The emscripten guard `"undefined"!=typeof module&&(module.exports=k)` is
 *   designed to short-circuit when module is undefined.
 *
 *   However, Rollup's @rollup/plugin-commonjs knows that `module` is the CJS
 *   wrapper parameter (always defined at the IIFE level) and statically
 *   optimises `typeof module !== "undefined"` to `true`, stripping the guard.
 *   The output bundle therefore contains bare `module.exports = k`.  At
 *   runtime, `module` is already `undefined` (sql.js cleared it), so this
 *   line throws:
 *     TypeError: Cannot set properties of undefined (setting 'exports')
 *
 * The fix:
 *   Replace the emscripten assignment with a no-op comment before Rollup
 *   sees the source.  This is exactly what sql.js intended — the proper CJS
 *   export is the UMD wrapper at the bottom of the file (`module.exports =
 *   initSqlJs`), which Rollup handles correctly.
 */
const fixSqlJsRollupCjsPlugin = {
  name: "fix-sqljs-rollup-cjs-compat",
  transform(code: string, id: string): { code: string; map: null } | undefined {
    if (!id.endsWith("sql-wasm.js") || !id.includes("sql.js")) return undefined;
    console.log("[vite:fix-sqljs] patching emscripten module.exports=k in", id);
    const patched = code.replace(
      '"undefined"!=typeof module&&(module.exports=k)',
      '/* patched by fix-sqljs-rollup-cjs-compat: emscripten CJS assignment removed; ' +
        "sql.js UMD wrapper at bottom of file handles the real CJS export */",
    );
    if (patched === code) {
      // Pattern not found — warn so the issue is visible if sql.js is updated.
      console.warn("[vite:fix-sqljs] WARNING: expected pattern not found in", id);
      return undefined;
    }
    return { code: patched, map: null };
  },
} as const;

export default defineConfig({
  main: {
    // sql.js and drizzle-orm must be bundled into the main-process output so
    // that the packaged app does not need a node_modules directory at runtime.
    // The sql-wasm.wasm binary is handled separately via electron-builder's
    // extraResources (see electron-builder.yml) and resolved at runtime by
    // locateSqlJsWasm() in database.ts.
    //
    // fixSqlJsRollupCjsPlugin must come BEFORE externalizeDepsPlugin so that
    // the transform runs on the raw sql.js source before Rollup's CJS plugin
    // sees it.
    plugins: [fixSqlJsRollupCjsPlugin, externalizeDepsPlugin({ exclude: ["sql.js", "drizzle-orm"] })],
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
