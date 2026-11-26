// T31096: o provedor ElevenLabs contra um servidor falso local. Nenhuma conta de verdade: a rodada real é do harry.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { elevenLabs, sameText } from "./elevenlabs";

const KEY = "sk_exemplo_0000000000000000000000000000000000000000";
const VOICE = { id: "voz-exemplo", name: "Exemplo", lang: "pt-BR" as const };

type HistoryItem = { history_item_id: string; text: string; voice_id: string };

const seen = {
  wsHeaders: [] as (string | null)[],
  wsUrls: [] as string[],
  wsMessages: [] as string[],
  httpHeaders: [] as (string | null)[],
  httpUrls: [] as string[],
  deleted: [] as string[],
};
let history: HistoryItem[] = [];
/** Quantos GETs do histórico voltam vazios antes de a geração aparecer (o atraso da conta de verdade). */
let lagGets = 0;
/** O que o WebSocket falso faz: tocar o áudio, recusar ou cair no meio. */
let wsMode: "ok" | "error" | "drop" = "ok";
let gen = 0;

let server: ReturnType<typeof Bun.serve>;
let base = "";

beforeAll(() => {
  server = Bun.serve({
    port: 0,
    fetch(req, srv) {
      const url = new URL(req.url);
      if (url.pathname.endsWith("/stream-input")) {
        seen.wsHeaders.push(req.headers.get("xi-api-key"));
        seen.wsUrls.push(req.url);
        return srv.upgrade(req, { data: { text: "", voice: url.pathname.split("/")[3] } }) ? undefined : new Response("no", { status: 400 });
      }
      seen.httpHeaders.push(req.headers.get("xi-api-key"));
      seen.httpUrls.push(req.url);
      if (req.headers.get("xi-api-key") !== KEY) return new Response("{}", { status: 401 });
      if (req.method === "GET" && url.pathname === "/v1/history") {
        if (lagGets > 0) {
          lagGets--;
          return Response.json({ history: [] });
        }
        const v = url.searchParams.get("voice_id");
        return Response.json({ history: history.filter((h) => h.voice_id === v) });
      }
      const del = url.pathname.match(/^\/v1\/history\/(.+)$/);
      if (req.method === "DELETE" && del) {
        seen.deleted.push(decodeURIComponent(del[1]));
        history = history.filter((h) => h.history_item_id !== decodeURIComponent(del[1]));
        return Response.json({ status: "ok" });
      }
      return new Response("{}", { status: 404 });
    },
    websocket: {
      message(ws, raw) {
        const data = ws.data as { text: string; voice: string };
        seen.wsMessages.push(String(raw));
        const msg = JSON.parse(String(raw)) as { text: string };
        if (msg.text.trim()) data.text += msg.text;
        if (msg.text !== "") return;
        // O fim do texto: a conta guarda a geração no histórico e o áudio sai em pedaços.
        if (wsMode === "error") return ws.send(JSON.stringify({ error: "quota_exceeded", message: "sem créditos" }));
        history.push({ history_item_id: `item-${++gen}`, text: data.text.trim(), voice_id: data.voice });
        ws.send(JSON.stringify({ audio: Buffer.from("ID3-parte-1").toString("base64"), isFinal: false }));
        if (wsMode === "drop") return ws.close(1011, "caiu");
        ws.send(JSON.stringify({ audio: Buffer.from("-parte-2").toString("base64"), isFinal: false }));
        ws.send(JSON.stringify({ audio: null, isFinal: true }));
      },
    },
  });
  base = `http://127.0.0.1:${server.port}`;
});
afterAll(() => server.stop(true));

function reset() {
  for (const k of Object.keys(seen) as (keyof typeof seen)[]) seen[k].length = 0;
  history = [];
  lagGets = 0;
  wsMode = "ok";
}

const provider = () => elevenLabs({ env: { ELEVENLABS_API_KEY: KEY, ELEVENLABS_BASE_URL: base }, historyWaitMs: 5 });

async function readAll(it: AsyncIterable<Uint8Array>) {
  const parts: Uint8Array[] = [];
  for await (const p of it) parts.push(p);
  return Buffer.concat(parts).toString();
}

describe("ElevenLabs (servidor falso)", () => {
  test("o áudio chega em pedaços, na ordem, em mp3", async () => {
    reset();
    const s = provider().synthesize("Oi, Ana! A reunião do Projeto X é às 15h.", VOICE);
    expect(s.format).toBe("mp3");
    expect(await readAll(s.audio)).toBe("ID3-parte-1-parte-2");
    expect((await s.done).chars).toBe("Oi, Ana! A reunião do Projeto X é às 15h.".length);
  });

  test("a chave só vai no cabeçalho xi-api-key: nunca na URL nem nas mensagens", async () => {
    reset();
    const s = provider().synthesize("Tudo pronto.", VOICE);
    await readAll(s.audio);
    await s.done;
    expect(seen.wsHeaders).toEqual([KEY]);
    expect(seen.httpHeaders.every((h) => h === KEY)).toBe(true);
    for (const u of [...seen.wsUrls, ...seen.httpUrls]) expect(u).not.toContain(KEY);
    for (const m of seen.wsMessages) expect(m).not.toContain(KEY);
  });

  test("o provedor manda só o texto que recebeu (o núcleo já tirou os segredos)", async () => {
    reset();
    const s = provider().synthesize("Sua nota foi salva.", VOICE);
    await readAll(s.audio);
    await s.done;
    const sent = seen.wsMessages.map((m) => (JSON.parse(m) as { text: string }).text).join("");
    expect(sent.trim()).toBe("Sua nota foi salva.");
  });

  test("no fim da fala, a geração é apagada do histórico", async () => {
    reset();
    const s = provider().synthesize("Lembrete: revisar o exemplo amanhã.", VOICE);
    await readAll(s.audio);
    expect((await s.done).deleted).toBe(1);
    expect(seen.deleted).toEqual(["item-" + gen]);
    expect(history).toEqual([]);
  });

  test("outra geração da conta, da mesma voz e na mesma hora, fica (o texto não bate)", async () => {
    reset();
    history.push({ history_item_id: "da-pessoa", text: "Um texto que a pessoa gerou no site.", voice_id: VOICE.id });
    history.push({ history_item_id: "outra-voz", text: "Bom dia.", voice_id: "voz-vizinha" });
    const s = provider().synthesize("Bom dia.", VOICE);
    await readAll(s.audio);
    expect((await s.done).deleted).toBe(1);
    expect(seen.deleted).toEqual(["item-" + gen]);
    expect(history.map((h) => h.history_item_id).sort()).toEqual(["da-pessoa", "outra-voz"]);
  });

  test("o histórico atrasado: procura de novo até a geração aparecer", async () => {
    reset();
    lagGets = 3;
    const s = provider().synthesize("São 3 itens na lista.", VOICE);
    await readAll(s.audio);
    expect((await s.done).deleted).toBe(1);
    expect(seen.httpUrls.filter((u) => u.includes("/v1/history?")).length).toBe(4);
  });

  test("a fala que cai no meio ainda apaga o que a conta guardou", async () => {
    reset();
    wsMode = "drop";
    const s = provider().synthesize("Uma fala que cai.", VOICE);
    await expect(readAll(s.audio)).rejects.toThrow(/fechou com 1011/);
    await expect(s.done).rejects.toThrow();
    expect(seen.deleted.length).toBe(1);
    expect(history).toEqual([]);
  });

  test("o erro do servidor sai sem a chave", async () => {
    reset();
    wsMode = "error";
    const s = provider().synthesize("Sem créditos.", VOICE);
    const err = await readAll(s.audio).then(
      () => null,
      (e: Error) => e,
    );
    expect(err?.message).toContain("quota_exceeded");
    expect(err?.message).not.toContain(KEY);
    await s.done.catch(() => {});
  });

  test("sem a chave no ambiente, para antes de qualquer chamada", () => {
    expect(() => elevenLabs({ env: { ELEVENLABS_BASE_URL: base } })).toThrow(/ELEVENLABS_API_KEY/);
  });

  test("a chave errada: o erro diz o código, não a chave", async () => {
    reset();
    const p = elevenLabs({ env: { ELEVENLABS_API_KEY: "sk_exemplo_errada", ELEVENLABS_BASE_URL: base }, historyWaitMs: 5 });
    const s = p.synthesize("Oi.", VOICE);
    await readAll(s.audio);
    const err = await s.done.then(
      () => null,
      (e: Error) => e,
    );
    expect(err?.message).toContain("401");
    expect(err?.message).not.toContain("sk_exemplo_errada");
  });

  test("vozes prontas: 3 por língua, nenhuma clonada", () => {
    const p = provider();
    expect(p.voices("pt-BR").length).toBe(3);
    expect(p.voices("en-US").length).toBe(3);
    expect(p.costPerChar).toBeGreaterThan(0);
  });

  test("sameText ignora espaços nas pontas e repetidos", () => {
    expect(sameText("  Oi,  Ana. ", "Oi, Ana.")).toBe(true);
    expect(sameText("Oi, Ana.", "Oi, Bruno.")).toBe(false);
  });
});
