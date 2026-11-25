// Um `kiwi-voice` falso para os testes do src/bun/voice-process.ts (T26732): o mesmo protocolo de linhas de JSON, sem
// modelo e sem MLX. Cada frase vira `FAKE_CHUNKS` blocos de 6000 amostras (0,25 s a 24 kHz), um a cada 15 ms, e cada
// amostra vale o número do bloco. Frases especiais:
//   "cai"   → o processo sai com o código 3 no meio da frase
//   "erro"  → um `error` com o id da frase
// Um `speak` com a voz (T27778) cujo `refAudio` termina em "quebrada.wav" responde um `error` com o id, como o de verdade
// quando a referência não carrega: só aquela frase falha.
// O `load` com refText "sem-modelo" responde com um `error` sem id. O `warmup` responde `warm` em 20 ms, ou, com o refText
// "frio-falha", um `error` sem id (o Metal que não compila). `FAKE_WARM_MS` muda os 20 ms (o roteiro de tela, T26736). Cada comando recebido vai para o arquivo do 1º
// argumento, uma linha por comando, para o teste conferir o `cancel` e o `quit`.

import { appendFileSync } from "node:fs";

const logFile = process.argv[2];
const CHUNKS = Number(process.env.FAKE_CHUNKS ?? 4);
const send = (o: object) => process.stdout.write(JSON.stringify(o) + "\n");
const cancelled = new Set<string>();
let queue: { id: string; text: string }[] = [];
let busy = false;
let failWarm = false;

function pcm(value: number, n = 6000): string {
  const b = Buffer.alloc(n * 2);
  for (let i = 0; i < n; i++) b.writeInt16LE(value, i * 2);
  return b.toString("base64");
}

async function pump() {
  if (busy) return;
  const next = queue.shift();
  if (!next) return;
  busy = true;
  const { id, text } = next;
  for (let seq = 0; seq < CHUNKS; seq++) {
    await Bun.sleep(15);
    if (cancelled.has(id)) break;
    if (text === "cai" && seq === 1) process.exit(3);
    if (text === "erro" && seq === 1) {
      send({ type: "error", id, message: "falha inventada" });
      busy = false;
      return void pump();
    }
    send({ type: "pcm", id, seq, pcm: pcm(seq + 1) });
  }
  send(cancelled.has(id) ? { type: "cancelled", id } : { type: "done", id });
  busy = false;
  void pump();
}

let buf = "";
for await (const chunk of Bun.stdin.stream()) {
  buf += new TextDecoder().decode(chunk);
  for (let nl = buf.indexOf("\n"); nl !== -1; nl = buf.indexOf("\n")) {
    const line = buf.slice(0, nl);
    buf = buf.slice(nl + 1);
    if (logFile) appendFileSync(logFile, line + "\n");
    const m = JSON.parse(line);
    if (m.type === "load") {
      failWarm = m.refText === "frio-falha";
      if (m.refText === "sem-modelo") send({ type: "error", message: "load: sem o modelo" });
      else setTimeout(() => send({ type: "ready", sampleRate: 24000, loadMs: 5 }), 20);
    } else if (m.type === "warmup") {
      const ms = Number(process.env.FAKE_WARM_MS ?? 20);
      setTimeout(() => send(failWarm ? { type: "error", message: "warmup: falha inventada" } : { type: "warm", ms }), ms);
    } else if (m.type === "speak") {
      if (typeof m.voice?.refAudio === "string" && m.voice.refAudio.endsWith("quebrada.wav")) {
        send({ type: "error", id: m.id, message: "voice: a referência não carregou" });
        continue;
      }
      queue.push({ id: m.id, text: m.text });
      void pump();
    } else if (m.type === "cancel") {
      cancelled.add(m.id);
      const before = queue.length;
      queue = queue.filter((q) => q.id !== m.id);
      if (queue.length < before) send({ type: "cancelled", id: m.id });
    } else if (m.type === "quit") process.exit(0);
  }
}
process.exit(0);
