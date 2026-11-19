import { expect, test } from "bun:test";

import { continueLabel, modelLine, permissionButton } from "./firstRunText.ts";

test("o botão de cada permissão: Permitir na primeira vez, os Ajustes depois, nada quando já foi dada", () => {
  expect(permissionButton("undetermined")).toBe("Permitir");
  expect(permissionButton("denied")).toBe("Abrir os Ajustes");
  expect(permissionButton("restricted")).toBe("Abrir os Ajustes");
  expect(permissionButton(undefined)).toBe("Abrir os Ajustes");
  expect(permissionButton("granted")).toBeNull();
});

test("a linha do modelo segue o download, e a barra só tem fração quando ela se sabe", () => {
  expect(modelLine({ state: "starting" })).toMatchObject({ text: "Começando…", fraction: null });
  expect(modelLine({ state: "loading", phase: "listing", fraction: 0 })).toMatchObject({ fraction: null });
  expect(modelLine({ state: "loading", phase: "downloading", fraction: 0.416 })).toMatchObject({ text: "Baixando: 42% de 614 MB", fraction: 0.42 });
  expect(modelLine({ state: "loading", phase: "downloading", fraction: 1.7 })).toMatchObject({ fraction: 1 });
  expect(modelLine({ state: "loading", phase: "compiling", fraction: 1 }).text).toBe("Preparando o modelo para este Mac…");
  expect(modelLine({ state: "loading" }).text).toBe("Carregando o modelo…");
  expect(modelLine({ state: "ready" })).toMatchObject({ text: "Pronto para ditar.", done: true, fraction: 1 });
  expect(modelLine({ state: "ready", boosting: "loading" }).text).toContain("99 MB");
  expect(modelLine({ state: "unavailable" })).toMatchObject({ failed: true, fraction: null });
});

test("o Continuar diz quando segue sem permitir", () => {
  expect(continueLabel(0)).toBe("Continuar");
  expect(continueLabel(2)).toBe("Continuar sem permitir");
});
