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
      // O helper Swift, compilado pelo preBuild (scripts/build-helper.ts). O app sobe ele de bin/kiwi-helper.
      ".helper": "bin",
    },
    watchIgnore: ["dist/**"],
    mac: {
      bundleCEF: false,
      bundleWGPU: false,
      codesign: false,
      notarize: false,
    },
  },
  scripts: {
    preBuild: "./scripts/build-helper.ts",
    // NSMicrophoneUsageDescription no Info.plist (o Electrobun não tem campo para isso).
    postBuild: "./scripts/info-plist.ts",
    postWrap: "./scripts/info-plist.ts",
  },
  runtime: {
    // A menu bar app: closing the last window keeps it running.
    exitOnLastWindowClosed: false,
  },
} satisfies ElectrobunConfig;
