// A imagem de fora baixada pelo engine só depois do clique (T2984): só https, só imagem, com limite.

import { describe, expect, test } from "bun:test";

import { fetchRemoteImage, remoteImageUrl } from "./remote-image.ts";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);

function fake(body: Uint8Array, headers: Record<string, string>, opts: { status?: number; url?: string } = {}) {
  const seen: { url: string; init: RequestInit }[] = [];
  const fetcher = async (url: string, init: RequestInit) => {
    seen.push({ url, init });
    const res = new Response(body as BodyInit, { status: opts.status ?? 200, headers });
    Object.defineProperty(res, "url", { value: opts.url ?? url });
    return res;
  };
  return { fetcher, seen };
}

describe("a imagem de fora", () => {
  test("https com tipo de imagem vira data:, sem cookie nem referrer", async () => {
    const { fetcher, seen } = fake(PNG, { "content-type": "image/png" });
    const got = await fetchRemoteImage("https://example.com/a.png", fetcher);
    expect(got).toEqual({ path: "https://example.com/a.png", mime: "image/png", size: 4, dataUrl: "data:image/png;base64,iVBORw==" });
    expect(seen[0]!.init.credentials).toBe("omit");
    expect(seen[0]!.init.referrerPolicy).toBe("no-referrer");
  });

  test("http, outro esquema, usuário no endereço: nem pede", async () => {
    for (const url of ["http://example.com/a.png", "file:///etc/passwd", "data:image/png;base64,AA", "https://u:p@example.com/a.png", "nada"]) {
      expect(() => remoteImageUrl(url)).toThrow();
    }
    const { fetcher, seen } = fake(PNG, { "content-type": "image/png" });
    await expect(fetchRemoteImage("http://example.com/a.png", fetcher)).rejects.toThrow("only https");
    expect(seen).toHaveLength(0);
  });

  test("redirecionado para http, erro HTTP ou outro tipo: recusa", async () => {
    await expect(fetchRemoteImage("https://x.com/a.png", fake(PNG, { "content-type": "image/png" }, { url: "http://x.com/a.png" }).fetcher)).rejects.toThrow("off https");
    await expect(fetchRemoteImage("https://x.com/a.png", fake(PNG, { "content-type": "image/png" }, { status: 404 }).fetcher)).rejects.toThrow("HTTP 404");
    await expect(fetchRemoteImage("https://x.com/a.svg", fake(PNG, { "content-type": "image/svg+xml" }).fetcher)).rejects.toThrow("not an image");
    await expect(fetchRemoteImage("https://x.com/a", fake(PNG, { "content-type": "text/html" }).fetcher)).rejects.toThrow("not an image");
  });

  test("maior que o limite: para de ler", async () => {
    const big = new Uint8Array(100);
    await expect(fetchRemoteImage("https://x.com/a.png", fake(big, { "content-type": "image/png" }).fetcher, 50)).rejects.toThrow("bigger");
    await expect(fetchRemoteImage("https://x.com/a.png", fake(PNG, { "content-type": "image/png", "content-length": "999" }).fetcher, 50)).rejects.toThrow("bigger");
  });
});
