// O print do T21108: o estoque inventado do T21107 (`test/fixtures/sheet/estoque.xlsx`) antes e depois de mudar uma
// quantidade, com as fórmulas recalculadas, a marcada (`stale`) e a fórmula em português. Sem o app: o recálculo da
// `src/shared/sheet/formula` e uma página no WebKit headless. `bun scripts/sheet-recalc-print.ts <pasta>`.

import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { webkit } from "playwright-core";

import { applyToGrid, plainDisplay, type Grid, type SheetOp } from "../src/shared/sheet/ops.ts";
import { calibrate, recalc, recalcOps } from "../src/shared/sheet/formula/recalc.ts";
import { toPtBr } from "../src/shared/sheet/formula/translate.ts";
import { patchXlsx, readXlsx } from "../src/shared/sheet/xlsx.ts";

const app = resolve(import.meta.dir, "..");
const out = resolve(process.argv[2] ?? join(app, "build/sheet-recalc-print"));
mkdirSync(out, { recursive: true });

const bytes = new Uint8Array(readFileSync(join(app, "test/fixtures/sheet/estoque.xlsx")));
const book = readXlsx(bytes);
const grid: Grid = { sheets: book.sheets.map((s) => ({ name: s.name, rows: s.rows.map((r) => r.map((c) => (c ? { ...c, text: plainDisplay(c.value, c.format) } : undefined))) })) };
const antes = calibrate(grid);
const op: SheetOp = { op: "set", sheet: "Estoque", row: 1, col: 2, value: 100 };
const applied = applyToGrid(antes, op);
const depois = recalc(applied);
const ops = recalcOps(applied, depois);
const back = readXlsx(patchXlsx(bytes, [{ op: "batch", ops: [op, ...ops] }]));

const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!);
const table = (g: Grid, sheet: number, mark: (r: number, c: number) => boolean) =>
  `<table>${g.sheets[sheet]!.rows
    .map(
      (r, ri) =>
        `<tr><th>${ri + 1}</th>${Array.from(r ?? [], (c, ci) => {
          const cls = [c?.stale ? "stale" : "", mark(ri, ci) ? "mudou" : "", c?.formula !== undefined ? "f" : ""].join(" ");
          const tip = c?.formula !== undefined ? `<small>${esc(toPtBr(c.formula))}</small>` : "";
          return `<td class="${cls}">${esc(c?.text ?? "")}${c?.stale ? " ⚠︎" : ""}${tip}</td>`;
        }).join("")}</tr>`,
    )
    .join("")}</table>`;
const changed = new Set(ops.map((o) => (o.op === "cached" ? `${o.sheet}:${o.row}:${o.col}` : "")));
const mudou = (name: string) => (r: number, c: number) => changed.has(`${name}:${r}:${c}`) || (name === "Estoque" && r === 1 && c === 2);

const html = `<!doctype html><meta charset="utf-8"><style>
body{font:13px -apple-system,system-ui;margin:20px;background:#fff;color:#222}
h2{font-size:14px;margin:18px 0 6px} table{border-collapse:collapse} td,th{border:1px solid #ddd;padding:4px 8px;vertical-align:top}
th{background:#f4f4f4;color:#888;font-weight:400} td.f{background:#f7fbf4} td small{display:block;color:#5a7a3a;font:11px ui-monospace,monospace}
td.mudou{outline:2px solid #4c9a2a;outline-offset:-2px} td.stale{background:#fff4dc} .cols{display:flex;gap:28px} p{color:#555;margin:4px 0}
</style>
<p><b>T21108</b>: o estoque é inventado. Mudou a quantidade em <b>C2</b> para 100; as fórmulas que dependem dela recalculam. A borda verde marca o que mudou, e o ⚠︎ marca a fórmula que fica com o valor antigo.</p>
<div class="cols"><div><h2>Estoque, antes</h2>${table(antes, 0, () => false)}</div><div><h2>Estoque, depois</h2>${table(depois, 0, mudou("Estoque"))}</div></div>
<div class="cols"><div><h2>Resumo, antes</h2>${table(antes, 1, () => false)}</div><div><h2>Resumo, depois</h2>${table(depois, 1, mudou("Resumo"))}</div></div>
<p>Foram ${ops.length} valores novos no mesmo batch da edição. Reaberto, o arquivo tem E8 = ${esc(String(back.sheets[0]!.rows[7]![4]!.value))}, com a fórmula ${esc(back.sheets[0]!.rows[7]![4]!.formula ?? "")} intacta.</p>`;

const browser = await webkit.launch();
const page = await browser.newPage({ viewport: { width: 1180, height: 400 }, deviceScaleFactor: 2 });
await page.setContent(html);
await page.screenshot({ path: join(out, "recalculo.png"), fullPage: true });
await browser.close();
const w = spawnSync("cwebp", ["-quiet", "-q", "80", join(out, "recalculo.png"), "-o", join(out, "recalculo.webp")]);
console.log(w.status === 0 ? join(out, "recalculo.webp") : "sem o cwebp: ficou o PNG");
console.log(`${ops.length} cached:`, JSON.stringify(ops));
