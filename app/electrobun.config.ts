import type { ElectrobunConfig } from "electrobun";

import pkg from "./package.json" with { type: "json" };

export default {
  app: {
    name: "Kiwi Notes",
    identifier: "app.kiwinotes.desktop",
    version: pkg.version,
  },
  build: {
    mainProcess: "bun",
    bun: {
      entrypoint: "src/bun/index.ts",
    },
    // Vite builds every window into dist/; the views live at views://ui/<window>/index.html.
    copy: {
      dist: "views/ui",
      assets: "assets",
    },
    watchIgnore: ["dist/**"],
    mac: {
      bundleCEF: false,
      bundleWGPU: false,
      codesign: false,
      notarize: false,
    },
  },
  runtime: {
    // A menu bar app: closing the last window keeps it running.
    exitOnLastWindowClosed: false,
  },
} satisfies ElectrobunConfig;
