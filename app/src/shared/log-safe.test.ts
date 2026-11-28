import { expect, test } from "bun:test";

import { errorKind, redactQuotedPaths } from "./log-safe.ts";

test("errorKind dá o tipo e o código, nunca a mensagem (#456)", () => {
  expect(errorKind(new Error("notes: Caixa de entrada/Comprar pão.md kept changing"))).toBe("Error");
  expect(errorKind(Object.assign(new Error("open '/x/Ana.md'"), { code: "ENOENT" }))).toBe("Error (ENOENT)");
  expect(errorKind(new TypeError("Ana"))).toBe("TypeError");
  expect(errorKind("Comprar pão")).toBe("string");
});

test("redactQuotedPaths troca só o caminho absoluto entre aspas", () => {
  expect(redactQuotedPaths(`ENOENT: no such file or directory, open '/tmp/Projeto X/Ana.md'`)).toBe(
    `ENOENT: no such file or directory, open '<caminho>'`,
  );
  expect(redactQuotedPaths(`rename '~/Notas/a.md' -> '~/Notas/b.md'`)).toBe(`rename '<caminho>' -> '<caminho>'`);
  expect(redactQuotedPaths(`path: "/a/b c.md", code: 'ENOENT'`)).toBe(`path: "<caminho>", code: 'ENOENT'`);
  expect(redactQuotedPaths("[ui:hub] showing UI 12 (built-in)")).toBe("[ui:hub] showing UI 12 (built-in)");
});

// #464: um nome com aspa seguida de vírgula (`x', y.md`) deixava o fim (`, y.md'`) no kiwi.log. O caminho vai até a
// última aspa que fecha, sem passar do ` -> ` do rename.
test("redactQuotedPaths esconde o nome inteiro, também com aspa e vírgula dentro (#464)", () => {
  expect(redactQuotedPaths(`ENOENT: no such file or directory, open '/tmp/Projeto X/x', y.md'`)).toBe(
    `ENOENT: no such file or directory, open '<caminho>'`,
  );
  expect(redactQuotedPaths(`path: '/a/Ana', b; c).md', errno: -2`)).toBe(`path: '<caminho>', errno: -2`);
  expect(redactQuotedPaths(`rename '~/Notas/a', b.md' -> '~/Notas/c', d.md'`)).toBe(`rename '<caminho>' -> '<caminho>'`);
  expect(redactQuotedPaths(`open "/x/um", dois.md"\nopen '/y/três.md'`)).toBe(`open "<caminho>"\nopen '<caminho>'`);
  // Nada do nome fica no log.
  for (const s of [`open '/tmp/x', y.md'`, `copyfile '~/a', b.md' -> '~/c', d.md'`]) {
    expect(redactQuotedPaths(s)).not.toMatch(/y\.md|b\.md|d\.md/);
  }
});

// T33931: o objeto curto numa linha só (o espaço antes do `}`), a lista curta e o caminho seguido de ` (` deixavam o
// caminho inteiro no log.
test("redactQuotedPaths esconde o caminho no objeto curto, na lista e antes do parêntese (T33931)", () => {
  expect(redactQuotedPaths(`{ path: '/tmp/Projeto X/Ana.md' }`)).toBe(`{ path: '<caminho>' }`);
  expect(redactQuotedPaths(`{ errno: -2, path: "~/Notas/Ana.md" }`)).toBe(`{ errno: -2, path: "<caminho>" }`);
  expect(redactQuotedPaths(`open '/tmp/Projeto X/Ana.md' (code ENOENT)`)).toBe(`open '<caminho>' (code ENOENT)`);
  expect(redactQuotedPaths(`rename '/a/Ana.md'\t(x) -> '/b/Ana.md' (y)`)).toBe(`rename '<caminho>'\t(x) -> '<caminho>' (y)`);
  // Na lista, os dois caminhos saem juntos: esconde a mais, nunca a menos.
  expect(redactQuotedPaths(`[ '/a/Ana.md', '/b/Projeto X.md' ]`)).toBe(`[ '<caminho>' ]`);
  for (const s of [`{ path: '/x/Ana.md' }`, `open '/x/Ana.md' (code)`, `[ '/x/a.md', '/x/Ana.md' ]`]) {
    expect(redactQuotedPaths(s)).not.toContain("Ana");
  }
  // O que não é caminho segue igual.
  expect(redactQuotedPaths(`{ code: 'ENOENT' } (x)`)).toBe(`{ code: 'ENOENT' } (x)`);
  expect(redactQuotedPaths(`a '/x'b (c)`)).toBe(`a '/x'b (c)`);
});

// O `redactQuotedPaths` lê a linha uma vez; a regex de referência é o que ele tem de dar, mas tenta cada aspa até o fim.
const REFERENCE = /(['"])(?:\/|~\/)(?:(?![ \t]+->[ \t]+['"](?:\/|~\/)).)*\1(?=[ \t]*(?:[,\]});]|$)|[ \t]+(?:->|\())/gm;

test("redactQuotedPaths dá o mesmo que a regex gulosa de referência, em 20 mil linhas sorteadas (T33931)", () => {
  const alphabet = ["'/", '"/', "'~/", "'", '"', "/", "~", " ", "\t", ",", " }", "]", ")", ";", " (", "(", " -> ", "->", "a", "\n", "\r\n", "\u2028"];
  // O mulberry32, com a semente fixa: as mesmas linhas a cada vez. Cerca de 4.400 delas t\u00eam um caminho, 400 t\u00eam mais de
  // um e 3.000 t\u00eam uma seta.
  let seed = 33931;
  const rand = (n: number) => {
    let t = (seed = (seed + 0x6d2b79f5) | 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) % n;
  };
  let hits = 0;
  for (let n = 0; n < 20_000; n++) {
    let s = "";
    for (let len = 1 + rand(40); len > 0; len--) s += alphabet[rand(alphabet.length)];
    const want = s.replace(REFERENCE, "$1<caminho>$1");
    if (want !== s) hits++;
    expect([s, redactQuotedPaths(s)]).toEqual([s, want]);
  }
  expect(hits).toBeGreaterThan(4000);
});

test("uma linha de 100 KB com 12.500 aspas de caminho sem fecho passa rápido (T33931)", () => {
  // A regex levava segundos aqui (cada aspa tentava até o fim da linha); a leitura de uma vez leva milissegundos.
  for (const line of ["'/".repeat(12_500) + "x".repeat(75_000), `"/x' `.repeat(20_000), "'/a -> ".repeat(14_000)]) {
    const t = performance.now();
    const out = redactQuotedPaths(line);
    expect(performance.now() - t).toBeLessThan(300);
    // Nenhuma aspa ali fecha um caminho: a linha sai igual.
    expect(out).toBe(line);
  }
});
