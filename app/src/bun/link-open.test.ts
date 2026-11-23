// O `window.open` das janelas (T25095): a lista fixa, a URL que já estava no disco, a pergunta e o "salvar e depois
// abrir" (#25262). Tudo com o navegador e a pergunta falsos: nada abre na tela.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { Vault } from "../notes/vault.ts";
import { createLinkOpener, hasExactUrl, type LinkOpenerOptions, linkUrl, newWindowUrl, urlOnDiskBefore } from "./link-open.ts";

const FIXED = "https://exemplo.com/releases/tag/v2026.1.1";
const OLD = "https://exemplo.com/artigo-antigo";

let root: string;
let since: number;

/** Um arquivo "de antes": o mtime fica no passado, antes do início da sessão falsa. */
function before(rel: string, text: string): void {
  const p = path.join(root, rel);
  mkdirSync(path.dirname(p), { recursive: true });
  writeFileSync(p, text);
  const past = new Date(since - 60_000);
  utimesSync(p, past, past);
}

beforeAll(() => {
  root = mkdtempSync(path.join(tmpdir(), "kiwi-links-"));
  since = Date.now();
  before("Projeto X/leituras.md", `# Leituras\n\n- [um artigo](${OLD})\n`);
  before(".escondida/nota.md", "https://exemplo.com/escondido\n");
  before("planilha.xlsx", "https://exemplo.com/binario\n");
  // As do "salvar e depois abrir", fora das que os outros testes leem.
  before("Projeto Y/diario.md", "# Diário\n\nhttps://exemplo.com/diario-antigo\n");
  // Acima do limite de 5 MB: a URL está lá, mas o arquivo não é lido.
  before("Projeto X/enorme.md", `${"a ".repeat(3 * 1024 * 1024)}\nhttps://exemplo.com/no-enorme\n`);
});
afterAll(() => rmSync(root, { recursive: true, force: true }));

function harness(o: Partial<LinkOpenerOptions> & { answer?: boolean } = {}) {
  const opened: string[] = [];
  const asked: string[] = [];
  const logs: string[] = [];
  const opener = createLinkOpener({
    fixed: () => [FIXED],
    onDiskBefore: (url) => urlOnDiskBefore(url, [root], since),
    confirm: async (url) => {
      asked.push(url);
      return o.answer ?? false;
    },
    open: (url) => opened.push(url),
    log: (m) => logs.push(m),
    ...o,
  });
  return { opener, opened, asked, logs };
}

describe("linkUrl", () => {
  test("só http, https e mailto, sem usuário na URL nem tamanho de arquivo", () => {
    expect(linkUrl("https://exemplo.com/a")).toBe("https://exemplo.com/a");
    expect(linkUrl("http://exemplo.com/")).toBe("http://exemplo.com/");
    expect(linkUrl("mailto:ana@exemplo.com")).toBe("mailto:ana@exemplo.com");
    for (const bad of [
      "file:///etc/hosts",
      "javascript:alert(1)",
      "views://internal/index.html",
      "x-apple.systempreferences:com.apple.preference.security",
      "https://ana@exemplo.com/",
      "nao é url",
      "",
      42,
      null,
      `https://exemplo.com/?q=${"a".repeat(5_000)}`,
    ])
      expect(linkUrl(bad)).toBeNull();
  });

  test("o detail do new-window-open vem como texto ou como { url }", () => {
    expect(newWindowUrl("https://exemplo.com/")).toBe("https://exemplo.com/");
    expect(newWindowUrl({ url: "https://exemplo.com/", isCmdClick: false })).toBe("https://exemplo.com/");
    expect(newWindowUrl({ outra: 1 })).toBeNull();
    expect(newWindowUrl(undefined)).toBeNull();
  });
});

test("hasExactUrl: a URL inteira, com borda dos dois lados", () => {
  const url = "https://exemplo.com/a";
  for (const ok of [url, `[x](${url})`, `<${url}>`, `"${url}"`, `ver ${url} e`, `\`${url}\``, `${url}\n`]) expect(hasExactUrl(ok, url)).toBe(true);
  for (const bad of [`${url}bc`, `${url}/b`, `${url}?d=1`, `${url}#x`, `x${url}`, "https://exemplo.com/", ""]) expect(hasExactUrl(bad, url)).toBe(false);
  // Uma ocorrência sem borda não esconde a boa depois dela.
  expect(hasExactUrl(`${url}bc ${url}`, url)).toBe(true);
});

describe("o opener", () => {
  test("a lista fixa abre direto, sem pergunta", async () => {
    const h = harness();
    expect(await h.opener.request(FIXED)).toBe("fixed");
    expect(h.opened).toEqual([FIXED]);
    expect(h.asked).toEqual([]);
  });

  test("a URL exata que já estava numa nota antes da sessão abre direto", async () => {
    const h = harness();
    expect(await h.opener.request(OLD)).toBe("on-disk");
    expect(h.opened).toEqual([OLD]);
    expect(h.asked).toEqual([]);
  });

  test("um pedaço ou uma URL montada a partir da da nota não vale: pergunta", async () => {
    const h = harness();
    for (const url of [`${OLD}?d=dados-da-nota`, "https://exemplo.com/artigo", `${OLD}#x`]) expect(await h.opener.request(url)).toBe("declined");
    expect(h.asked).toEqual([`${OLD}?d=dados-da-nota`, "https://exemplo.com/artigo", `${OLD}#x`]);
    expect(h.opened).toEqual([]);
  });

  test("pasta oculta e arquivo que não é texto não contam", async () => {
    const h = harness();
    expect(await h.opener.request("https://exemplo.com/escondido")).toBe("declined");
    expect(await h.opener.request("https://exemplo.com/binario")).toBe("declined");
    expect(h.opened).toEqual([]);
  });

  test("um arquivo acima de 5 MB não conta, mesmo com a URL", async () => {
    const h = harness();
    expect(await h.opener.request("https://exemplo.com/no-enorme")).toBe("declined");
    expect(h.opened).toEqual([]);
  });

  test("a busca no disco vai uma vez por URL: o segundo clique não lê a pasta de novo (#25817)", async () => {
    let reads = 0;
    let fail = true;
    const h = harness({
      onDiskBefore: async (url) => {
        reads++;
        if (url.endsWith("/erro") && fail) throw new Error("disco");
        return urlOnDiskBefore(url, [root], since);
      },
    });
    // O "sim" fica guardado.
    expect(await h.opener.request(OLD)).toBe("on-disk");
    expect(await h.opener.request(OLD)).toBe("on-disk");
    expect(reads).toBe(1);
    // O "não" também: a pergunta volta, a busca não.
    expect(await h.opener.request("https://exemplo.com/fora")).toBe("declined");
    expect(await h.opener.request("https://exemplo.com/fora")).toBe("declined");
    expect(reads).toBe(2);
    expect(h.asked).toEqual(["https://exemplo.com/fora", "https://exemplo.com/fora"]);
    // O erro não fica: o clique seguinte busca de novo.
    expect(await h.opener.request("https://exemplo.com/erro")).toBe("declined");
    fail = false;
    expect(await h.opener.request("https://exemplo.com/erro")).toBe("declined");
    expect(reads).toBe(4);
  });

  test("a URL fora de tudo não é recusada em silêncio: a pergunta mostra a URL", async () => {
    const url = "https://exemplo.com/nova";
    const nao = harness({ answer: false });
    expect(await nao.opener.request(url)).toBe("declined");
    expect(nao.asked).toEqual([url]);
    expect(nao.opened).toEqual([]);

    const sim = harness({ answer: true });
    expect(await sim.opener.request(url)).toBe("confirmed");
    expect(sim.opened).toEqual([url]);
    // O "Abrir" vale até o app fechar: o segundo clique não pergunta de novo.
    expect(await sim.opener.request(url)).toBe("allowed");
    expect(sim.asked).toEqual([url]);
    expect(sim.opened).toEqual([url, url]);
  });

  test("outro esquema nem pergunta", async () => {
    const h = harness({ answer: true });
    for (const url of ["file:///etc/hosts", "javascript:void 0", "views://internal/x"]) expect(await h.opener.request(url)).toBe("refused");
    expect(h.asked).toEqual([]);
    expect(h.opened).toEqual([]);
  });

  test("salvar e depois abrir: a URL que entrou por um save desta sessão vai para a pergunta (#25262)", async () => {
    const vault = new Vault({ root, trash: async () => {} });
    await vault.open();
    try {
      const leak = "https://exemplo.com/coleta?d=texto-da-nota";
      // A UI grava a URL numa nota nova e numa nota que já existia, e depois pede para abrir.
      await vault.create("Caixa de entrada", "nova", `[clique](${leak})\n`);
      const antiga = await vault.get("Projeto Y/diario.md");
      await vault.save("Projeto Y/diario.md", `${antiga.content}- [outro](${leak}&e=2)\n`, antiga.version);

      const h = harness();
      expect(await h.opener.request(leak)).toBe("declined");
      expect(await h.opener.request(`${leak}&e=2`)).toBe("declined");
      // O link que já estava no diário também pergunta: o arquivo mudou nesta sessão, e a busca não sabe o que
      // havia antes do save (mais estrito que a regra do #25265; ver o PR).
      expect(await h.opener.request("https://exemplo.com/diario-antigo")).toBe("declined");
      expect(h.asked).toEqual([leak, `${leak}&e=2`, "https://exemplo.com/diario-antigo"]);
      expect(h.opened).toEqual([]);
    } finally {
      vault.close();
    }
  });

  test("o log leva só a decisão, nunca a URL", async () => {
    const h = harness();
    await h.opener.request(OLD);
    await h.opener.request("https://exemplo.com/outra");
    expect(h.logs).toEqual(["window.open: on-disk", "window.open: declined"]);
  });

  test("dois cliques seguidos: uma pergunta por vez", async () => {
    let open = 0;
    let max = 0;
    const h = harness({
      confirm: async () => {
        max = Math.max(max, ++open);
        await Bun.sleep(20);
        open--;
        return false;
      },
    });
    await Promise.all([h.opener.request("https://exemplo.com/1"), h.opener.request("https://exemplo.com/2")]);
    expect(max).toBe(1);
  });

  test("um erro na busca ou na pergunta não abre nada", async () => {
    const h = harness({
      onDiskBefore: async () => {
        throw new Error("disco");
      },
      confirm: async () => {
        throw new Error("janela");
      },
    });
    expect(await h.opener.request("https://exemplo.com/x")).toBe("declined");
    expect(h.opened).toEqual([]);
  });
});

describe("a ligação nas janelas", () => {
  // O app não roda nos testes: a leitura do `windows.ts` prende que toda janela entrega o `new-window-open` ao opener,
  // e que nada fora dele chama o `openExternal`.
  const src = readFileSync(path.join(import.meta.dir, "windows.ts"), "utf8");
  test("o new-window-open de cada janela vai ao linkOpener", () => {
    expect(src).toMatch(/^[ \t]*onView\("new-window-open",\s*\(e\)\s*=>\s*void linkOpener\.request\(newWindowUrl\(e\.data\?\.detail\)\)\)/m);
  });
  test("o openExternal só no open do opener, e nunca com o KIWI_DEBUG", () => {
    const calls = src.match(/Utils\.openExternal\(/g) ?? [];
    expect(calls.length).toBe(1);
    expect(src).toMatch(/open: \(url\) => \{\n\s*if \(process\.env\.KIWI_DEBUG !== "1"\) Utils\.openExternal\(url\);/);
  });
});
