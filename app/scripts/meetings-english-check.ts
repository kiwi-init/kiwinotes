// As Reuniões em inglês (T30636, spec #28171, caixa 6): a aba Reuniões vazia, a lista, renomear, a lixeira com o
// desfazer e uma reunião aberta nas Notas, com o app em English, no hub de verdade com o AppEngine headless, num WebKit
// headless: nada aparece na tela de ninguém, e nada grava (sem helper, sem mic). Em cada tela, nenhuma frase em português
// dos catálogos nem palavra só do português (scripts/english-check-lib.ts), e o print fica na pasta. Os Ajustes de
// Reuniões estão no settings-english-check. O painel da gravação ao vivo vem do helper e fica de fora.
//
//   bun scripts/meetings-english-check.ts [pasta]
import assert from "node:assert/strict";
import type { Page } from "playwright-core";
import { startEnglish } from "./english-check-lib";
import { MEETINGS_FOLDER_LABEL as MEETINGS_FOLDER } from "../src/shared/meetings";

// O português que já tem dono: some daqui no PR que o traduz.
const KNOWN: [string, string][] = [];
const s = await startEnglish({ name: "T30636-meetings-english", known: KNOWN });
// A pasta das reuniões no disco não muda com a língua (src/shared/meetings.ts): o nome dela fica em português.
const check = (p: Page, name: string) => s.check(p, name, { skip: [MEETINGS_FOLDER] });

/** Uma reunião inventada, no formato que o app grava (o R4): o frontmatter e a transcrição. */
const meeting = (session: string, day: string, start: string, end: string | null, app: string, people: string[], body = "") =>
  [
    "---",
    "type: meeting",
    `session: ${session}`,
    `date: "${day}"`,
    `start: "${start}"`,
    ...(end ? [`end: "${end}"`, `duration: ${(Date.parse(end) - Date.parse(start)) / 1000}`] : []),
    `app: "${app}"`,
    `participants: [${people.join(", ")}]`,
    "---",
    body,
  ].join("\n");

let page: Page | null = null;
try {
  assert.equal((await s.invoke("app.locale")).locale, "en", "o app devia estar em English");
  const { page: p } = await s.open("hub", { section: "meetings" });
  page = p;

  // 1. Sem reuniões: o vazio, com o atalho de gravar.
  await p.waitForSelector(".kn-empty", { timeout: 20000 });
  await check(p, "1-vazio");

  // 2. A lista: uma com transcrição, uma de outro dia, uma interrompida (sem `end`).
  const notes = [
    ["2026-11-05 14h32 Weekly sync", meeting("e1", "2026-11-05", "2026-11-05T17:32:00.000Z", "2026-11-05T18:10:00.000Z", "Teams", ["Ana", "Bruno", "Carla"], "## My notes\n\n## Transcript\n**14:32 · Ana:** Good morning, let's start with Project X.\n")],
    ["2026-11-05 10h00 Daily", meeting("e2", "2026-11-05", "2026-11-05T13:00:00.000Z", "2026-11-05T13:14:00.000Z", "Chrome", ["Ana", "Bruno", "Carla", "Dora", "Eva"])],
    ["2026-11-03 16h00 Office move", meeting("e3", "2026-11-03", "2026-11-03T19:00:00.000Z", null, "Zoom", ["Ana"])],
  ] as const;
  for (const [title, content] of notes) await s.invoke("notes.create", { folder: MEETINGS_FOLDER, title, content });
  await p.waitForFunction(() => document.querySelectorAll(".kn-meet-row").length === 3, undefined, { timeout: 15000 });
  await check(p, "2-lista");

  // 3. Renomear: o campo no lugar da linha.
  const first = p.locator(".kn-meet-row").first();
  await first.locator(".kn-icon-button").first().click();
  await p.waitForSelector(".kn-meet-rename", { timeout: 10000 });
  await check(p, "3-renomear");
  await p.keyboard.press("Escape");
  await p.waitForSelector(".kn-meet-rename", { state: "detached", timeout: 10000 });

  // 4. Apagar: o aviso da lixeira, com o desfazer.
  await p.locator(".kn-meet-row").last().locator(".kn-icon-button[data-tone=danger]").click();
  await p.waitForSelector(".kn-meet-notice", { timeout: 10000 });
  await check(p, "4-lixeira");
  await p.locator(".kn-meet-notice button").click();
  await p.waitForFunction(() => document.querySelectorAll(".kn-meet-row").length === 3, undefined, { timeout: 15000 });

  // 5. Uma reunião aberta: vai às Notas.
  await p.locator(".kn-meet-open", { hasText: "Weekly sync" }).click();
  await p.waitForSelector(".cm-content", { timeout: 15000 });
  await check(p, "5-reuniao-aberta");
} catch (e) {
  await s.fail(e, page);
}
await s.finish();
