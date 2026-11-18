import { expect, test } from "bun:test";

import { EDITABLE_TEXT, MEDIA_TYPES, openTarget } from "../../../src/shared/file-view.ts";
import { MEDIA_MIME, mediaType } from "./media.ts";
import { viewerFor } from "./viewers.ts";

test("o áudio e o vídeo (T19315): a lista do engine é a mesma do MEDIA_MIME, e cada um toca no mesmo player", () => {
  expect([...MEDIA_TYPES].sort()).toEqual(Object.keys(MEDIA_MIME).sort());
  const player = viewerFor("a.mp3");
  expect(player?.as).toBe("binary");
  for (const ext of MEDIA_TYPES) {
    expect(viewerFor(`Projeto X/Reuniao.${ext.toUpperCase()}`)).toBe(player);
    expect(openTarget(`Projeto X/Reuniao.${ext}`)).toBe("viewer");
    // Só leitura: o `files.save` não grava mídia.
    expect(EDITABLE_TEXT.has(ext)).toBe(false);
  }
});

test("o tipo de cada um: áudio ou vídeo, e o MIME do blob", () => {
  expect(mediaType("Projeto X/fala.M4A")).toEqual({ kind: "audio", mime: "audio/mp4" });
  expect(mediaType("Ana/cena.mov")).toEqual({ kind: "video", mime: "video/quicktime" });
  expect(mediaType("feira.mp3")?.kind).toBe("audio");
  expect(mediaType("feira.mp4")?.kind).toBe("video");
  // WebM e Ogg não (não há como provar que tocam no WebView do app), nem um nome sem extensão ou de outro tipo.
  for (const name of ["cena.webm", "fala.ogg", "fala.flac", "mp3", "fala.mp3.txt", "exemplo.constructor"]) expect(mediaType(name)).toBeUndefined();
  expect(openTarget("cena.webm")).toBe("app");
});
