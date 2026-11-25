import { expect, test } from "bun:test";
import { cpSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

import { tempDir } from "../test/tmp.ts";
import { checkedFiles, fileTexts, fixedTexts, MAIN_DIRS, MAIN_FILES, mainFixedTexts, SWIFT_DIRS, swiftFixedTexts } from "./i18n-check.ts";

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

test("nenhum arquivo da tela e do main tem texto fixo (T30630)", () => {
  const root = path.resolve(import.meta.dir, "..");
  const files = checkedFiles(root);
  // Todo .tsx e .ts da UI, o src/bun e os de fora dele: os de antes das listas (o editor, os textos do agente) também.
  expect(files.length).toBeGreaterThan(250);
  for (const f of ["ui/notes/editor/slash.ts", "ui/settings/agentText.ts", "ui/notes/files/DrawioViewer.tsx", "src/bun/menus.ts", ...MAIN_FILES]) expect(files).toContain(f);
  expect(files.some((f) => f.includes(".test."))).toBe(false);
  for (const f of files) expect({ f, texts: fileTexts(f, readFileSync(path.join(root, f), "utf8")) }).toEqual({ f, texts: [] });
});

test("no .tsx, a frase com acento num ternário ou numa variável conta; o i18n-ok vale na linha e na de cima (T30630)", () => {
  const src = [
    "export const X = ({ big }: { big: boolean }) => {",
    '  const why = big ? "Grande demais" : "Não deu";',
    '  return <p title={`Prévia de ${why}`}>{why}</p>;',
    "};",
    "// i18n-ok: as palavras da busca",
    'const words = "máquina escrever";',
    'const solto = "sem acento fica fora";',
    'const id = "Reuniões"; // i18n-ok: o nome da pasta',
  ].join("\n");
  expect(fileTexts("x.tsx", src).map((t) => [t.line, t.text])).toEqual([[2, "Não deu"], [3, "Prévia de"]]);
  // A regra das tags sozinha não vê a frase da variável: era o buraco do check por lista.
  expect(fixedTexts("x.tsx", src).map((t) => t.text)).toEqual([]);
});

test("o i18n-ok-file no começo libera o arquivo com as duas línguas lado a lado; no meio, não (T30630)", () => {
  const body = 'export const S = { pt: { title: "Organizar uma nota" }, en: { title: "Organize a note" } };';
  expect(fileTexts("s.ts", body).map((t) => t.text)).toEqual(["Organizar uma nota", "Organize a note"]);
  expect(fileTexts("s.ts", `// O exemplo.\n// i18n-ok-file: pt e en lado a lado\n\n${body}`)).toEqual([]);
  expect(fileTexts("s.ts", `${body}\n// i18n-ok-file: tarde demais\n`).length).toBe(2);
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

test("o Swift do helper não tem texto fixo (T28192)", () => {
  const root = path.resolve(import.meta.dir, "..");
  const swift = (dir: string): string[] =>
    readdirSync(dir).flatMap((n) => (statSync(path.join(dir, n)).isDirectory() ? swift(path.join(dir, n)) : n.endsWith(".swift") ? [path.join(dir, n)] : []));
  const files = SWIFT_DIRS.flatMap((d) => swift(path.join(root, d)));
  expect(files.length).toBeGreaterThan(20);
  for (const f of files) expect({ f, texts: swiftFixedTexts(readFileSync(f, "utf8")) }).toEqual({ f, texts: [] });
});

test("um texto fixo em qualquer arquivo da tela, novo ou antigo, faz o check sair 1, e sem ele sai 0 (T30630)", () => {
  const root = path.resolve(import.meta.dir, "..");
  // A árvore falsa (`<tmp>/app` e `<tmp>/native`): as pastas que o check lê, copiadas.
  const dir = path.join(tempDir("i18n-check-"), "app");
  mkdirSync(dir);
  for (const d of ["ui", ...MAIN_DIRS]) cpSync(path.join(root, d), path.join(dir, d), { recursive: true, filter: (p) => !p.includes("node_modules") });
  for (const f of MAIN_FILES) cpSync(path.join(root, f), path.join(dir, f), { recursive: true });
  for (const d of SWIFT_DIRS) cpSync(path.join(root, d), path.join(dir, d), { recursive: true });
  const run = () => Bun.spawnSync(["bun", path.join(root, "scripts/i18n-check.ts")], { env: { ...process.env, KIWI_I18N_ROOT: dir, GITHUB_ACTIONS: "" } });
  expect(run().exitCode).toBe(0);
  // Uma tela nova, que nenhuma lista conhece, e um .ts da UI fora do editor.
  mkdirSync(path.join(dir, "ui/nova"));
  writeFileSync(path.join(dir, "ui/nova/Nova.tsx"), "export const Nova = () => <p>Texto solto</p>;\n");
  writeFileSync(path.join(dir, "ui/nova/texto.ts"), 'export const aviso = (n: number) => (n > 1 ? "Não deu" : "ok");\n');
  const out = run();
  expect(out.exitCode).toBe(1);
  expect(out.stderr.toString()).toContain("ui/nova/Nova.tsx:1");
  expect(out.stderr.toString()).toContain("Texto solto");
  expect(out.stderr.toString()).toContain("ui/nova/texto.ts:1");
  expect(out.stderr.toString()).toContain("Não deu");
});

test("a chave do catálogo não conta como texto (T29842)", () => {
  const src = 'const a = { label: "editor.menu.cut" };\nconst b = { label: "Recortar" };\nconst c = { label: "editor.naoExiste" };';
  expect(mainFixedTexts("x.ts", src).map((t) => t.text)).toEqual(["Recortar", "editor.naoExiste"]);
});
