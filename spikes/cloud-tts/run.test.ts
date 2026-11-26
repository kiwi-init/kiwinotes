// A rodada inteira contra o servidor gRPC falso do Google (spec #30991, caixa 2): o que ela imprime e grava não tem a
// chave, e a conferência do fim acha uma chave plantada.

import { afterAll, beforeAll, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import * as grpc from "@grpc/grpc-js";

import { ttsService } from "./google.ts";
import { leaks, main } from "./run.ts";

const FAKE_KEY = "exemplo-" + "chave-falsa-0000";
let server: grpc.Server;
let port = 0;
const texts: string[] = [];

beforeAll(async () => {
  server = new grpc.Server();
  server.addService(ttsService().service, {
    StreamingSynthesize(call: grpc.ServerDuplexStream<{ input?: { text?: string } }, unknown>) {
      call.on("data", (r: { input?: { text?: string } }) => r.input?.text && texts.push(r.input.text));
      call.on("end", () => {
        call.write({ audio_content: Buffer.alloc(960, 7) });
        call.end();
      });
    },
  });
  port = await new Promise<number>((res, rej) => server.bindAsync("127.0.0.1:0", grpc.ServerCredentials.createInsecure(), (e, p) => (e ? rej(e) : res(p))));
});
afterAll(() => server.forceShutdown());

test("a rodada: as falas, o áudio, a tabela, e nenhuma credencial na saída nem nos arquivos", async () => {
  const out = mkdtempSync(path.join(tmpdir(), "cloud-tts-run-"));
  const printed: string[] = [];
  const orig = { log: console.log, error: console.error };
  console.log = (...a) => printed.push(a.join(" "));
  console.error = (...a) => printed.push(a.join(" "));
  let code: number;
  try {
    code = await main(["--providers", "google", "--rounds", "1", "--only", "pt01,pt10,en09,mix01", "--out", out], {
      GOOGLE_TTS_ENDPOINT: `127.0.0.1:${port}`,
      GOOGLE_TTS_API_KEY: FAKE_KEY,
    });
  } finally {
    Object.assign(console, orig);
  }
  const all = printed.join("\n");
  expect(code).toBe(0);
  expect(all).toContain("credenciais: nenhuma");
  expect(all).toContain("| google | pt-BR |");
  expect(all).not.toContain(FAKE_KEY);
  // 4 falas × 3 vozes, e os tokens de exemplo não chegaram ao servidor.
  expect(texts.length).toBe(12);
  expect(texts.join("\n")).not.toMatch(/ghp|AKIA|segredo/i);
  expect(existsSync(path.join(out, "google", "Aoede", "pt10.wav"))).toBe(true);
  expect(existsSync(path.join(out, "tabela.md"))).toBe(true);
  for (const f of readdirSync(out, { recursive: true }) as string[]) {
    if (!f.includes(".")) continue;
    expect(readFileSync(path.join(out, f)).toString("latin1")).not.toContain(FAKE_KEY);
  }
});

test("a conferência acha a chave plantada, e diz só onde", () => {
  const out = mkdtempSync(path.join(tmpdir(), "cloud-tts-leak-"));
  writeFileSync(path.join(out, "medidas.json"), `{"x":"${FAKE_KEY}"}`);
  expect(leaks([FAKE_KEY], "nada", out)).toEqual(["medidas.json"]);
  expect(leaks([FAKE_KEY], `saiu ${FAKE_KEY}`, mkdtempSync(path.join(tmpdir(), "cloud-tts-leak-")))).toEqual(["saída"]);
  expect(leaks([""], "x", out)).toEqual([]);
});
