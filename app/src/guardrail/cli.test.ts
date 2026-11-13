// `bun run cli guardrail scan` (spec #9690): o que o detector seguraria, com o trecho mascarado. O segredo nunca sai na
// saída. Os exemplos são montados aqui, sem token inteiro escrito no código.

import { afterAll, expect, test } from "bun:test";
import { rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { tempDir } from "../../test/tmp.ts";

const appDir = path.resolve(import.meta.dirname, "..", "..");
const dir = tempDir("kn-guardrail-cli-");
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const token = ["gh", "p_"].join("") + "Ab1".repeat(12);
const password = "Kiwi#2024";
const note = [
  "# Deploy do PACS",
  "",
  "Servidor vm-pacs-prd-01 (10.1.2.3), falar com Ana (ana@exemplo.com.br).",
  `senha: ${password}`,
  `GITHUB_TOKEN=${token}`,
  "senha: trocar",
  "StudyInstanceUID 1.2.840.113619.2.55.3.604688119.868.1234567890.123",
].join("\n");

async function cli(args: string[], stdin?: string) {
  const p = Bun.spawn([process.execPath, path.join(appDir, "scripts", "cli.ts"), ...args], {
    stdin: stdin === undefined ? "ignore" : new Blob([stdin]),
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, KIWI_HEADLESS_DATA: dir },
  });
  const out = await new Response(p.stdout).text();
  return { code: await p.exited, out };
}

test("o scan mostra os trechos com a linha, o veredito, o tipo e a máscara, e nunca o segredo", async () => {
  const file = path.join(dir, "nota.md");
  writeFileSync(file, note);
  const r = await cli(["guardrail", "scan", file]);
  expect(r.code).toBe(0);
  const v = JSON.parse(r.out).value;
  expect(v).toMatchObject({ verdict: "segredo", secrets: 2, doubts: 1, characters: note.length });
  expect(v.findings).toEqual([
    { line: 4, verdict: "segredo", kind: "senha", masked: "•••• (9 caracteres)" },
    { line: 5, verdict: "segredo", kind: "token do GitHub", masked: "ghp_•••• (40 caracteres)" },
    { line: 6, verdict: "dúvida", kind: "senha", masked: "•••• (6 caracteres)" },
  ]);
  expect(r.out).not.toContain(password);
  expect(r.out).not.toContain(token);
  expect(r.out).not.toContain("trocar");
}, 30_000);

test("o scan lê a entrada com `-`, e um texto de trabalho sai limpo", async () => {
  const r = await cli(["guardrail", "scan", "-"], "unidade,ip\nCDB Paulista,10.1.2.3\nAna Souza, (11) 3456-7890\n");
  expect(r.code).toBe(0);
  expect(JSON.parse(r.out).value).toMatchObject({ file: "(entrada)", verdict: "limpo", secrets: 0, doubts: 0, findings: [] });
}, 30_000);

test("o uso errado e o arquivo que não abre", async () => {
  expect((await cli(["guardrail"])).code).toBe(2);
  expect((await cli(["guardrail", "scan"])).code).toBe(2);
  expect((await cli(["guardrail", "limpar", "x"])).code).toBe(2);
  const missing = await cli(["guardrail", "scan", path.join(dir, "nao-existe.md")]);
  expect(missing.code).toBe(1);
  expect(JSON.parse(missing.out)).toMatchObject({ ok: false, code: "E_NOT_FOUND" });
}, 30_000);
