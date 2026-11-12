// O `cli screenshot` e o `cli ui --script` (T1742). As flags e os passos são lógica pura; o resto abre o WebKit
// headless do Playwright (fora da tela) contra um engine de mentira, e pula se o WebKit não estiver instalado
// (`bunx playwright-core install webkit`).

import { afterAll, afterEach, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { webkit } from "playwright-core";

import { parseArgs, runScreenshot, runUi } from "./cli-ui.ts";
import { buildStamp, noteProblem, type UiContext } from "./ui-page.ts";
import { parseScript, runStep } from "./ui-steps.ts";

describe("flags", () => {
  test("janela, escalas e temas em lista, tamanho, nota; o --data é da CLI", () => {
    const a = parseArgs(["notes", "--data", "/tmp/x", "--scale", "1,2", "--theme", "dark", "--size", "900x600", "--note", "Pessoas/Ana.md", "--query", "a=b=c"]);
    expect(a.window).toBe("notes");
    expect(a.scales).toEqual([1, 2]);
    expect(a.themes).toEqual(["dark"]);
    expect(a.size).toEqual({ width: 900, height: 600 });
    expect(a.query).toEqual({ note: "Pessoas/Ana.md", a: "b=c" });
    expect(a.browser).toBe("webkit");
    expect(a.motion).toBe(false);
  });

  test("uso errado diz o quê", () => {
    expect(() => parseArgs(["janela"])).toThrow("não é uma janela");
    expect(() => parseArgs(["notes", "--scale", "3"])).toThrow("--scale: 3");
    expect(() => parseArgs(["notes", "--size", "grande"])).toThrow("LARGURAxALTURA");
    expect(() => parseArgs(["notes", "--size", "100x100"])).toThrow("de 200 a 4000");
    expect(() => parseArgs(["notes", "--theme"])).toThrow("precisa de um valor");
    expect(() => parseArgs(["notes", "--zoom", "2"])).toThrow("flag desconhecida");
    expect(() => parseArgs(["notes", "history"])).toThrow("sobrou");
  });
});

describe("passos", () => {
  test("aceita a lista sozinha ou o objeto com as opções", () => {
    expect(parseScript([{ press: "Meta+k" }]).steps).toHaveLength(1);
    const f = parseScript({ window: "notes", scale: 1, theme: "dark", query: { note: "a.md" }, steps: [{ click: ".x", modifiers: ["Meta"] }, { wait: 10 }] });
    expect(f.window).toBe("notes");
  });

  test("recusa o passo torto, dizendo qual", () => {
    expect(() => parseScript([])).toThrow("não tem passos");
    expect(() => parseScript([{ click: ".a", press: "x" }])).toThrow("passo 1: uma ação só");
    expect(() => parseScript([{ wait: 1 }, { nada: 1 }])).toThrow("passo 2");
    expect(() => parseScript([{ wait: 99_999 }])).toThrow("wait em ms");
    expect(() => parseScript([{ fill: ".a" }])).toThrow("fill precisa de text");
    expect(() => parseScript([{ expectCount: ".a" }])).toThrow("count");
    expect(() => parseScript([{ click: ".a", modifiers: ["Hyper"] }])).toThrow("modifiers");
    expect(() => parseScript([{ click: ".a", button: "middle" }])).toThrow("button");
    expect(() => parseScript([{ click: ".a", position: { x: -1, y: 0 } }])).toThrow("position");
    expect(() => parseScript([{ waitFor: ".a", state: "sumido" }])).toThrow("state");
    expect(() => parseScript([{ click: ".a", timeout: 0 }])).toThrow("timeout");
    expect(() => parseScript([{ type: "abc", maxMs: 0 }])).toThrow("maxMs");
    expect(() => parseScript([{ type: "abc", maxMs: 1.5 }])).toThrow("maxMs");
    expect(parseScript([{ type: "abc", maxMs: 1500 }]).steps[0]).toEqual({ type: "abc", maxMs: 1500 });
    expect(() => parseScript({ scale: 3, steps: [{ wait: 1 }] })).toThrow("scale");
    expect(() => parseScript([{ scroll: ".a" }])).toThrow("scroll precisa de y ou x");
    expect(() => parseScript([{ scroll: ".a", y: "muito" }])).toThrow("scroll.y");
    expect(parseScript([{ scroll: ".a", y: 400 }]).steps).toHaveLength(1);
    expect(() => parseScript([{ expectScroll: ".a" }])).toThrow("min ou max");
    expect(() => parseScript([{ expectScroll: ".a", min: "x" }])).toThrow("expectScroll.min");
    // T5299: o scroll de lado, o arrastar e a largura.
    expect(parseScript([{ expectNoHScroll: ".kn-notes", allow: "pre" }, { drag: ".h", x: 120 }, { expectWidth: ".p", min: 1 }]).steps).toHaveLength(3);
    expect(() => parseScript([{ expectNoHScroll: ".a", allow: 3 }])).toThrow("allow");
    expect(() => parseScript([{ drag: ".h" }])).toThrow("drag precisa de x");
    expect(() => parseScript([{ drag: ".h", x: 1e9 }])).toThrow("drag.x");
    expect(() => parseScript([{ expectWidth: ".p" }])).toThrow("min ou max");
    expect(() => parseScript([{ expectSame: ".a" }])).toThrow("as: precisa de um texto");
    expect(() => parseScript([{ expectSame: ".a", as: "" }])).toThrow("as: precisa de um texto");
    expect(() => parseScript([{ expectSame: ".a", as: ".b", tolerance: -1 }])).toThrow("tolerance");
    expect(parseScript([{ expectSame: ".a", as: ".b" }]).steps).toHaveLength(1);
    expect(parseScript([{ expectSame: ".a", as: ".b", property: "color", tolerance: 2 }]).steps).toHaveLength(1);
  });

  test("o print é só um nome .png: nada de escrever fora da pasta de saída", () => {
    expect(() => parseScript([{ screenshot: "../fora.png" }])).toThrow("sem pasta");
    expect(() => parseScript([{ screenshot: "/tmp/x.png" }])).toThrow("sem pasta");
    expect(() => parseScript([{ screenshot: "x.jpg" }])).toThrow(".png");
  });

  test("nenhum passo escreve no clipboard", () => {
    expect(() => parseScript([{ invoke: "clipboard.write", args: { text: "x" } }])).toThrow("clipboard");
  });
});

describe("o --note confere o caminho exato, como a janela (#1864)", () => {
  const list = { ok: true, value: { folders: ["Projetos"], notes: [{ path: "Projetos/Projeto X.md" }, { path: "Ana.md" }] } };
  test("exato passa; maiúsculas trocadas dizem o caminho certo; o que não existe dá E_NOT_FOUND", () => {
    expect(noteProblem("Projetos/Projeto X.md", list)).toBeNull();
    expect(noteProblem("projetos/projeto x.md", list)).toBe("--note projetos/projeto x.md: a nota não abriu (existe como Projetos/Projeto X.md; o caminho é exato)");
    expect(noteProblem("Nada.md", list)).toBe("--note Nada.md: a nota não abriu (E_NOT_FOUND)");
    // Um arquivo que não é nota também abre (o view de arquivo, T7103).
    const withFiles = { ok: true, value: { notes: [], files: [{ path: "Anexos/contrato.pdf" }] } };
    expect(noteProblem("Anexos/contrato.pdf", withFiles)).toBeNull();
    expect(noteProblem("Anexos/outro.pdf", withFiles)).toBe("--note Anexos/outro.pdf: a nota não abriu (E_NOT_FOUND)");
    expect(noteProblem("Ana.md", { ok: false, code: "E_IO" })).toContain("notes.list: E_IO");
  });
});

describe("o carimbo do build (#1835)", () => {
  test("muda quando um arquivo muda, entra ou sai; teste não conta", () => {
    const root = mkdtempSync(join(tmpdir(), "kn-stamp-"));
    try {
      mkdirSync(join(root, "ui"));
      writeFileSync(join(root, "ui/a.ts"), "a");
      writeFileSync(join(root, "ui/b.ts"), "b");
      writeFileSync(join(root, "bun.lock"), "v1");
      const stamp = () => buildStamp([join(root, "ui"), join(root, "bun.lock")], root);
      const s0 = stamp();
      expect(stamp()).toBe(s0);
      // Apagar o arquivo mais velho não mexe no mtime mais novo: o carimbo antigo não via isto.
      utimesSync(join(root, "ui/a.ts"), new Date(1000), new Date(1000));
      const s1 = stamp();
      rmSync(join(root, "ui/a.ts"));
      expect(stamp()).not.toBe(s1);
      const s2 = stamp();
      writeFileSync(join(root, "ui/c.ts"), "c");
      expect(stamp()).not.toBe(s2);
      const s3 = stamp();
      writeFileSync(join(root, "bun.lock"), "v2 com outra dependência");
      expect(stamp()).not.toBe(s3);
      const s4 = stamp();
      writeFileSync(join(root, "ui/c.test.ts"), "teste");
      expect(stamp()).toBe(s4);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("invoke num roteiro (#1835)", () => {
  function vault() {
    let note = { path: "a.md", content: "um", version: "v1" };
    const calls: Record<string, unknown>[] = [];
    const send = async (msg: Record<string, unknown>) => {
      calls.push(msg);
      const args = msg.args as Record<string, string>;
      if (msg.cap === "notes.get") return args.path === note.path ? { ok: true, value: note } : { ok: false, code: "E_NOT_FOUND", message: args.path };
      if (msg.cap === "notes.save") {
        if (args.baseVersion !== note.version) return { ok: true, value: { saved: false, current: note } };
        note = { ...note, content: args.content!, version: `v${Number(note.version.slice(1)) + 1}` };
        return { ok: true, value: { saved: true, meta: note } };
      }
      return { ok: false, code: "E_NO_CAPABILITY", message: String(msg.cap) };
    };
    return { send, calls, note: () => note };
  }
  const page = null as unknown as import("playwright-core").Page; // o invoke não usa a página

  test("baseVersion \"current\" lê a versão de agora e grava", async () => {
    const v = vault();
    await runStep(page, { invoke: "notes.save", args: { path: "a.md", content: "dois", baseVersion: "current" } }, dir, v.send);
    expect(v.note().content).toBe("dois");
    expect(v.calls.map((c) => c.cap)).toEqual(["notes.get", "notes.save"]);
    expect((v.calls[1]!.args as Record<string, string>).baseVersion).toBe("v1");
  });

  test("um save que não grava (versão velha) faz o passo falhar", async () => {
    const v = vault();
    await expect(runStep(page, { invoke: "notes.save", args: { path: "a.md", content: "x", baseVersion: "v0" } }, dir, v.send)).rejects.toThrow("não gravou");
  });

  test("current de uma nota que não existe diz qual", async () => {
    const v = vault();
    await expect(runStep(page, { invoke: "notes.save", args: { path: "b.md", content: "x", baseVersion: "current" } }, dir, v.send)).rejects.toThrow("E_NOT_FOUND");
  });
});

// ---------------------------------------------------------------- no navegador

const hasWebkit = (() => {
  try {
    return existsSync(webkit.executablePath());
  } catch {
    return false;
  }
})();

/** Um engine de mentira: as capacidades na memória, cada pedido anotado, e eventos que o teste solta. */
function fakeCtx(data: string, running = true) {
  const sent: Record<string, unknown>[] = [];
  const listeners = new Set<(m: Record<string, unknown>) => void>();
  const caps: Record<string, (args: any) => unknown> = {
    "settings.get": () => ({ notesShortcut: "control+option+n" }),
    "dictionary.get": () => [],
    "snippets.get": () => [],
    "history.search": () => ({
      entries: [{ id: "2026-11-03T12:00:00.000Z-ab12", at: "2026-11-03T12:00:00.000Z", raw: "oi ana", text: "Oi, Ana.", app: { name: "Notas" } }],
    }),
    "notes.list": () => ({ folders: [], notes: [] }),
  };
  const ctx: UiContext = {
    data,
    send: async (msg) => {
      sent.push(msg);
      if (!running) throw Object.assign(new Error("no headless"), { code: "E_NOT_RUNNING" });
      if (msg.cmd === "status") return { ok: true, value: { helper: "off" } };
      const fn = caps[msg.cap as string];
      if (!fn) return { ok: false, code: "E_NO_CAPABILITY", message: String(msg.cap) };
      return { ok: true, value: fn(msg.args) };
    },
    subscribe: async (_topics, onMsg) => {
      listeners.add(onMsg);
      return () => listeners.delete(onMsg);
    },
  };
  return { ctx, sent, emit: (event: string, payload: unknown) => listeners.forEach((l) => l({ event, payload })) };
}

let dir = "";
let logs: string[] = [];
let spy: ReturnType<typeof spyOn> | undefined;
const lastJson = () => JSON.parse(logs.at(-1)!);

function capture() {
  logs = [];
  spy = spyOn(console, "log").mockImplementation((m: unknown) => void logs.push(String(m)));
}

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "kn-cli-ui-"));
});
// Os prints e as páginas de teste não ficam no $TMPDIR depois do `bun test` (T1958).
afterAll(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});
afterEach(() => {
  spy?.mockRestore();
  spy = undefined;
});

describe("sem o headless", () => {
  test("screenshot e ui saem com 3 e dizem como subir", async () => {
    const { ctx } = fakeCtx(dir, false);
    capture();
    expect(await runScreenshot(["settings"], ctx)).toBe(3);
    expect(lastJson().code).toBe("E_NOT_RUNNING");
    expect(lastJson().message).toContain("bun run cli start");
    writeFileSync(join(dir, "p.json"), JSON.stringify([{ wait: 1 }]));
    expect(await runUi(["settings", "--script", join(dir, "p.json")], ctx)).toBe(3);
  });

  test("uso errado sai com 2 antes de procurar o headless", async () => {
    const { ctx, sent } = fakeCtx(dir, false);
    capture();
    expect(await runScreenshot([], ctx)).toBe(2);
    expect(await runUi(["notes"], ctx)).toBe(2);
    expect(sent).toEqual([]);
  });
});

describe.skipIf(!hasWebkit)("no WebKit headless", () => {
  test("screenshot: o build de verdade com a CSP, em 1x e 2x, no tamanho da janela", async () => {
    const { ctx } = fakeCtx(dir);
    capture();
    const code = await runScreenshot(["settings", "--scale", "1,2", "--theme", "dark", "--out", join(dir, "shots")], ctx);
    const r = lastJson();
    expect(r.problems ?? r.shots.flatMap((s: any) => s.problems)).toEqual([]);
    expect(code).toBe(0);
    expect(r.shots.map((s: any) => [s.scale, s.theme, s.ready])).toEqual([
      [1, "dark", true],
      [2, "dark", true],
    ]);
    // O PNG tem o tamanho da janela vezes a escala (largura nos bytes 16..19 do IHDR).
    const width = (p: string) => readFileSync(p).readUInt32BE(16);
    expect(width(r.shots[0].path)).toBe(640);
    expect(width(r.shots[1].path)).toBe(1280);
  }, 60_000);

  test("ui: o copiar do Histórico não chega ao engine nem ao clipboard; fica no relatório", async () => {
    const { ctx, sent } = fakeCtx(dir);
    writeFileSync(
      join(dir, "copiar.json"),
      JSON.stringify({ window: "history", steps: [{ waitFor: "text=Oi, Ana." }, { click: "[aria-label='Copiar o texto']" }, { wait: 100 }, { screenshot: "h.png" }] }),
    );
    capture();
    const code = await runUi(["--script", join(dir, "copiar.json"), "--out", join(dir, "ui")], ctx);
    const r = lastJson();
    expect(r.steps.filter((s: any) => !s.ok)).toEqual([]);
    expect(code).toBe(0);
    expect(r.clipboard).toEqual(["Oi, Ana."]);
    expect(sent.some((m) => m.cap === "clipboard.write")).toBe(false);
    expect(existsSync(join(dir, "ui/h.png"))).toBe(true);
  }, 60_000);

  test("ui: um passo que falha para o script, diz qual e deixa o print do momento", async () => {
    const { ctx } = fakeCtx(dir);
    writeFileSync(join(dir, "falha.json"), JSON.stringify([{ waitFor: ".kn-segmented" }, { click: ".nao-existe", timeout: 300 }, { wait: 1 }]));
    capture();
    expect(await runUi(["settings", "--script", join(dir, "falha.json"), "--out", join(dir, "falha")], ctx)).toBe(1);
    const r = lastJson();
    expect(r.failedAt).toBe(2);
    expect(r.skipped).toBe(1);
    expect(existsSync(r.steps[1].shot)).toBe(true);
  }, 60_000);

  test("ui: um passo mais lento que o maxMs falha, com o tempo e o limite (T7390)", async () => {
    const { ctx } = fakeCtx(dir);
    writeFileSync(join(dir, "lento.json"), JSON.stringify([{ waitFor: ".kn-segmented" }, { wait: 1, maxMs: 2000 }, { wait: 300, maxMs: 50 }]));
    capture();
    expect(await runUi(["settings", "--script", join(dir, "lento.json"), "--out", join(dir, "lento")], ctx)).toBe(1);
    const r = lastJson();
    expect(r.steps[1].ok).toBe(true);
    expect(r.failedAt).toBe(3);
    expect(r.steps[2].error).toMatch(/levou \d+ ms, e o limite \(maxMs\) é 50 ms/);
  }, 60_000);

  test("clickText: clica no meio de um texto dentro de um parágrafo só, sem um elemento por linha (T7843)", async () => {
    const browser = await webkit.launch();
    try {
      const page = await browser.newPage();
      // Como o editor desenha um parágrafo de várias linhas: um <p> com o texto todo, sem um elemento por linha.
      await page.setContent(`<p id="p" style="width: 300px; font: 16px sans-serif">Linha 1 do teste aaa aaa aaa.
        Linha 2 do teste bbb bbb bbb. Linha 3 do teste ccc ccc ccc.</p><script>
        document.addEventListener("click", (e) => {
          const r = document.caretRangeFromPoint(e.clientX, e.clientY);
          window.hit = r ? r.startContainer.nodeValue.slice(0, r.startOffset) : null;
        });</script>`);
      const send = async () => ({});
      expect(parseScript([{ clickText: "Linha 2", within: "#p" }]).steps[0]).toEqual({ clickText: "Linha 2", within: "#p" });
      expect(() => parseScript([{ clickText: "" }])).toThrow("passo 1.clickText");
      await runStep(page, { clickText: "Linha 2 do teste", within: "#p" }, dir, send);
      // O caret caiu dentro do "Linha 2 do teste": o texto antes dele termina num pedaço da Linha 2.
      const before = (await page.evaluate(() => (window as unknown as { hit: string | null }).hit)) ?? "";
      expect(before).toContain("Linha 1 do teste aaa aaa aaa.");
      // O meio de "Linha 2 do teste" é o "d": o caret fica antes ou depois dele, mesmo com o texto quebrando de linha.
      expect(before).toMatch(/Linha 2 d?$/);
      try {
        await runStep(page, { clickText: "Linha 9", within: "#p", timeout: 200 }, dir, send);
        throw new Error("esperava falhar");
      } catch (e) {
        expect(String(e)).toContain('clickText: "Linha 9" não apareceu em #p');
      }
    } finally {
      await browser.close();
    }
  }, 60_000);

  test("expectSame: o retângulo de um elemento contra o de outro, e a propriedade computada (T4671)", async () => {
    const browser = await webkit.launch();
    try {
      const page = await browser.newPage();
      await page.setContent(`<style>
        i { position: absolute; width: 40px; height: 20px; }
        #a { left: 10px; top: 4px; }
        #b { left: 11px; top: 4px; }
        #c { left: 60px; top: 4px; color: rgb(1, 2, 3); }
        #d { left: 80px; top: 40px; color: rgb(1, 2, 3); }
        #e { left: 60px; top: 80px; color: rgb(9, 9, 9); }
      </style><i id="a"></i><i id="b"></i><i id="c"></i><i id="d"></i><i id="e"></i>`);
      const send = async () => ({});
      // Um passo que tem que falhar, com a mensagem que diz o que veio de cada lado.
      const fails = async (step: Parameters<typeof runStep>[1], msg: string) => {
        try {
          await runStep(page, step, dir, send);
        } catch (e) {
          expect(String(e)).toContain(msg);
          return;
        }
        throw new Error(`esperava falhar: ${JSON.stringify(step)}`);
      };
      // 1 px de diferença ainda conta como o mesmo lugar (o padrão), e dá para apertar com a `tolerance`.
      await runStep(page, { expectSame: "#a", as: "#b" }, dir, send);
      await fails({ expectSame: "#a", as: "#b", tolerance: 0, timeout: 200 }, "o retângulo");
      await fails({ expectSame: "#a", as: "#c", timeout: 200 }, "o retângulo");
      await runStep(page, { expectSame: "#c", as: "#d", property: "color" }, dir, send);
      await fails({ expectSame: "#c", as: "#e", property: "color", timeout: 200 }, "color");
    } finally {
      await browser.close();
    }
  }, 60_000);

  test("--note de uma nota que não existe vira aviso em problems (#1835)", async () => {
    const page = join(dir, "pronta");
    rmSync(page, { recursive: true, force: true });
    await Bun.write(join(page, "index.html"), `<!doctype html><script type="module" src="./app.js"></script>`);
    await Bun.write(join(page, "app.js"), `window.engine.ready();`);
    const { ctx } = fakeCtx(dir);
    capture();
    expect(await runScreenshot(["notes", "--dist", page, "--note", "Sumida.md", "--out", join(dir, "n.png")], ctx)).toBe(1);
    expect(lastJson().shots[0].problems).toEqual(["--note Sumida.md: a nota não abriu (E_NOT_FOUND)"]);
  }, 60_000);

  test("a página não sai para a rede e a CSP das views vale: tudo vira problema no relatório", async () => {
    const page = join(dir, "pagina");
    rmSync(page, { recursive: true, force: true });
    await Bun.write(
      join(page, "index.html"),
      `<!doctype html><script>window.__inline = 1</script><script type="module" src="./app.js"></script>`,
    );
    await Bun.write(
      join(page, "app.js"),
      `window.engine.on("notes.changed", (p) => { document.title = "mudou:" + p.paths[0]; });
       fetch("https://example.com/x").catch(() => {});
       window.open("https://example.com/aba");
       window.engine.ready();`,
    );
    const { ctx, emit } = fakeCtx(dir);
    writeFileSync(join(dir, "rede.json"), JSON.stringify([{ expectText: "title", text: "mudou:a.md", timeout: 3000 }]));
    capture();
    // O evento do engine chega à página.
    const run = runUi(["notes", "--dist", page, "--script", join(dir, "rede.json"), "--out", join(dir, "rede")], ctx);
    // A página assina só depois de o navegador subir: o evento vai de novo até o script acabar.
    const tick = setInterval(() => emit("notes.changed", { paths: ["a.md"] }), 100);
    const code = await run;
    clearInterval(tick);
    expect(code).toBe(1);
    const r = lastJson();
    expect(r.ready).toBe(true);
    expect(r.steps[0].ok).toBe(true);
    // O fetch para fora nem sai: a CSP das views (connect-src só ws://127.0.0.1) recusa antes da rota.
    const problems = r.problems.join("\n");
    expect(problems).toContain("CSP connect-src: https://example.com/x");
    expect(problems).toMatch(/CSP script-src(-elem)?: inline/);
    expect(r.blocked).toContain("https://example.com/aba");
  }, 60_000);
});
