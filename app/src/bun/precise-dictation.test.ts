import { afterEach, beforeEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, rmSync } from "node:fs";
import path from "node:path";

import type { ModelManifest } from "../notes/semantic/model.ts";
import type { Command } from "../shared/ipc.ts";
import type { PreciseStatus } from "../shared/ui-contract.ts";
import { PreciseDictation, WHISPER_SMALL } from "./precise-dictation.ts";
import { tempDir } from "../../test/tmp.ts";

const BYTES = new TextEncoder().encode("um gguf de mentira");
const TINY: ModelManifest = {
  id: "whisper-small",
  repo: "handy-computer/whisper-small-gguf",
  revision: "r1",
  files: [{ name: "whisper-small-Q8_0.gguf", size: BYTES.length, sha256: createHash("sha256").update(BYTES).digest("hex") }],
};

let dir: string;
beforeEach(() => {
  dir = tempDir("kn-precise-");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

type Config = Extract<Command, { type: "config.set" }>;

function setup(o: { fetch?: (url: string) => Promise<Response>; reply?: { ok: boolean; error?: string } | undefined; download?: boolean; stallMs?: number } = {}) {
  const sent: (string | null | undefined)[] = [];
  const urls: string[] = [];
  const phases: PreciseStatus["phase"][] = [];
  const precise = new PreciseDictation({
    modelsDir: dir,
    manifest: TINY,
    download: o.download,
    ...(o.stallMs !== undefined ? { stallMs: o.stallMs } : {}),
    send: async (c: Config) => {
      sent.push(c.precise);
      return "reply" in o ? o.reply : { ok: true };
    },
    fetch:
      o.fetch ??
      (async (url) => {
        urls.push(url);
        return new Response(BYTES);
      }),
  });
  precise.onStatus((s) => phases.push(s.phase));
  return { precise, sent, urls, phases };
}

test("o Whisper small do ADR 0003: 270 MB, revisão e hash fixos", () => {
  expect(WHISPER_SMALL.files).toEqual([
    { name: "whisper-small-Q8_0.gguf", size: 269_751_136, sha256: "9b9c8811bbcc82a7766f0fb0925614bdacb0923b2cc630daeac17108b655b860" },
  ]);
  expect(new PreciseDictation({ modelsDir: dir, send: async () => undefined }).status()).toEqual({ enabled: false, phase: "off", size: 269_751_136 });
});

test("ligar baixa uma vez, manda o caminho ao helper e fica pronto com o `stt.precise ready`", async () => {
  const { precise, sent, urls, phases } = setup();
  await precise.apply(true);
  expect(urls).toEqual(["https://huggingface.co/handy-computer/whisper-small-gguf/resolve/r1/whisper-small-Q8_0.gguf"]);
  expect(sent).toEqual([path.join(dir, "whisper-small", "r1", "whisper-small-Q8_0.gguf")]);
  expect(existsSync(sent[0]!)).toBe(true);
  expect(phases).toEqual(["downloading", "downloading", "loading"]);
  precise.helperState("ready");
  expect(precise.status()).toEqual({ enabled: true, phase: "ready", size: BYTES.length });

  // O helper reiniciou: o mesmo caminho vai de novo, sem baixar.
  await precise.apply(true);
  expect(urls).toHaveLength(1);
  expect(sent).toHaveLength(2);
});

test("desligar solta o modelo no helper e apaga o arquivo", async () => {
  const { precise, sent } = setup();
  await precise.apply(true);
  await precise.apply(false);
  expect(sent.at(-1)).toBeNull();
  expect(existsSync(path.join(dir, "whisper-small"))).toBe(false);
  expect(precise.status().phase).toBe("off");
  // Um `stt.precise` atrasado não liga nada.
  precise.helperState("ready");
  expect(precise.status().phase).toBe("off");
});

test("começar desligado não apaga um modelo que já está na pasta", async () => {
  const on = setup();
  await on.precise.apply(true);
  const file = on.sent[0]!;
  const fresh = setup();
  await fresh.precise.apply(false);
  expect(fresh.sent).toEqual([null]);
  expect(existsSync(file)).toBe(true);
});

test("desligar no meio do download para o download, e nada fica na pasta", async () => {
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const { precise, sent } = setup({
    fetch: async () => {
      await gate;
      return new Response(BYTES);
    },
  });
  const on = precise.apply(true);
  await Bun.sleep(5);
  expect(precise.status().phase).toBe("downloading");
  const off = precise.apply(false);
  release();
  await Promise.all([on, off]);
  expect(sent).toEqual([null]);
  expect(existsSync(path.join(dir, "whisper-small"))).toBe(false);
  expect(precise.status().phase).toBe("off");
});

test("um download que falha vira erro e só tenta de novo depois de desligar e ligar", async () => {
  let calls = 0;
  const { precise, sent } = setup({
    fetch: async () => {
      calls++;
      return new Response("não", { status: 500 });
    },
  });
  await precise.apply(true);
  expect(precise.status()).toMatchObject({ enabled: true, phase: "error", error: "download" });
  await precise.apply(true);
  expect(calls).toBe(1);
  await precise.apply(false);
  await precise.apply(true);
  expect(calls).toBe(2);
  expect(sent.filter((s) => s !== null)).toEqual([]);
});

// T7941: a rede pendura no meio (8 bytes e depois nada, sem erro). Antes, "baixando" para sempre; agora vira erro.
test("um download parado, sem bytes por um tempo, vira erro e não deixa nada na pasta", async () => {
  const { precise, sent } = setup({ stallMs: 100, fetch: async () => new Response(new ReadableStream({ start: (c) => c.enqueue(BYTES.slice(0, 8)) })) });
  const t0 = Date.now();
  await precise.apply(true);
  expect(Date.now() - t0).toBeLessThan(2000);
  expect(precise.status()).toMatchObject({ enabled: true, phase: "error", error: "download" });
  expect(sent.filter((s) => s !== null)).toEqual([]);
  expect(readdirSync(dir, { recursive: true }).filter((n) => String(n).endsWith(".part"))).toEqual([]);
});

test("um arquivo com outro hash nunca vai para o helper", async () => {
  const { precise, sent } = setup({ fetch: async () => new Response(new TextEncoder().encode("outro gguf de mentira!")) });
  await precise.apply(true);
  expect(precise.status()).toMatchObject({ phase: "error", error: "download" });
  expect(sent).toEqual([]);
  expect(existsSync(path.join(dir, "whisper-small", "r1", "whisper-small-Q8_0.gguf"))).toBe(false);
});

test("o headless não baixa: sem o modelo na pasta, é erro e nenhum pedido sai", async () => {
  const { precise, sent, urls } = setup({ download: false });
  await precise.apply(true);
  expect(precise.status()).toMatchObject({ phase: "error", error: "download" });
  expect(urls).toEqual([]);
  expect(sent).toEqual([]);
});

test("sem helper de pé, o modelo espera o próximo `ready`; um helper que recusa é erro", async () => {
  const waiting = setup({ reply: undefined });
  await waiting.precise.apply(true);
  expect(waiting.precise.status().phase).toBe("waiting");

  const refused = setup({ reply: { ok: false, error: "invalid_value" } });
  await refused.precise.apply(true);
  expect(refused.precise.status()).toMatchObject({ phase: "error", error: "helper" });
});

test("o helper que não abre o modelo é erro; o que caiu deixa esperando", async () => {
  const { precise } = setup();
  await precise.apply(true);
  precise.helperState("unavailable");
  expect(precise.status()).toMatchObject({ phase: "error", error: "load" });

  const other = setup();
  await other.precise.apply(true);
  other.precise.helperState("ready");
  other.precise.helperGone();
  expect(other.precise.status().phase).toBe("waiting");
});
