// T4945: real Notes view + AppEngine capabilities in headless WebKit, driven by fake helper events. No helper/mic.
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { webkit } from "playwright-core";
import { startHeadless } from "../src/headless/server.ts";
import { MeetingNoteSession } from "../src/bun/meeting-notes.ts";
import type { Event } from "../src/shared/ipc.ts";
import { request } from "./cli.ts";
import { openWindow, type UiContext } from "./ui-page.ts";

const data = await mkdtemp(path.join(os.tmpdir(), "kiwi-t4945-ui-"));
const out = path.resolve(process.argv[2] ?? "../docs/evidence/T4945");
await mkdir(out, { recursive: true });
const server = await startHeadless({ data, helper: false });
const { stores } = await import("../src/bun/stores.ts");
const callbacks = new Map<string, Function[]>();
const source = {
  on(type: string, fn: Function) {
    callbacks.set(type, [...(callbacks.get(type) ?? []), fn]);
    return () =>
      callbacks.set(
        type,
        (callbacks.get(type) ?? []).filter((f) => f !== fn),
      );
  },
};
let now = new Date(2026, 10, 5, 14, 32).getTime();
const errors: unknown[] = [];
const bridge = new MeetingNoteSession(
  source as any,
  stores.meetingNotes,
  () => now,
  (e) => errors.push(String(e)),
);
const emit = (e: Event) => {
  for (const fn of callbacks.get(e.type) ?? []) fn({ ...e, v: 1 });
};
const ctx: UiContext = {
  data,
  send: async (msg) => {
    const response = await request(data, msg);
    assert(response);
    return response;
  },
  subscribe: async (_topics, fn) =>
    stores.notes.onChanged((paths) =>
      fn({ event: "notes.changed", payload: { paths } }),
    ),
};
const browser = await webkit.launch({ headless: true });
const reports: unknown[] = [];
try {
  bridge.attach();
  emit({
    type: "meeting.started",
    session: "synthetic-r4",
    app: "Teams",
    sampleRate: 16000,
    output: "headphones",
  });
  await stores.meetingNotes.flush();
  const created = await stores.notes.get(stores.notes.list().notes[0]!.path);
  await stores.notes.save(
    created.path,
    created.content.replace(
      "## Minhas notas\n",
      "## Minhas notas\n\nConfirmar os dados da VM antes da próxima reunião.\n",
    ),
    created.version,
  );
  emit({
    type: "meeting.segment",
    start: 1,
    end: 4,
    speaker: "Você",
    channel: "mine",
    text: "Vamos validar o PACS e manter os dados no Mac.",
    final: true,
  });
  emit({
    type: "meeting.segment",
    start: 6,
    end: 10,
    speaker: "Pessoa 1",
    channel: "system",
    text: "Eu confiro a lista de unidades até sexta-feira.",
    final: true,
  });
  await stores.meetingNotes.flush();
  for (const theme of ["light", "dark"] as const) {
    const window = await openWindow(browser, ctx, {
      window: "notes",
      browser: "webkit",
      scale: 2,
      theme,
      width: 1180,
      height: 900,
      motion: false,
      query: { note: created.path },
    });
    const page = window.page;
    try {
      await page
        .locator(".cm-content")
        .getByText("Confirmar os dados da VM", { exact: false })
        .waitFor();
      if (theme === "light") {
        const line = page.locator(".cm-content").getByText("Confirmar os dados da VM", {exact:false});
        await line.click();
        await page.keyboard.press("End");
        await page.keyboard.type(" Nova decisão preservada.");
        emit({
          type: "meeting.segment",
          start: 12,
          end: 15,
          speaker: "Pessoa 1",
          channel: "system",
          text: "A revisão continua local e sem enviar áudio.",
          final: true,
        });
        await stores.meetingNotes.flush();
        await page.waitForFunction(() =>
          document
            .querySelector(".cm-content")
            ?.textContent?.includes("A revisão continua local"),
        );
        await page.keyboard.type(" Ainda na mesma linha.");
        await page.waitForTimeout(800);
        const saved = await stores.notes.get(created.path);
        assert(
          saved.content.includes(
            "Nova decisão preservada. Ainda na mesma linha.",
          ),
          saved.content,
        );
        assert(saved.content.includes("A revisão continua local"));
        assert.equal(await page.getByRole("alert").count(), 0);
        // An unrelated edit still uses the normal conflict flow; explicitly keeping mine must keep a valid base.
        await page.keyboard.type(" Confirmado.");
        const beforeExternal = await stores.notes.get(created.path);
        await stores.notes.save(created.path,beforeExternal.content.replace("Confirmar os dados","Alteração externa: confirmar os dados"),beforeExternal.version);
        const conflict = page.getByRole("alert").filter({hasText:"Esta nota mudou fora"});
        await conflict.waitFor();
        await conflict.getByRole("button",{name:"Manter a minha",exact:true}).click();
        await conflict.waitFor({state:"hidden"});
        await page.waitForTimeout(150);
        assert((await stores.notes.get(created.path)).content.includes("Ainda na mesma linha. Confirmado."));
        await page.locator(".kn-crumb-bt").click();
        await page
          .locator(`.kn-side-item[data-path="${created.path}"]`)
          .first()
          .click({ button: "right" });
        await page
          .getByRole("menuitem", { name: "Renomear falante…", exact: true })
          .click();
        const dialog = page.getByRole("dialog", {
          name: "Renomear falante",
          exact: true,
        });
        await dialog
          .getByLabel("Falante", { exact: true })
          .selectOption("Pessoa 1");
        await dialog.getByLabel("Novo nome").fill("Ana");
        await page.screenshot({ path: path.join(out, "renomear-falante.png") });
        await dialog
          .getByRole("button", { name: "Renomear", exact: true })
          .click();
        await dialog.waitFor({ state: "hidden" });
        await page.keyboard.press("Escape");
        await page.waitForFunction(() =>
          document
            .querySelector(".cm-content")
            ?.textContent?.includes("· Ana:"),
        );
        now += 20 * 60_000;
        emit({
          type: "meeting.stopped",
          session: "synthetic-r4",
          pendingChunks: 0,
        });
        await stores.meetingNotes.flush();
        await page.waitForTimeout(150);
      }
      await page.screenshot({
        path: path.join(out, `nota-reuniao-${theme}.png`),
      });
      assert.deepEqual(window.report.problems, []);
      assert.deepEqual(window.report.invokeErrors, []);
      assert.deepEqual(window.report.blocked, []);
      assert.deepEqual(window.report.clipboard, []);
      reports.push({ theme, ...window.report });
    } catch (error) {
      await page.screenshot({path:path.join(out,"falha-ui.png")});
      await writeFile("/tmp/T4945-ui-dom.html",await page.locator(".cm-content").innerHTML());
      throw error;
    } finally {
      await window.close();
    }
  }
  assert.deepEqual(errors, []);
  await writeFile(
    path.join(out, "relatorio.json"),
    JSON.stringify(
      { ok: true, synthetic: true, helper: false, reports },
      null,
      2,
    ) + "\n",
  );
  console.log(JSON.stringify({ ok: true, data, out }));
} finally {
  await browser.close();
  await bridge.detach();
  await server.stop();
  // A pasta de dados é do tmp e só deste roteiro (spec #10077); os prints ficam em `out`, no repo.
  await rm(data, { recursive: true, force: true });
}
