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

  test("cada redirecionamento é conferido: http ou rede local no meio recusa; https segue, até 5", async () => {
    const chain = (hops: Record<string, string>) => {
      const seen: string[] = [];
      const fetcher = async (url: string, init: RequestInit) => {
        seen.push(url);
        expect(init.redirect).toBe("manual");
        const to = hops[url];
        return to ? new Response(null, { status: 302, headers: { location: to } }) : new Response(PNG as BodyInit, { headers: { "content-type": "image/png" } });
      };
      return { fetcher, seen };
    };
    const ok = chain({ "https://a.com/1.png": "/2.png", "https://a.com/2.png": "https://b.com/3.png" });
    expect((await fetchRemoteImage("https://a.com/1.png", ok.fetcher)).mime).toBe("image/png");
    expect(ok.seen).toEqual(["https://a.com/1.png", "https://a.com/2.png", "https://b.com/3.png"]);
    const viaHttp = chain({ "https://a.com/1.png": "http://a.com/2.png", "http://a.com/2.png": "https://a.com/3.png" });
    await expect(fetchRemoteImage("https://a.com/1.png", viaHttp.fetcher)).rejects.toThrow("redirect refused");
    expect(viaHttp.seen).toEqual(["https://a.com/1.png"]);
    await expect(fetchRemoteImage("https://a.com/1.png", chain({ "https://a.com/1.png": "https://192.168.0.1/x.png" }).fetcher)).rejects.toThrow("local network");
    const loop = chain(Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`https://a.com/${i}.png`, `https://a.com/${i + 1}.png`])));
    await expect(fetchRemoteImage("https://a.com/0.png", loop.fetcher)).rejects.toThrow("too many redirects");
  });

  test("rede local e a própria máquina: nem pede", () => {
    for (const url of ["https://localhost/a.png", "https://127.0.0.1/a.png", "https://10.0.0.2/a.png", "https://172.20.1.1/a.png", "https://192.168.1.10/a.png", "https://169.254.169.254/a.png", "https://impressora.local/a.png", "https://[::1]/a.png", "https://[fd00::1]/a.png", "https://intranet/a.png"]) {
      expect(() => remoteImageUrl(url)).toThrow("local network");
    }
    for (const url of ["https://example.com/a.png", "https://8.8.8.8/a.png", "https://172.32.0.1/a.png"]) expect(remoteImageUrl(url).href).toBe(url);
  });

  test("erro HTTP ou outro tipo: recusa", async () => {
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
