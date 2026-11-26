// O cliente do processo da voz (T26732) contra o `kiwi-voice` falso (test/helpers/fake-kiwi-voice.ts): um processo de
// verdade, com o mesmo protocolo, sem modelo nem áudio.

import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

import { tempDir } from "../../test/tmp.ts";
import { type FalaLingua, spawnVoice, VOICE_SLICE_SAMPLES, VoiceError, VoiceProcess, voicePath, type VoiceAssets } from "./voice-process.ts";

const FAKE = path.join(import.meta.dir, "..", "..", "test", "helpers", "fake-kiwi-voice.ts");
const ASSETS: VoiceAssets = { modelDir: "/tmp/exemplo/modelo", refAudio: "/tmp/exemplo/voz.wav", refText: "Oi, eu sou a Ana." };

const open: VoiceProcess[] = [];
afterEach(async () => {
  await Promise.all(open.splice(0).map((v) => v.stop()));
});

function make(
  over: { idleMs?: number; assets?: (lingua?: FalaLingua) => VoiceAssets | Promise<VoiceAssets>; lingua?: (frase: string) => FalaLingua } = {},
) {
  const log = path.join(tempDir("kiwi-voice"), "cmds.jsonl");
  let spawns = 0;
  const v = new VoiceProcess({
    bin: "kiwi-voice",
    assets: over.assets ?? (() => ASSETS),
    ...(over.lingua ? { lingua: over.lingua } : {}),
    idleMs: over.idleMs ?? 60_000,
    spawn: () => {
      spawns++;
      return spawnVoice(process.execPath, [FAKE, log]);
    },
  });
  open.push(v);
  const cmds = () => {
    try {
      return readFileSync(log, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
    } catch {
      return [];
    }
  };
  return { v, cmds, spawns: () => spawns };
}

async function collect(it: AsyncIterable<Int16Array>): Promise<Int16Array[]> {
  const out: Int16Array[] = [];
  for await (const c of it) out.push(c);
  return out;
}

test("o voicePath aponta para a pasta que o copy do electrobun.config.ts cria no .app", async () => {
  const { default: config } = await import("../../electrobun.config.ts");
  const views = "/Aplicativos/Exemplo.app/Contents/Resources/app/views";
  expect(config.build.copy[".voice"]).toBe("voice");
  // O release.ts exige o kiwi-voice no mesmo lugar.
  const release = readFileSync(path.join(import.meta.dir, "..", "..", "scripts", "release.ts"), "utf8");
  expect(release).toContain(`path.join(app, "Contents", "Resources", "app", "voice", VOICE_EXE)`);
  expect(voicePath(views, {})).toBe("/Aplicativos/Exemplo.app/Contents/Resources/app/voice/kiwi-voice");
  expect(voicePath(views, { KIWI_VOICE: "/tmp/exemplo/kiwi-voice" })).toBe("/tmp/exemplo/kiwi-voice");
});

describe("VoiceProcess", () => {
  test("sobe só na 1ª frase, manda o load com o teto de 512 MB e fatia em 80 ms", async () => {
    const { v, cmds, spawns } = make();
    expect(v.running).toBe(false);
    expect(spawns()).toBe(0);
    const slices = await collect(v.sintetizar("Bom dia, Ana.", new AbortController().signal));
    expect(v.running).toBe(true);
    // 4 blocos de 6000 amostras = 24000: 12 fatias de 1920 e o resto de 960.
    expect(slices.map((s) => s.length)).toEqual([...Array(12).fill(VOICE_SLICE_SAMPLES), 960]);
    const all = slices.flatMap((s) => [...s]);
    expect(all.length).toBe(24_000);
    expect(all.slice(0, 6000).every((x) => x === 1)).toBe(true);
    expect(all.slice(18_000).every((x) => x === 4)).toBe(true);
    const load = cmds().find((c) => c.type === "load");
    expect(load).toEqual({ type: "load", ...ASSETS, language: "portuguese", cacheMB: 512 });
    // A 2ª frase usa o mesmo processo.
    await collect(v.sintetizar("Até logo.", new AbortController().signal));
    expect(spawns()).toBe(1);
  });

  test("o abort manda o cancel, para a frase e não estraga a próxima", async () => {
    const { v, cmds } = make();
    const ac = new AbortController();
    const got: Int16Array[] = [];
    for await (const s of v.sintetizar("Uma frase longa.", ac.signal)) {
      got.push(s);
      ac.abort();
    }
    expect(got.length).toBe(1);
    const id = cmds().find((c) => c.type === "speak").id;
    await Bun.sleep(30);
    expect(cmds()).toContainEqual({ type: "cancel", id });
    const next = await collect(v.sintetizar("Outra.", new AbortController().signal));
    expect(next.flatMap((s) => [...s]).length).toBe(24_000);
  });

  test("o player largar o iterador também cancela", async () => {
    const { v, cmds } = make();
    for await (const _ of v.sintetizar("Frase.", new AbortController().signal)) break;
    const id = cmds().find((c) => c.type === "speak").id;
    await Bun.sleep(30);
    expect(cmds()).toContainEqual({ type: "cancel", id });
  });

  test("abortada antes de começar não sobe o processo", async () => {
    const { v, spawns } = make();
    const ac = new AbortController();
    ac.abort();
    expect(await collect(v.sintetizar("Nada.", ac.signal))).toEqual([]);
    expect(spawns()).toBe(0);
  });

  test("o processo cair vira throw na frase, e a próxima sobe outro", async () => {
    const { v, spawns } = make();
    await expect(collect(v.sintetizar("cai", new AbortController().signal))).rejects.toThrow(/saiu \(código 3\)/);
    expect(v.running).toBe(false);
    const ok = await collect(v.sintetizar("De novo.", new AbortController().signal));
    expect(ok.length).toBe(13);
    expect(spawns()).toBe(2);
  });

  test("um erro numa frase só falha aquela frase", async () => {
    const { v, spawns } = make();
    await expect(collect(v.sintetizar("erro", new AbortController().signal))).rejects.toBeInstanceOf(VoiceError);
    expect(v.running).toBe(true);
    expect((await collect(v.sintetizar("Depois.", new AbortController().signal))).length).toBe(13);
    expect(spawns()).toBe(1);
  });

  test("sem o modelo, a frase falha e o processo não fica de pé", async () => {
    const { v } = make({ assets: () => ({ ...ASSETS, refText: "sem-modelo" }) });
    await expect(collect(v.sintetizar("Oi.", new AbortController().signal))).rejects.toThrow(/sem o modelo/);
    await Bun.sleep(30);
    expect(v.running).toBe(false);
  });

  test("os arquivos que ainda não baixaram viram throw, sem processo preso", async () => {
    const { v } = make({
      assets: () => {
        throw new Error("a voz ainda não baixou");
      },
    });
    await expect(collect(v.sintetizar("Oi.", new AbortController().signal))).rejects.toThrow(/ainda não baixou/);
    expect(v.running).toBe(false);
  });

  test("duas frases ao mesmo tempo saem inteiras, cada uma com o seu id", async () => {
    const { v, cmds } = make();
    const [a, b] = await Promise.all([
      collect(v.sintetizar("Primeira.", new AbortController().signal)),
      collect(v.sintetizar("Segunda.", new AbortController().signal)),
    ]);
    expect(a.flatMap((s) => [...s]).length).toBe(24_000);
    expect(b.flatMap((s) => [...s]).length).toBe(24_000);
    const ids = cmds().filter((c) => c.type === "speak").map((c) => c.id);
    expect(new Set(ids).size).toBe(2);
  });

  test("parado pelo tempo do ocioso, sai com o quit e solta a memória", async () => {
    const { v, cmds, spawns } = make({ idleMs: 60 });
    await collect(v.sintetizar("Oi.", new AbortController().signal));
    expect(v.running).toBe(true);
    await Bun.sleep(250);
    expect(v.running).toBe(false);
    expect(cmds().at(-1)).toEqual({ type: "quit" });
    // A frase seguinte sobe de novo.
    await collect(v.sintetizar("Voltei.", new AbortController().signal));
    expect(spawns()).toBe(2);
  });

  test("uma frase que chega durante o stop sobe outro processo e sai inteira", async () => {
    const { v, spawns } = make();
    await collect(v.sintetizar("Oi, Ana.", new AbortController().signal));
    const stopping = v.stop();
    const next = await collect(v.sintetizar("Outra frase.", new AbortController().signal));
    await stopping;
    expect(next.flatMap((s) => [...s]).length).toBe(24_000);
    expect(spawns()).toBe(2);
    expect(v.running).toBe(true);
  });

  test("o warmup sobe o processo, espera o warm e depois o ocioso vale", async () => {
    const { v, cmds, spawns } = make({ idleMs: 60 });
    expect(await v.warmup()).toBe(20);
    expect(cmds().map((c) => c.type)).toEqual(["load", "warmup"]);
    expect(v.running).toBe(true);
    await Bun.sleep(250);
    expect(v.running).toBe(false);
    expect(spawns()).toBe(1);
  });

  test("o warmup que falha vira throw e não deixa o processo de pé", async () => {
    const { v } = make({ assets: () => ({ ...ASSETS, refText: "frio-falha" }) });
    await expect(v.warmup()).rejects.toThrow(/warmup: falha inventada/);
    await Bun.sleep(30);
    expect(v.running).toBe(false);
  });

  test("uma frase em andamento segura o ocioso", async () => {
    const { v } = make({ idleMs: 10 });
    await collect(v.sintetizar("Primeira.", new AbortController().signal));
    const slow = collect(v.sintetizar("Segunda.", new AbortController().signal));
    await Bun.sleep(5);
    expect((await slow).length).toBe(13);
  });
});

describe("a voz de cada fala (T27778)", () => {
  const ANA: VoiceAssets = { ...ASSETS, refAudio: "/tmp/exemplo/ana.wav", refText: "Oi, eu sou a Ana.", language: "english" };
  const BIA: VoiceAssets = { ...ASSETS, refAudio: "/tmp/exemplo/bia.wav", refText: "Oi, eu sou a Bia.", language: "english" };
  const speaks = (cmds: () => { type: string; text?: string; voice?: { refAudio: string } }[]) =>
    cmds().filter((c) => c.type === "speak").map((c) => `${c.text}:${c.voice!.refAudio.split("/").at(-1)}`);

  test("cada speak leva a voz; trocar no meio da fala só vale na próxima, sem subir outro processo", async () => {
    let voz = ANA;
    const { v, cmds, spawns } = make({ assets: () => voz });
    const turno1 = new AbortController();
    await collect(v.sintetizar("um", turno1.signal));
    voz = BIA;
    // A mesma fala (o mesmo signal): a 2ª frase sai na voz em que a fala começou.
    await collect(v.sintetizar("dois", turno1.signal));
    const turno2 = new AbortController();
    await collect(v.sintetizar("três", turno2.signal));
    expect(speaks(cmds)).toEqual(["um:ana.wav", "dois:ana.wav", "três:bia.wav"]);
    expect(cmds().find((c) => c.type === "speak")!.voice).toEqual({ refAudio: ANA.refAudio, refText: ANA.refText, language: "english" });
    expect(spawns()).toBe(1);
    expect(cmds().filter((c) => c.type === "load").length).toBe(1);
  });

  test("o com() fala numa voz fixa, sem mexer na escolhida", async () => {
    const { v, cmds } = make({ assets: () => ANA });
    await collect(v.com(() => BIA).sintetizar("prévia", new AbortController().signal));
    await collect(v.sintetizar("fala", new AbortController().signal));
    expect(speaks(cmds)).toEqual(["prévia:bia.wav", "fala:ana.wav"]);
  });

  test("a voz que não carrega falha só aquela frase", async () => {
    const { v, cmds } = make({ assets: () => ANA });
    const quebrada = { ...BIA, refAudio: "/tmp/exemplo/quebrada.wav" };
    await expect(collect(v.com(() => quebrada).sintetizar("x", new AbortController().signal))).rejects.toThrow(VoiceError);
    expect((await collect(v.sintetizar("depois", new AbortController().signal))).length).toBeGreaterThan(0);
    expect(speaks(cmds).at(-1)).toBe("depois:ana.wav");
  });

  test("sem a voz no disco, a frase falha antes do speak", async () => {
    const { v, cmds } = make({ assets: () => ANA });
    await expect(collect(v.com(() => Promise.reject(new Error("a voz en-b não foi baixada"))).sintetizar("x", new AbortController().signal))).rejects.toThrow(/sem a voz/);
    expect(speaks(cmds)).toEqual([]);
  });
});


describe("a voz segue a língua da frase (T31030, harry #31028)", () => {
  const EN: VoiceAssets = { ...ASSETS, refAudio: "/tmp/exemplo/en.wav", refText: "Hi, I'm Ana.", language: "english" };
  const PT: VoiceAssets = { ...ASSETS, refAudio: "/tmp/exemplo/pt.wav", refText: "Oi, eu sou a Ana.", language: "portuguese" };
  // O detector de mentira: a frase diz a língua dela no começo ("pt:", "en:"); sem prefixo, sem sinal.
  const lingua = (frase: string): FalaLingua => (frase.startsWith("pt:") ? "pt" : frase.startsWith("en:") ? "en" : null);
  const speaks = (cmds: () => { type: string; text?: string; voice?: { refAudio: string; language: string } }[]) =>
    cmds().filter((c) => c.type === "speak").map((c) => `${c.text}>${c.voice!.language}`);

  test("numa fala mista, cada frase na voz da língua dela; a escolhida é a do load e a de quem não diz", async () => {
    const asked: (FalaLingua | undefined)[] = [];
    // A pessoa escolheu a voz inglesa: sem a língua, o EN.
    const { v, cmds, spawns } = make({ assets: (l) => (asked.push(l), l === "pt" ? PT : EN), lingua });
    const fala = new AbortController();
    for (const f of ["en:Found it.", "pt:Achei a nota.", "pt:Está salva.", "en:Done."]) await collect(v.sintetizar(f, fala.signal));
    expect(speaks(cmds)).toEqual(["en:Found it.>english", "pt:Achei a nota.>portuguese", "pt:Está salva.>portuguese", "en:Done.>english"]);
    // Uma leitura por língua na fala, e um processo só, carregado uma vez.
    expect(asked.filter((l) => l !== undefined)).toEqual(["en", "pt"]);
    expect(spawns()).toBe(1);
    expect(cmds().filter((c) => c.type === "load").length).toBe(1);
  });

  test("a frase sem sinal segue a língua da anterior; no começo da fala, a voz escolhida", async () => {
    const { v, cmds } = make({ assets: (l) => (l === "pt" ? PT : EN), lingua });
    const fala = new AbortController();
    for (const f of ["Hmm.", "pt:Achei.", "42.", "en:Done.", "OK."]) await collect(v.sintetizar(f, fala.signal));
    expect(speaks(cmds)).toEqual(["Hmm.>english", "pt:Achei.>portuguese", "42.>portuguese", "en:Done.>english", "OK.>english"]);
    // Uma fala nova começa de novo pela escolhida.
    await collect(v.sintetizar("Hmm.", new AbortController().signal));
    expect(speaks(cmds).at(-1)).toBe("Hmm.>english");
  });

  test("o com() (o Ouvir) não olha a língua da frase", async () => {
    const { v, cmds } = make({ assets: (l) => (l === "pt" ? PT : EN), lingua });
    await collect(v.com(() => EN).sintetizar("pt:Oi, eu sou o Kiwi.", new AbortController().signal));
    expect(speaks(cmds)).toEqual(["pt:Oi, eu sou o Kiwi.>english"]);
  });

  test("sem o lingua, todas as frases na voz escolhida, como antes", async () => {
    const { v, cmds } = make({ assets: (l) => (l === "pt" ? PT : EN) });
    const fala = new AbortController();
    for (const f of ["en:Found it.", "pt:Achei."]) await collect(v.sintetizar(f, fala.signal));
    expect(speaks(cmds)).toEqual(["en:Found it.>english", "pt:Achei.>english"]);
  });
});
