// As Pendências da aba Início (T15875): notas falsas em memória, com conteúdo inventado.
import { expect, test } from "bun:test";

import type { NoteMeta } from "../notes/vault.ts";
import { PENDING_LIMITS } from "../shared/home.ts";
import type { HomeNotes } from "./home.ts";
import { homePending, openItems } from "./home-pending.ts";

const at = (d: number, h = 10) => new Date(2026, 10, d, h).toISOString();

function notes(files: Record<string, { content: string; mtime: string }>): HomeNotes & { read: string[] } {
  const read: string[] = [];
  const meta = (p: string): NoteMeta => {
    const parts = p.replace(/\.md$/, "").split("/");
    return { path: p, title: parts.at(-1)!, folder: parts.slice(0, -1).join("/"), mtime: files[p]!.mtime, ctime: files[p]!.mtime, size: 1, version: "v", tags: [] };
  };
  return {
    read,
    list: () => ({ notes: Object.keys(files).map(meta) }),
    get: async (p: string) => {
      read.push(p);
      if (!files[p]) throw new Error("sumiu");
      return { ...meta(p), content: files[p]!.content };
    },
    notesContaining: (text: string) => Object.keys(files).filter((p) => files[p]!.content.includes(text)).map(meta),
  };
}

const ATA = `---
reuniao: "[[Reuniões/Lançamento do site]]"
---

# Ata: Lançamento do site

## Resumo

- A página sai em dezembro.

## Próximos passos

- **Ana**: revisar o texto da [[Página nova|página]]
- [ ] Fechar o orçamento com o fornecedor
- [x] Confirmar a data com o time
`;

const MEETING = `---
type: meeting
date: "2026-11-17"
---

## Transcrição

- [ ] isto é fala, não pendência
`;

test("as caixas abertas das notas e os próximos passos da ata, por nota, da editada por último", async () => {
  const v = notes({
    "Casa/Mudança.md": { content: "# Mudança\n\n- [ ] Comprar fita e caixas\n- [x] Ligar para a transportadora\n  - [ ] Levar a geladeira no sábado\n", mtime: at(15) },
    "Atas/Lançamento do site.md": { content: ATA, mtime: at(17) },
    "Reuniões/Lançamento do site.md": { content: MEETING, mtime: at(17, 9) },
    "Ideias.md": { content: "Sem nada aberto.\n- [x] feito\n", mtime: at(16) },
  });
  const got = await homePending({ notes: v, meetings: v });
  expect(got.groups.map((g) => [g.path, g.origin])).toEqual([
    ["Atas/Lançamento do site.md", "meeting"],
    ["Casa/Mudança.md", "note"],
  ]);
  expect(got.groups[0]!.items.map((i) => i.text)).toEqual(["Ana: revisar o texto da página", "Fechar o orçamento com o fornecedor"]);
  expect(got.groups[1]!.items).toEqual([
    { text: "Comprar fita e caixas", line: 2 },
    { text: "Levar a geladeira no sábado", line: 4 },
  ]);
  expect(got.groups[1]!.folder).toBe("Casa");
  expect(got.total).toEqual({ meeting: 2, note: 2 });
  // A nota sem `[ ]` nem `reuniao:` nem é lida.
  expect(v.read).not.toContain("Ideias.md");
});

test("a ata e a nota da pasta das reuniões também entram, sem repetir a nota que está nas duas", async () => {
  const shared = { content: "- [ ] Revisar os números de março\n", mtime: at(14) };
  const open = notes({ "Projeto X.md": shared });
  const internal = notes({ "Projeto X.md": shared, "Atas/Planejamento.md": { content: ATA, mtime: at(16) } });
  const got = await homePending({ notes: open, meetings: internal });
  expect(got.groups.map((g) => [g.path, g.internal])).toEqual([["Atas/Planejamento.md", true], ["Projeto X.md", false]]);
});

test("fora: o frontmatter, os blocos de código, o [x] e, fora de uma ata, o tópico sem caixa", () => {
  const content = "---\ntodo: \"- [ ] no frontmatter\"\n---\n```\n- [ ] no código\n```\n## Próximos passos\n- tópico solto\n* [ ] com asterisco\n1. [ ] numerado\n- [ ]   \n";
  expect(openItems(content, false).map((i) => i.text)).toEqual(["com asterisco", "numerado"]);
  expect(openItems(content, true).map((i) => i.text)).toEqual(["tópico solto", "com asterisco", "numerado"]);
});

test("numa ata, a seção numerada e as Ações também contam; o tópico de outra seção, não", () => {
  const content = "## 1. Resumo\n- falamos do site\n## 2. Ações\n- Bruno manda a proposta\n### Próximos passos\n- Ana marca a próxima\n## 3. Riscos\n- prazo curto\n";
  expect(openItems(content, true).map((i) => i.text)).toEqual(["Bruno manda a proposta", "Ana marca a próxima"]);
});

test("cada nota mostra até o limite, e o resto vai no `more` e no total", async () => {
  const many = Array.from({ length: PENDING_LIMITS.itemsPerGroup + 3 }, (_, i) => `- [ ] item ${i + 1}`).join("\n");
  const got = await homePending({ notes: notes({ "Lista.md": { content: many, mtime: at(17) } }), meetings: notes({}) });
  expect(got.groups[0]!.items).toHaveLength(PENDING_LIMITS.itemsPerGroup);
  expect(got.groups[0]!.more).toBe(3);
  expect(got.total.note).toBe(PENDING_LIMITS.itemsPerGroup + 3);
});

test("pasta vazia: nenhuma pendência", async () => {
  const v = notes({});
  expect(await homePending({ notes: v, meetings: v })).toEqual({ groups: [], total: { meeting: 0, note: 0 } });
});

test("T16434: o comentário %%…%% sai do item, e uma caixa dentro de um comentário não conta", () => {
  expect(openItems("- [ ] Ligar para a Ana %%interno%%\n%%\n- [ ] escondida\n%%\n- [ ] Comprar pão", false)).toEqual([
    { text: "Ligar para a Ana", line: 0 },
    { text: "Comprar pão", line: 4 },
  ]);
  // Um item que só tem o comentário não vira pendência vazia.
  expect(openItems("- [ ] %%só isso%%", false)).toEqual([]);
});

test("T16434: a cerca de 4 crases não fecha numa linha de 3 dentro dela", () => {
  expect(openItems("````\n```\n- [ ] dentro\n````\n- [ ] fora", false).map((i) => i.text)).toEqual(["fora"]);
  expect(openItems("~~~~\n~~~\n- [ ] dentro\n~~~~\n- [ ] fora", false).map((i) => i.text)).toEqual(["fora"]);
});

test("T16434: a caixa dentro de uma citação ou de um callout conta", () => {
  expect(openItems("> - [ ] na citação\n> [!note] Lembrete\n> - [ ] no callout\n>> - [x] feita", false).map((i) => i.text)).toEqual(["na citação", "no callout"]);
});

test("T16434: um sub-título dentro de Próximos passos não fecha a seção; o título do mesmo nível fecha", () => {
  const ata = "## Próximos passos\n\n- Ana revisa\n\n### Detalhes\n\n- Bruno manda o orçamento\n\n## Notas\n\n- não é passo";
  expect(openItems(ata, true).map((i) => i.text)).toEqual(["Ana revisa", "Bruno manda o orçamento"]);
});
