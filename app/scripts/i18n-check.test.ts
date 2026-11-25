import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

import { fixedTexts, MIGRATED } from "./i18n-check.ts";

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
