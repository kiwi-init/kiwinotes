import { expect, test } from "bun:test";

import type { FileSaveResult } from "../types.ts";
import { detectEol, TextSession, type TextSaveState, toDisk, toEditor } from "./textSession.ts";

/** Um disco de mentira: grava se a versão bate, como o `files.save`. O timer é do teste. */
function rig(text = "um") {
  const disk = { text, version: "v1", n: 1 };
  const states: TextSaveState[] = [];
  const shown: string[] = [];
  const saves: string[] = [];
  let timer: (() => void) | null = null;
  let fail = false;
  let gate: Promise<void> | null = null;
  const session = new TextSession({
    text,
    version: disk.version,
    save: async (content, baseVersion): Promise<FileSaveResult> => {
      saves.push(content);
      if (gate) await gate;
      if (fail) throw new Error("disk");
      if (baseVersion !== disk.version) return { saved: false, current: { path: "a.txt", size: disk.text.length, version: disk.version, text: disk.text } };
      disk.text = content;
      disk.version = `v${++disk.n}`;
      return { saved: true, path: "a.txt", size: content.length, version: disk.version };
    },
    onState: (s) => states.push(s),
    onText: (t) => shown.push(t),
    setTimer: (fn) => (timer = fn),
    clearTimer: () => (timer = null),
  });
  return {
    session, disk, states, shown, saves,
    tick: async () => {
      const fn = timer;
      timer = null;
      fn?.();
      await Bun.sleep(0);
    },
    pending: () => timer !== null,
    outside: (t: string) => {
      disk.text = t;
      disk.version = `v${++disk.n}`;
    },
    failing: (v: boolean) => (fail = v),
    hold: () => {
      let open!: () => void;
      gate = new Promise<void>((r) => (open = r));
      return () => {
        gate = null;
        open();
      };
    },
  };
}

test("digitar grava um pouco depois, uma vez só, com a versão nova", async () => {
  const r = rig();
  r.session.edit("um d");
  r.session.edit("um dois");
  expect(r.session.state).toBe("pending");
  expect(r.saves).toEqual([]);
  await r.tick();
  expect(r.saves).toEqual(["um dois"]);
  expect(r.disk.text).toBe("um dois");
  expect(r.session.version).toBe(r.disk.version);
  expect(r.states).toEqual(["pending", "pending", "saving", "saved"]);
  // O mesmo texto de novo não é mudança.
  r.session.edit("um dois");
  expect(r.pending()).toBe(false);
});

test("sair do arquivo grava já; sem nada por gravar, só sai", async () => {
  const r = rig();
  expect(await r.session.flush()).toBe(true);
  expect(r.saves).toEqual([]);
  r.session.edit("um dois");
  expect(await r.session.flush()).toBe(true);
  expect(r.disk.text).toBe("um dois");
  expect(r.pending()).toBe(false);
});

test("o que foi digitado durante um save vai no seguinte, e nunca dois ao mesmo tempo", async () => {
  const r = rig();
  r.session.edit("a");
  const open = r.hold();
  const first = r.session.save();
  r.session.edit("ab");
  const leaving = r.session.flush();
  expect(r.saves).toEqual(["a"]);
  open();
  expect(await first).toBe(false); // ainda havia o "ab" por gravar
  expect(await leaving).toBe(true);
  expect(r.saves).toEqual(["a", "ab"]);
  expect(r.disk.text).toBe("ab");
});

test("mudou fora com algo por gravar: conflito, nada é escrito, e sair não deixa", async () => {
  const r = rig();
  r.session.edit("o meu");
  r.outside("o de fora");
  await r.tick();
  expect(r.session.state).toBe("conflict");
  expect(r.session.conflict).toEqual({ text: "o de fora", version: r.disk.version });
  expect(r.disk.text).toBe("o de fora");
  expect(await r.session.flush()).toBe(false);
  // Digitar no conflito não agenda outro save.
  r.session.edit("o meu, mais");
  expect(r.pending()).toBe(false);

  expect(await r.session.keepMine()).toBe(true);
  expect(r.disk.text).toBe("o meu, mais");
  expect(r.session.state).toBe("saved");
});

test("no conflito, usar o de fora troca o texto da tela e perde o daqui", async () => {
  const r = rig();
  r.session.edit("o meu");
  r.outside("o de fora");
  await r.tick();
  r.session.useTheirs();
  expect(r.session.text).toBe("o de fora");
  expect(r.shown).toEqual(["o de fora"]);
  expect(r.session.conflict).toBeNull();
  expect(await r.session.flush()).toBe(true);
  expect(r.disk.text).toBe("o de fora");
});

test("mudou fora sem nada por gravar: o de fora entra; o eco do próprio save não", async () => {
  const r = rig();
  r.session.edit("um dois");
  await r.tick();
  r.session.external({ text: r.disk.text, version: r.disk.version });
  expect(r.shown).toEqual([]);
  r.outside("de fora");
  r.session.external({ text: r.disk.text, version: r.disk.version });
  expect(r.session.text).toBe("de fora");
  expect(r.shown).toEqual(["de fora"]);
  // Com algo por gravar, o de fora não entra por cima: o save acha o conflito.
  r.session.edit("de fora, e o meu");
  r.outside("outro de fora");
  r.session.external({ text: r.disk.text, version: r.disk.version });
  expect(r.session.text).toBe("de fora, e o meu");
  await r.tick();
  expect(r.session.state).toBe("conflict");
});

test("o disco falhou: erro, o texto fica por gravar e tentar de novo grava", async () => {
  const r = rig();
  r.failing(true);
  r.session.edit("um dois");
  await r.tick();
  expect(r.session.state).toBe("error");
  expect(await r.session.flush()).toBe(false);
  r.failing(false);
  expect(await r.session.save()).toBe(true);
  expect(r.disk.text).toBe("um dois");
});

test("revisão do T7105: o fim de linha do arquivo volta em cada save, embora a tela trabalhe em \\n", async () => {
  expect(detectEol("a\r\nb\r\n")).toBe("\r\n");
  expect(detectEol("a\rb\r")).toBe("\r");
  expect(detectEol("a\nb\n")).toBe("\n");
  expect(detectEol("sem quebra")).toBe("\n");
  expect(detectEol("")).toBe("\n");
  expect(detectEol("a\r\nb\nc")).toBeNull();
  expect(detectEol("a\rb\r\nc")).toBeNull();
  expect(toEditor("a\r\nb\rc\n")).toBe("a\nb\nc\n");
  expect(toDisk("a\nb\n", "\r\n")).toBe("a\r\nb\r\n");
  expect(toDisk("a\nb", "\r")).toBe("a\rb");
  expect(toDisk("a\nb\n", "\n")).toBe("a\nb\n");

  // Um txt do Windows: a tela mostra em \n (como o <textarea>), e uma letra digitada não reescreve as outras linhas.
  const r = rig("um\r\ndois\r\n");
  expect(r.session.text).toBe("um\ndois\n");
  expect(r.session.eol).toBe("\r\n");
  r.session.edit("um\ndois\nx");
  await r.tick();
  expect(r.disk.text).toBe("um\r\ndois\r\nx");
  // Colar um texto com \r\n no editor não dobra as quebras.
  r.session.edit("um\r\ndois\r\nx\r\ny");
  await r.tick();
  expect(r.disk.text).toBe("um\r\ndois\r\nx\r\ny");
  // O eco do próprio save não muda nada.
  r.session.external({ text: r.disk.text, version: r.disk.version });
  expect(r.shown).toEqual([]);
});

test("o de fora entra com o fim de linha dele: de CRLF para LF, e o próximo save segue o novo", async () => {
  const r = rig("um\r\ndois\r\n");
  r.outside("um\ndois\ntrês\n");
  r.session.external({ text: r.disk.text, version: r.disk.version });
  expect(r.shown).toEqual(["um\ndois\ntrês\n"]);
  expect(r.session.eol).toBe("\n");
  r.session.edit("um\ndois\ntrês\nquatro\n");
  await r.tick();
  expect(r.disk.text).toBe("um\ndois\ntrês\nquatro\n");
  // No conflito, "usar o de fora" também troca o fim de linha guardado.
  r.session.edit("o meu\n");
  r.outside("de\r\nfora\r\n");
  await r.tick();
  r.session.useTheirs();
  expect(r.session.text).toBe("de\nfora\n");
  expect(r.session.eol).toBe("\r\n");
});

test("num arquivo grande (spec #13382), a tecla só marca: o texto é lido uma vez, na hora de gravar, e o estado não pisca", async () => {
  const big = `${"linha do arquivo grande\n".repeat(45_000)}`; // ~1 MB
  const r = rig(big);
  let screen = big;
  let reads = 0;
  const read = () => (reads++, screen);
  for (const ch of "abc") {
    screen += ch;
    r.session.touch(read);
  }
  expect(reads).toBe(0); // nenhuma tecla leu o arquivo inteiro
  expect(r.saves).toEqual([]);
  // Uma troca só para "pending", e não uma por tecla.
  expect(r.states).toEqual(["pending"]);
  await r.tick();
  expect(reads).toBe(1);
  expect(r.saves).toEqual([`${big}abc`]);
  expect(r.states).toEqual(["pending", "saving", "saved"]);
  // Digitou e apagou de volta ao que está no disco: nada a gravar.
  screen += "x";
  r.session.touch(read);
  screen = screen.slice(0, -1);
  await r.tick();
  expect(r.saves).toHaveLength(1);
  expect(r.session.state).toBe("saved");
});

test("com o touch, o fim de linha do arquivo volta e sair grava já (spec #13382)", async () => {
  const r = rig("a\r\nb");
  let screen = "a\nb";
  r.session.touch(() => screen);
  screen = "a\nb\nc";
  r.session.touch(() => screen);
  expect(await r.session.flush()).toBe(true);
  expect(r.disk.text).toBe("a\r\nb\r\nc");
});
