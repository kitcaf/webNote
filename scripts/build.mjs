import { cpSync, mkdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "vite";

const workspaceRoot = fileURLToPath(new URL("../", import.meta.url));
const distRoot = resolve(workspaceRoot, "dist");
const publicRoot = resolve(workspaceRoot, "public");
const vditorSourceRoot = resolve(workspaceRoot, "node_modules/vditor");
const vditorTargetRoot = resolve(distRoot, "vendor/vditor");
const isWatchMode = process.argv.includes("--watch");
const sharedOutputNames = {
  assetFileNames: "assets/[name]-[hash][extname]",
  chunkFileNames: "assets/[name]-[hash].js"
};

const withWatchMode = (config) =>
  isWatchMode
    ? {
        ...config,
        watch: {}
      }
    : config;

const copyVditorAssetsPlugin = () => ({
  apply: "build",
  closeBundle() {
    rmSync(vditorTargetRoot, {
      recursive: true,
      force: true
    });
    mkdirSync(vditorTargetRoot, {
      recursive: true
    });
    cpSync(resolve(vditorSourceRoot, "dist"), resolve(vditorTargetRoot, "dist"), {
      recursive: true
    });
  },
  name: "copy-vditor-assets"
});

const createBaseConfig = () => ({
  configFile: false,
  publicDir: publicRoot,
  root: workspaceRoot
});

const buildBackground = () =>
  build({
    ...createBaseConfig(),
    build: withWatchMode({
      emptyOutDir: true,
      outDir: distRoot,
      rollupOptions: {
        input: resolve(workspaceRoot, "src/background/index.ts"),
        output: {
          ...sharedOutputNames,
          entryFileNames: "background.js",
          format: "es"
        }
      }
    })
  });

const buildContent = () =>
  build({
    ...createBaseConfig(),
    build: withWatchMode({
      emptyOutDir: false,
      outDir: distRoot,
      rollupOptions: {
        input: resolve(workspaceRoot, "src/content/index.ts"),
        output: {
          ...sharedOutputNames,
          entryFileNames: "content.js",
          format: "iife",
          name: "WebNoteContentScript"
        }
      }
    })
  });

const buildPageRouteBridge = () =>
  build({
    ...createBaseConfig(),
    build: withWatchMode({
      emptyOutDir: false,
      outDir: distRoot,
      rollupOptions: {
        input: resolve(workspaceRoot, "src/content/page-route-bridge.ts"),
        output: {
          ...sharedOutputNames,
          entryFileNames: "page-route-bridge.js",
          format: "iife",
          name: "WebNotePageRouteBridge"
        }
      }
    })
  });

const buildSidePanel = () =>
  build({
    ...createBaseConfig(),
    plugins: [copyVditorAssetsPlugin()],
    build: withWatchMode({
      emptyOutDir: false,
      outDir: distRoot,
      rollupOptions: {
        input: resolve(workspaceRoot, "sidepanel.html"),
        output: {
          ...sharedOutputNames,
          entryFileNames: "assets/[name].js"
        }
      }
    })
  });

try {
  await buildBackground();
  await buildPageRouteBridge();
  await buildContent();
  await buildSidePanel();
} catch (error) {
  console.error("WebNote build failed.", error);
  process.exitCode = 1;
}
