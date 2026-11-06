import { describe, expect, test } from "bun:test";

import { lineChanges, lines, matches, merge3 } from "./merge3.ts";

/** O tamanho da subsequência comum mais longa, pela tabela (só para conferir o Myers em casos pequenos). */
function lcs(a: string[], b: string[]): number {
  const t = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) t[i]![j] = a[i] === b[j] ? t[i + 1]![j + 1]! + 1 : Math.max(t[i + 1]![j]!, t[i]![j + 1]!);
  return t[0]![0]!;
}

describe("o diff por linha (Myers)", () => {
  test("em 500 pares aleatórios, os pares são uma subsequência comum e a mais longa", () => {
    let seed = 170;
    const rand = (n: number) => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31) * n;
    for (let round = 0; round < 500; round++) {
      const a = Array.from({ length: Math.floor(rand(14)) }, () => "abcd"[Math.floor(rand(4))]!);
      const b = Array.from({ length: Math.floor(rand(14)) }, () => "abcd"[Math.floor(rand(4))]!);
      const pairs = matches(a, b);
      for (let k = 0; k < pairs.length; k++) {
        const [i, j] = pairs[k]!;
        expect(a[i]).toBe(b[j]!);
        if (k) {
          expect(i).toBeGreaterThan(pairs[k - 1]![0]);
          expect(j).toBeGreaterThan(pairs[k - 1]![1]);
        }
      }
      expect(pairs.length).toBe(lcs(a, b));
    }
  });

  test("as linhas guardam o \\n, e juntar devolve o texto byte a byte", () => {
    for (const t of ["", "a", "a\n", "a\nb", "a\r\nb\n\n"]) expect(lines(t).join("")).toBe(t);
  });
});

describe("merge3 (T5454)", () => {
  const base = "# Projeto\n\nIntro.\n\n## Tarefas\n- uma\n- duas\n\n## Notas\nfim\n";

  test("cada lado mudou um trecho diferente: entra tudo, sem conflito", () => {
    const mine = base.replace("Intro.", "Intro escrita no Kiwi.");
    const theirs = base.replace("- duas\n", "- duas\n- três (Obsidian)\n");
    expect(merge3(base, mine, theirs)).toEqual({
      clean: true,
      text: "# Projeto\n\nIntro escrita no Kiwi.\n\n## Tarefas\n- uma\n- duas\n- três (Obsidian)\n\n## Notas\nfim\n",
    });
  });

  test("só um lado mudou, ou os dois iguais: fica esse", () => {
    const edited = base.replace("fim", "fim!");
    expect(merge3(base, base, edited)).toEqual({ clean: true, text: edited });
    expect(merge3(base, edited, base)).toEqual({ clean: true, text: edited });
    expect(merge3(base, edited, edited)).toEqual({ clean: true, text: edited });
  });

  test("os dois mudaram o mesmo trecho diferente: só ele é conflito, o resto já está junto", () => {
    const mine = base.replace("Intro.", "Intro A.").replace("fim", "fim do Kiwi");
    const theirs = base.replace("Intro.", "Intro B.").replace("- uma", "- uma (de fora)");
    const r = merge3(base, mine, theirs);
    if (r.clean) throw new Error("devia ter conflito");
    expect(r.conflicts).toEqual([{ base: "Intro.\n", mine: "Intro A.\n", theirs: "Intro B.\n" }]);
    expect(r.resolve("mine")).toBe("# Projeto\n\nIntro A.\n\n## Tarefas\n- uma (de fora)\n- duas\n\n## Notas\nfim do Kiwi\n");
    expect(r.resolve("theirs")).toBe("# Projeto\n\nIntro B.\n\n## Tarefas\n- uma (de fora)\n- duas\n\n## Notas\nfim do Kiwi\n");
  });

  test("dois conflitos: escolhe um lado em cada", () => {
    const mine = base.replace("Intro.", "Intro A.").replace("fim", "fim A");
    const theirs = base.replace("Intro.", "Intro B.").replace("fim", "fim B");
    const r = merge3(base, mine, theirs);
    if (r.clean) throw new Error("devia ter conflito");
    expect(r.conflicts).toHaveLength(2);
    expect(r.resolve(["theirs", "mine"])).toBe(base.replace("Intro.", "Intro B.").replace("fim", "fim A"));
  });

  test("os dois acrescentaram no fim: conflito no fim, e as duas escolhas ficam inteiras", () => {
    const r = merge3("a\n", "a\nminha\n", "a\nde fora\n");
    if (r.clean) throw new Error("devia ter conflito");
    expect(r.conflicts).toEqual([{ base: "", mine: "minha\n", theirs: "de fora\n" }]);
    expect(r.resolve("theirs")).toBe("a\nde fora\n");
  });

  test("um apagou um trecho que o outro não tocou: sai", () => {
    const theirs = base.replace("## Notas\nfim\n", "");
    const mine = base.replace("Intro.", "Intro nova.");
    expect(merge3(base, mine, theirs)).toEqual({ clean: true, text: base.replace("Intro.", "Intro nova.").replace("## Notas\nfim\n", "") });
  });

  test("uma nota grande com edições nas pontas junta rápido", () => {
    const big = Array.from({ length: 20_000 }, (_, i) => `linha ${i}\n`).join("");
    const mine = `topo\n${big}`;
    const theirs = `${big}rodapé\n`;
    const t0 = performance.now();
    expect(merge3(big, mine, theirs)).toEqual({ clean: true, text: `topo\n${big}rodapé\n` });
    expect(performance.now() - t0).toBeLessThan(500);
  });
});

describe("lineChanges (o editor aplica o merge sem mexer no trecho de quem escreve)", () => {
  const apply = (before: string, ch: { from: number; to: number; insert: string }[]) => {
    let out = "";
    let at = 0;
    for (const c of ch) {
      out += before.slice(at, c.from) + c.insert;
      at = c.to;
    }
    return out + before.slice(at);
  };
  test("as trocas levam ao texto novo, e o meio intocado fica de fora delas", () => {
    const before = "topo\nmeio onde escrevo\nfim\n";
    const next = "topo novo\nmeio onde escrevo\nfim\nmais\n";
    const ch = lineChanges(before, next);
    expect(apply(before, ch)).toBe(next);
    const middle = before.indexOf("meio");
    expect(ch.every((c) => c.to <= middle || c.from >= middle + "meio onde escrevo\n".length)).toBe(true);
  });
  test("vazio, igual e tudo diferente", () => {
    for (const [a, b] of [["", "x\n"], ["x\n", ""], ["a\nb\n", "a\nb\n"], ["a\n", "b\n"]] as const) expect(apply(a, lineChanges(a, b))).toBe(b);
  });
});
