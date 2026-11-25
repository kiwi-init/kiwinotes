import { expect, test } from "bun:test";
import { cpSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

import { tempDir } from "../test/tmp.ts";
import { fixedTexts, MIGRATED, MIGRATED_MAIN, mainFixedTexts, SWIFT_DIRS, swiftFixedTexts } from "./i18n-check.ts";

test("acha o texto entre as tags, os atributos visíveis e as opções; ignora o t(), o código e o sem letra (T28190)", () => {
  const src = `
    export const X = () => (
      <Row label="Rótulo" hint={"Dica"} data-x="não conta" className="kn-a">
        <p>Olá, Ana</p>
        <span>{t("settings.back")}</span>
        <span>·</span>
        {"Solto"}
        <Segmented options={[{ value: "a", label: "Opção A" }]} />
        <input placeholder={\`Busca\`} aria-label={t("x")} />
      </Row>
    );
    const y = { id: "codigo", title: "Título" };
    const z = [{ value: "inter", label: "Inter" }]; // i18n-ok: o nome da fonte
  `;
  expect(fixedTexts("x.tsx", src).map((t) => t.text)).toEqual(["Rótulo", "Dica", "Olá, Ana", "Solto", "Opção A", "Busca", "Título"]);
  expect(fixedTexts("x.tsx", src)[0]!.line).toBe(3);
});

test("as telas migradas não têm texto fixo", () => {
  const root = path.resolve(import.meta.dir, "..");
  for (const f of MIGRATED) expect({ f, texts: fixedTexts(f, readFileSync(path.join(root, f), "utf8")) }).toEqual({ f, texts: [] });
});

test("no main: o menu, o diálogo e a frase com acento contam; o log, o erro, o t() e o i18n-ok não (T28192)", () => {
  const src = `
    const menu = [{ label: "Abrir", action: "open" }, { label: t("menu.quit") }];
    showMessageBox({ title: "Aviso", message: \`Abrir \${nome}?\`, buttons: ["Sim", "Cancelar"] });
    const pill = "Nenhum ditado para colar";
    const solto = "Não deu";
    console.warn("não conta no log");
    throw new Error("nem no erro");
    const key = { label: "Kiwi Notes" }; // i18n-ok: o nome do app
    type X = "ação";
    const code = "kiwi-helper";
  `;
  expect(mainFixedTexts("x.ts", src).map((t) => t.text)).toEqual(["Abrir", "Aviso", "Abrir ?", "Sim", "Cancelar", "Não deu"]);
});

test("no Swift: Text, label: e accessibilityLabel contam, e a frase com acento; o log, o comentário e o i18n-ok não (T28192)", () => {
  const src = [
    'Text("Gravar")',
    'Button(action: go) { Text(LearnText.add) }',
    '.accessibilityLabel("Cancelar")',
    'let x = "Não deu"',
    'log("não conta")',
    '// "comentário não conta"',
    'let you = "Você" // i18n-ok: rótulo da transcrição',
    'let q = DispatchQueue(label: "kiwi.fila")',
    'let id = "overlay.error.noInput"',
    'Text("\\(n) min") // "comentário no fim"',
  ].join("\n");
  expect(swiftFixedTexts(src).map((t) => [t.line, t.text])).toEqual([[1, "Gravar"], [3, "Cancelar"], [4, "Não deu"], [10, "\\(n) min"]]);
});

test("o main migrado e o Swift do helper não têm texto fixo (T28192)", () => {
  const root = path.resolve(import.meta.dir, "..");
  for (const f of MIGRATED_MAIN) expect({ f, texts: mainFixedTexts(f, readFileSync(path.join(root, f), "utf8")) }).toEqual({ f, texts: [] });
  const swift = (dir: string): string[] =>
    readdirSync(dir).flatMap((n) => (statSync(path.join(dir, n)).isDirectory() ? swift(path.join(dir, n)) : n.endsWith(".swift") ? [path.join(dir, n)] : []));
  const files = SWIFT_DIRS.flatMap((d) => swift(path.join(root, d)));
  expect(files.length).toBeGreaterThan(20);
  for (const f of files) expect({ f, texts: swiftFixedTexts(readFileSync(f, "utf8")) }).toEqual({ f, texts: [] });
});

test("uma tela migrada com texto fixo faz o check sair 1, e sem ele sai 0 (T28297, revisão do #360)", () => {
  const root = path.resolve(import.meta.dir, "..");
  // A árvore falsa (`<tmp>/app` e `<tmp>/native`): as pastas que o check lê, copiadas, e depois a primeira tela
  // migrada com um texto fixo a mais.
  const dir = path.join(tempDir("i18n-check-"), "app");
  mkdirSync(dir);
  // As pastas das telas e as do main migrado (o `MIGRATED_MAIN` cresce: o T29006 pôs arquivos de `scripts/`).
  const dirs = new Set(["ui", ...MIGRATED_MAIN.map((f) => path.dirname(f))]);
  for (const d of dirs) cpSync(path.join(root, d), path.join(dir, d), { recursive: true, filter: (p) => !p.includes("node_modules") });
  for (const d of SWIFT_DIRS) cpSync(path.join(root, d), path.join(dir, d), { recursive: true });
  const run = () => Bun.spawnSync(["bun", path.join(root, "scripts/i18n-check.ts")], { env: { ...process.env, KIWI_I18N_ROOT: dir, GITHUB_ACTIONS: "" } });
  expect(run().exitCode).toBe(0);
  const screen = path.join(dir, MIGRATED[0]!);
  writeFileSync(screen, readFileSync(screen, "utf8") + "\nexport const Extra = () => <p>Texto solto</p>;\n");
  const out = run();
  expect(out.exitCode).toBe(1);
  expect(out.stderr.toString()).toContain(`${MIGRATED[0]}:`);
  expect(out.stderr.toString()).toContain("Texto solto");
});
