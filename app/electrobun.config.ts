import type { ElectrobunConfig } from "electrobun";

import pkg from "./package.json" with { type: "json" };

export default {
  app: {
    name: "Kiwi Notes",
    identifier: "app.kiwinotes.desktop",
    // A versão do tag (`0.1.0-rc3`), que o CI passa em KIWI_VERSION (T1969): é por ela que o app sabe se o que o feed
    // oferece é mais novo. Fora do CI, a do package.json.
    version: process.env.KIWI_VERSION || pkg.version,
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
      // O ONNX Runtime da busca semântica, posto em app/.onnxruntime/ pelo preBuild (scripts/onnxruntime.ts, T6318).
      ".onnxruntime": "bin/napi-v6/darwin/arm64",
    },
    watchIgnore: ["dist/**"],
    mac: {
      bundleCEF: false,
      bundleWGPU: false,
      codesign: false,
      notarize: false,
      // O ícone (T4411): a v2 aprovada em cada tamanho, por scripts/app-icon.ts, na grade do Channels.
      icons: "build-config/icon.iconset",
    },
  },
  scripts: {
    preBuild: "./scripts/pre-build.ts",
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
