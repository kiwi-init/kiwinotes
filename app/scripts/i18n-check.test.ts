import { expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

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
