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
    // Falha o build se algum .app que sai dele (build/, artifacts/, .dmg) não passa no codesign --verify --strict (T762).
    postPackage: "./scripts/verify-signature.ts",
  },
  // A atualização automática (T1969, ADR 0008): o feed do Updater é o GitHub Releases. Quem diz o endereço é o CI
  // (`KIWI_UPDATE_URL`, pelo tag): sem ele (build local, ensaio sem tag) o app sai sem baseUrl e nunca checa.
  release: {
    baseUrl: process.env.KIWI_UPDATE_URL ?? "",
    // Sem patch: o do Electrobun sairia do app antes do release.ts assinar e notarizar, e o app baixado não seria o do
    // .dmg. O Updater baixa o app inteiro, o mesmo do .dmg, e o app confere a assinatura antes de oferecer.
    generatePatch: false,
  },
  runtime: {
    // A menu bar app: closing the last window keeps it running.
    exitOnLastWindowClosed: false,
  },
} satisfies ElectrobunConfig;
