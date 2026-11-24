import { expect, test } from "bun:test";

import type { CatVoiceStatus } from "../../src/shared/ui-contract.ts";
import { catSpeaksHint, catVoiceLine, voiceSize } from "./CatSpeaksRow.tsx";

const SIZE = 1_991_296_593;
const v = (o: Partial<CatVoiceStatus>): CatVoiceStatus => ({ phase: "off", size: SIZE, voice: true, ...o });

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

test("desligado, a linha da voz só aparece com a voz no disco, para apagar", () => {
  expect(catVoiceLine(false, v({}))).toBeNull();
  expect(catVoiceLine(false, v({ phase: "downloading", done: 1, total: SIZE }))).toBeNull();
  expect(catVoiceLine(false, v({ phase: "error", error: "download" }))).toBeNull();
  for (const s of [v({ phase: "ready" }), v({ phase: "noVoice", voice: false }), v({ phase: "error", error: "warmup" })])
    expect(catVoiceLine(false, s)).toEqual({ hint: "Baixada (2 GB). Desligado, o gato não fala.", action: "remove" });
});

test("ligado sem a voz: o tamanho e o botão; nada baixa sem o clique", () => {
  expect(catVoiceLine(true, v({}))).toEqual({
    hint: "Para falar, o gato precisa do modelo de voz (2 GB), baixado uma vez, só com o seu clique.",
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
  expect(catVoiceLine(true, v({ phase: "noVoice", voice: false }))!.hint).toContain("a voz do gato ainda está sendo escolhida");
  expect(catVoiceLine(true, v({ phase: "error", error: "download" }))).toEqual({ hint: "Não deu para baixar a voz agora. Tente de novo.", action: "retry" });
  expect(catVoiceLine(true, v({ phase: "error", error: "hash" }))!.hint).toContain("foi apagado");
  expect(catVoiceLine(true, v({ phase: "error", error: "warmup" }))!.hint).toContain("não deu para prepará-la");
});
