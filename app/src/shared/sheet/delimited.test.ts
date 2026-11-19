// T21107: csv e tsv gravados sem perda. Dados inventados (o estoque de uma loja).
import { describe, expect, test } from "bun:test";

import { DelimitedError, readDelimited, writeDelimited } from "./delimited.ts";

const utf8 = (s: string) => new TextEncoder().encode(s);
const roundTrip = (bytes: Uint8Array, name: string) => {
  const { rows, format } = readDelimited(bytes, name);
  return writeDelimited(rows, format);
};

describe("sem mudar nada, o arquivo sai igual, byte a byte", () => {
  const cases: [string, Uint8Array][] = [
    ["ponto e vírgula, CRLF, quebra no fim", utf8("Produto;Qtd;Preço\r\nCaneca;7;24,90\r\nRegador;5;31,00\r\n")],
    ["vírgula, LF, sem quebra no fim, aspas desnecessárias", utf8('Produto,Qtd\n"Caneca",7\n"Vaso, grande",2')],
    ["BOM e a linha sep=", utf8("﻿sep=;\r\nProduto;Qtd\r\nCaneca;7\r\n")],
    ["quebra dentro das aspas e aspas dobradas", utf8('Produto;Obs\n"Caneca";"azul\nfosca, ""nova"""\n')],
    ["tsv", utf8("Produto\tQtd\nCaneca\t7\n")],
    ["CR sozinho", utf8("Produto;Qtd\rCaneca;7\r")],
    ["windows-1252", Uint8Array.of(...utf8("Pre"), 0xe7, 0x6f, 0x3b, 0x51, 0x0a, 0x50, 0xe3, 0x6f, 0x3b, 0x33, 0x0a)],
  ];
  for (const [label, bytes] of cases) {
    test(label, () => {
      const name = label === "tsv" ? "estoque.tsv" : "estoque.csv";
      expect(roundTrip(bytes, name)).toEqual(bytes);
    });
  }
  test("utf-16 com BOM", () => {
    const text = "﻿Produto\tQtd\r\nCaneca\t7\r\n";
    const le = new Uint8Array(text.length * 2);
    for (let i = 0; i < text.length; i++) new DataView(le.buffer).setUint16(i * 2, text.charCodeAt(i), true);
    expect(roundTrip(le, "estoque.csv")).toEqual(le);
  });
});

describe("editado", () => {
  test("só a linha mudada é escrita de novo; as outras mantêm as aspas", () => {
    const bytes = utf8('Produto;Qtd\r\n"Caneca";7\r\n"Regador";5\r\n');
    const { rows, format } = readDelimited(bytes, "estoque.csv");
    expect(format.delimiter).toBe(";");
    expect(format.eol).toBe("\r\n");
    rows[2]![1] = "6";
    expect(new TextDecoder().decode(writeDelimited(rows, format))).toBe('Produto;Qtd\r\n"Caneca";7\r\nRegador;6\r\n');
  });

  test("linha inserida e apagada; o valor com separador, aspas ou quebra ganha aspas", () => {
    const { rows, format } = readDelimited(utf8("Produto,Qtd\nCaneca,7\nRegador,5\n"), "estoque.csv");
    rows.splice(1, 1);
    rows.push(['Vaso "M", grande', "2"], ["Prato\nfundo", " 3"]);
    expect(new TextDecoder().decode(writeDelimited(rows, format))).toBe('Produto,Qtd\nRegador,5\n"Vaso ""M"", grande",2\n"Prato\nfundo"," 3"\n');
  });

  test("a coluna nova vazia no fim não reescreve as linhas", () => {
    const { rows, format } = readDelimited(utf8("A;B\n1;2\n"), "x.csv");
    for (const r of rows) r.push("");
    expect(new TextDecoder().decode(writeDelimited(rows, format))).toBe("A;B\n1;2\n");
  });

  test("windows-1252 continua windows-1252; o que não cabe nele é recusado com o motivo", () => {
    const bytes = Uint8Array.of(0x50, 0xe3, 0x6f, 0x3b, 0x31, 0x0a);
    const { rows, format } = readDelimited(bytes, "x.csv");
    expect(format.encoding).toBe("windows-1252");
    expect(rows[0]![0]).toBe("Pão");
    rows[0]![1] = "2";
    expect(writeDelimited(rows, format)).toEqual(Uint8Array.of(0x50, 0xe3, 0x6f, 0x3b, 0x32, 0x0a));
    rows[0]![1] = "🐱";
    expect(() => writeDelimited(rows, format)).toThrow(DelimitedError);
  });
});
