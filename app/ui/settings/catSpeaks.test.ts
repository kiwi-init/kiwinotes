import { expect, test } from "bun:test";

import type { CatVoiceStatus } from "../../src/shared/ui-contract.ts";
import { catSpeaksHint, catVoiceLine, languageOf, voiceRows, voiceSize } from "./CatSpeaksRow.tsx";

const SIZE = 1_991_296_593;
const v = (o: Partial<CatVoiceStatus>): CatVoiceStatus => ({ phase: "off", size: SIZE, voice: true, model: true, voices: [], selected: "en-a", preview: null, ...o });

test("o tamanho da voz em GB ou MB", () => {
  expect(voiceSize(SIZE)).toBe("2 GB");
  expect(voiceSize(1_540_000_000)).toBe("1,5 GB");
  expect(voiceSize(250_300_000)).toBe("250 MB");
});

test("o interruptor diz que a voz roda no Mac e que nada sai dele", () => {
  expect(catSpeaksHint(false, false)).toContain("A voz roda neste Mac: nada sai dele.");
  expect(catSpeaksHint(true, false)).toContain("A voz roda neste Mac: nada sai dele.");
  expect(catSpeaksHint(true, true)).toBe("Não deu para salvar. Tente de novo.");
});

test("desligado, a linha da voz aparece com a voz no disco, para apagar, e enquanto ela baixa ou se prepara", () => {
  expect(catVoiceLine(false, v({}))).toBeNull();
  // Desligar no meio do download não esconde o download (revisão do T26736): o andamento e o Cancelar ficam.
  expect(catVoiceLine(false, v({ phase: "downloading", done: SIZE / 4, total: SIZE }))).toEqual({
    hint: "Baixando a voz: 25% de 2 GB. O gato está desligado: ele não fala até você ligar.",
    action: "cancel",
  });
  expect(catVoiceLine(false, v({ phase: "warming" }))).toEqual({
    hint: "Preparando a voz neste Mac… Na primeira vez, leva uns 20 segundos. O gato está desligado: ele não fala até você ligar.",
    action: null,
  });
  expect(catVoiceLine(false, v({ phase: "error", error: "download" }))).toBeNull();
  for (const s of [v({ phase: "ready" }), v({ phase: "noVoice", voice: false }), v({ phase: "error", error: "warmup" })])
    expect(catVoiceLine(false, s)).toEqual({ hint: "Baixada (2 GB). Desligado, o gato não fala.", action: "remove" });
});

test("ligado sem a voz: o tamanho e o botão; nada baixa sem o clique", () => {
  expect(catVoiceLine(true, v({}))).toEqual({
    hint: "Para falar, o gato precisa do modelo e das vozes (2 GB), baixados uma vez, só com o seu clique.",
    action: "download",
  });
});

test("ligado: o andamento, a preparação, pronta e os erros", () => {
  expect(catVoiceLine(true, v({ phase: "downloading", done: SIZE / 4, total: SIZE }))).toEqual({
    hint: "Baixando a voz: 25% de 2 GB. Até terminar, o gato responde por escrito.",
    action: "cancel",
  });
  expect(catVoiceLine(true, v({ phase: "downloading" }))!.hint).toStartWith("Baixando a voz: 0% de 2 GB");
  expect(catVoiceLine(true, v({ phase: "warming" }))).toEqual({ hint: "Preparando a voz neste Mac… Na primeira vez, leva uns 20 segundos.", action: null });
  expect(catVoiceLine(true, v({ phase: "ready" }))).toEqual({ hint: "Pronta. A voz roda neste Mac: o texto e o áudio não saem daqui.", action: "remove" });
  expect(catVoiceLine(true, v({ phase: "noVoice", voice: false }))!.hint).toContain("nenhuma voz está pronta");
  expect(catVoiceLine(true, v({ phase: "error", error: "download" }))).toEqual({ hint: "Não deu para baixar a voz agora. Tente de novo.", action: "retry" });
  expect(catVoiceLine(true, v({ phase: "error", error: "hash" }))!.hint).toContain("foi apagado");
  expect(catVoiceLine(true, v({ phase: "error", error: "warmup" }))!.hint).toContain("não deu para prepará-la");
});

// As vozes (spec #27531, T27778).
const VOICES = (over: Partial<Record<"en-a" | "en-b", CatVoiceStatus["voices"][number]["state"]>> = {}): CatVoiceStatus["voices"] => [
  { id: "en-a", state: over["en-a"] ?? "ready", size: 566_444 },
  { id: "en-b", state: over["en-b"] ?? "ready", size: 662_444 },
  { id: "pt-a", state: "soon" },
];

test("com o modelo e uma voz faltando, o botão é o Completar, com o tamanho só do que falta", () => {
  const s = v({ phase: "noVoice", voices: [{ id: "en-a", state: "ready", size: 566_444 }, { id: "en-b", state: "error", error: "download", size: 662_444 }, { id: "pt-a", state: "soon" }] });
  expect(catVoiceLine(true, s)).toEqual({ hint: "Falta 1 voz (1 MB). O modelo já está aqui e não baixa de novo.", action: "complete" });
  expect(catVoiceLine(true, v({ phase: "noVoice", voices: VOICES({ "en-a": "missing", "en-b": "missing" }) }))!.hint).toStartWith("Faltam 2 vozes");
});

test("o idioma mostra só as vozes dele, com o código e a descrição; a escolhida marcada", () => {
  const s = v({ phase: "ready", voices: VOICES(), selected: "en-b" });
  expect(voiceRows(s, "english")).toEqual([
    { id: "en-a", code: "Kiwi EN-1", hint: "Animada e divertida", chosen: false, canChoose: true, listen: "listen" },
    { id: "en-b", code: "Kiwi EN-2", hint: "Suave e fofa", chosen: true, canChoose: true, listen: "listen" },
  ]);
  // A pt-a: em breve, sem Usar nem Ouvir.
  expect(voiceRows(s, "portuguese")).toEqual([
    { id: "pt-a", code: "Kiwi PT-1", hint: "Leve, com sotaque brasileiro. Em breve.", chosen: false, canChoose: false, listen: null },
  ]);
  expect(languageOf("en-b")).toBe("english");
  expect(languageOf("pt-a")).toBe("portuguese");
});

test("o Ouvir: Parar na que toca, Baixar sem o modelo ou sem a voz, nada baixando", () => {
  expect(voiceRows(v({ phase: "ready", voices: VOICES(), preview: "en-a" }), "english").map((r) => r.listen)).toEqual(["stop", "listen"]);
  expect(voiceRows(v({ phase: "off", model: false, voices: VOICES({ "en-a": "missing", "en-b": "missing" }) }), "english").map((r) => r.listen)).toEqual(["download", "download"]);
  expect(voiceRows(v({ phase: "noVoice", voices: VOICES({ "en-b": "missing" }) }), "english").map((r) => r.listen)).toEqual(["listen", "download"]);
  expect(voiceRows(v({ phase: "downloading", voices: VOICES() }), "english").map((r) => r.listen)).toEqual([null, null]);
});

test("o erro de uma voz fica na linha dela", () => {
  const s = v({ phase: "noVoice", voices: [{ id: "en-a", state: "error", error: "hash", size: 1 }, { id: "en-b", state: "error", error: "download", size: 1 }, { id: "pt-a", state: "soon" }] });
  expect(voiceRows(s, "english").map((r) => r.hint)).toEqual([
    "Animada e divertida. O arquivo desta voz veio diferente e foi apagado.",
    "Suave e fofa. Não deu para baixar esta voz.",
  ]);
});
