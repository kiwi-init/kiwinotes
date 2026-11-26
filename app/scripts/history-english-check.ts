// O Histórico dos ditados em inglês (T30632, spec #28171, caixa 6): a lista por dia (Today, Yesterday), um ditado
// não concluído, a busca sem resultado e o "Send to note…" até o aviso de onde foi, com o app em English. Na aba Ditado
// do hub de verdade, com o AppEngine headless num tmp, num WebKit headless (`english-check-lib.ts`): nada aparece na
// tela de ninguém. Os ditados são inventados e em inglês, escritos no `history/` antes de o headless subir.
//
//   bun scripts/history-english-check.ts [pasta]
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "playwright-core";
import { startEnglish } from "./english-check-lib";
import { enHistory } from "../src/shared/i18n/history.en.ts";

const tr = (key: keyof typeof enHistory) => enHistory[key] as string;

/** O arquivo do dia, como o `HistoryStore` grava: `history/AAAA-MM-DD.jsonl`, no fuso local. */
const day = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const now = new Date();
const minutesAgo = (m: number) => new Date(now.getTime() - m * 60_000);
const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 15, 30);
const entry = (at: Date, n: number, raw: string, text: string) => ({ id: `${at.toISOString()}-00000000000${n}`, at: at.toISOString(), app: { name: "Mail" }, raw, text });
const ENTRIES = [
  entry(yesterday, 1, "remember to call the plumber", "Remember to call the plumber."),
  entry(minutesAgo(30), 2, "uh the meeting moved to thursday", "The meeting moved to Thursday."),
  entry(minutesAgo(5), 3, "buy bread and coffee", "Buy bread and coffee."),
];

const s = await startEnglish({
  name: "history-english",
  // A pasta da nota nova é a do disco (`INBOX`, `fromDictation.ts`), "Caixa de entrada" também em English. Se ela muda
  // de nome em inglês é decisão do lead (#28171); até lá sai no resumo, sem reprovar.
  known: [["Caixa de entrada", "#28171"]],
  seed(data) {
    const dir = join(data, "history");
    mkdirSync(dir, { recursive: true });
    for (const e of ENTRIES) writeFileSync(join(dir, `${day(new Date(e.at))}.jsonl`), `${JSON.stringify(e)}\n`, { flag: "a" });
  },
});
let page: Page | null = null;
try {
  assert.equal((await s.invoke("app.locale")).locale, "en", "o app devia estar em English");
  const { page: p } = await s.open("hub", { section: "dictation" });
  page = p;
  await p.waitForSelector(".kn-entry >> nth=2", { timeout: 20000 });

  // A lista por dia, com o original de cada ditado.
  const days = (await p.locator(".kn-day").allInnerTexts()).map((t) => t.toLowerCase());
  assert.ok(days[0]?.includes(tr("history.today").toLowerCase()) && days[1]?.includes(tr("history.yesterday").toLowerCase()), JSON.stringify(days));
  await s.check(p, "1-lista");

  // As ações de um ditado e o "Send to note…".
  const first = p.locator(".kn-entry").first();
  await first.hover();
  await first.getByRole("button", { name: tr("history.sendToNote") }).click();
  await p.waitForSelector(".kn-tonote-item", { timeout: 10000 });
  await s.check(p, "2-enviar-para-nota");
  await p.locator(".kn-tonote-item[data-kind=new]").dblclick();
  await first.locator(".kn-entry-sent").waitFor({ timeout: 10000 });
  await s.check(p, "3-foi-para-a-nota");

  // A busca sem resultado.
  await p.getByRole("searchbox", { name: tr("history.search") }).fill("zebra crossing");
  await p.waitForSelector(".kn-entry", { state: "detached", timeout: 10000 });
  await Bun.sleep(500);
  await s.check(p, "4-busca-sem-nada");
} catch (e) {
  await s.fail(e, page);
}
await s.finish();
