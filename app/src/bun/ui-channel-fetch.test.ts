// T25029 (spec #25011): a prova de que o canal remoto de UI não leva nada da pessoa. Sem rede: o `inner` é um GitHub
// de mentira, que responde pelas URLs do release e anota cada pedido que chegaria à rede.

import { afterEach, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import path from "node:path";

import { buildUipack, generateSigningKey, signManifest, UiChannel, type UiManifest, uipackFileName } from "electrobun/bun/appengine";

import { tempDir } from "../../test/tmp.ts";
import { channelUrlRefusal, redirectRefusal, UI_CHANNEL_BASE, UI_CHANNEL_MAX_REDIRECTS, uiChannelFetch } from "./ui-channel-fetch.ts";

const STORAGE = "https://release-assets.githubusercontent.com/github-production-release-asset/1/abc?parte=1";

/** Um pedido como ele chegaria à rede: tudo o que sai do Mac. */
interface Sent {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
  credentials: string | undefined;
  redirect: string | undefined;
  referrerPolicy: string | undefined;
}

/** O GitHub de mentira: `routes` dá a resposta de cada URL; o que não está lá é 404. */
function fakeNet(routes: Record<string, () => Response> = {}) {
  const sent: Sent[] = [];
  const inner = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    sent.push({
      url,
      method: init?.method ?? "GET",
      headers: Object.fromEntries(new Headers(init?.headers)),
      body: init?.body,
      credentials: init?.credentials,
      redirect: init?.redirect,
      referrerPolicy: init?.referrerPolicy,
    });
    return routes[url]?.() ?? new Response("none", { status: 404 });
  }) as typeof fetch;
  return { sent, inner };
}

const redirect = (to: string, status = 302) => () => new Response(null, { status, headers: { location: to } });

describe("o fetch do canal: só o release ui-channel (T25029)", () => {
  test("o pedido do manifesto é um GET da URL fixa, e nada da pessoa vai junto", async () => {
    const net = fakeNet({ [`${UI_CHANNEL_BASE}notes.manifest.json`]: () => Response.json({ ok: true }) });
    const res = await uiChannelFetch(net.inner)(`${UI_CHANNEL_BASE}notes.manifest.json`, { cache: "no-store", signal: AbortSignal.timeout(5_000) });
    expect(res.status).toBe(200);
    expect(net.sent).toEqual([
      {
        url: `${UI_CHANNEL_BASE}notes.manifest.json`,
        method: "GET",
        headers: {},
        body: undefined,
        credentials: "omit",
        redirect: "manual",
        referrerPolicy: "no-referrer",
      },
    ]);
  });

  test("o SSE leva só o accept; outro cabeçalho, um corpo ou outro método não saem", async () => {
    const net = fakeNet({ [`${UI_CHANNEL_BASE}events`]: () => new Response("") });
    const f = uiChannelFetch(net.inner);
    await f(`${UI_CHANNEL_BASE}events`, { headers: { accept: "text/event-stream" } });
    expect(net.sent.map((s) => s.headers)).toEqual([{ accept: "text/event-stream" }]);

    const url = `${UI_CHANNEL_BASE}notes.manifest.json`;
    await expect(f(url, { headers: { cookie: "sessao=exemplo" } })).rejects.toThrow("cookie");
    await expect(f(url, { headers: { "x-kiwi-id": "exemplo" } })).rejects.toThrow("x-kiwi-id");
    await expect(f(url, { headers: { authorization: "nada" } })).rejects.toThrow("authorization");
    await expect(f(url, { method: "POST" })).rejects.toThrow("só faz GET");
    await expect(f(url, { body: "nota" })).rejects.toThrow("corpo");
    await expect(f(new Request(url))).rejects.toThrow("Request");
    expect(net.sent).toHaveLength(1);
  });

  test("outro host, outro release, uma query ou uma porta são recusados antes de sair", async () => {
    const net = fakeNet();
    const f = uiChannelFetch(net.inner);
    for (const url of [
      "https://exemplo.invalid/ui-channel/notes.manifest.json",
      "http://github.com/kiwi-init/kiwinotes/releases/download/ui-channel/notes.manifest.json",
      "https://github.com/kiwi-init/kiwinotes/releases/download/v2026.11.1/notes.manifest.json",
      "https://github.com/outra-org/kiwinotes/releases/download/ui-channel/notes.manifest.json",
      "https://github.com/kiwi-init/kiwinotes/releases/download/ui-channel/../v2026.11.1/notes.uipack",
      "https://github.com/kiwi-init/kiwinotes/releases/download/ui-channel/%2e%2e/v2026.11.1/notes.uipack",
      `${UI_CHANNEL_BASE}notes.manifest.json?nota=exemplo`,
      `${UI_CHANNEL_BASE}notes.manifest.json#pasta`,
      "https://ana@github.com/kiwi-init/kiwinotes/releases/download/ui-channel/notes.manifest.json",
      "https://github.com:8443/kiwi-init/kiwinotes/releases/download/ui-channel/notes.manifest.json",
      "https://github.com.exemplo.invalid/kiwi-init/kiwinotes/releases/download/ui-channel/notes.manifest.json",
      "http://127.0.0.1:5179/notes/manifest.json",
      "file:///etc/hosts",
      UI_CHANNEL_BASE,
    ]) {
      await expect(f(url)).rejects.toThrow();
    }
    expect(net.sent).toEqual([]);
  });

  test("o redirect só vai ao armazenamento do GitHub, por https, e no máximo 5 vezes", async () => {
    const asset = `${UI_CHANNEL_BASE}notes-0.2.1.uipack`;
    const ok = fakeNet({ [asset]: redirect(STORAGE), [STORAGE]: () => new Response("bytes") });
    expect(await (await uiChannelFetch(ok.inner)(asset)).text()).toBe("bytes");
    expect(ok.sent.map((s) => [s.url, s.redirect, s.credentials])).toEqual([
      [asset, "manual", "omit"],
      [STORAGE, "manual", "omit"],
    ]);

    for (const to of [
      "https://exemplo.invalid/coleta?nota=exemplo",
      "http://release-assets.githubusercontent.com/x",
      "https://release-assets.githubusercontent.com:8443/x",
      "https://ana@objects.githubusercontent.com/x",
      "https://github.com/kiwi-init/kiwinotes/releases/download/v2026.11.1/notes.uipack",
      "/kiwi-init/kiwinotes/releases/download/v2026.11.1/notes.uipack",
    ]) {
      const net = fakeNet({ [asset]: redirect(to), [to]: () => new Response("não devia chegar") });
      await expect(uiChannelFetch(net.inner)(asset)).rejects.toThrow("redirect");
      expect(net.sent.map((s) => s.url)).toEqual([asset]);
    }

    // Um laço no armazenamento: para no 5º.
    const loop: Record<string, () => Response> = { [asset]: redirect(`${STORAGE}&n=0`) };
    for (let i = 0; i <= UI_CHANNEL_MAX_REDIRECTS + 1; i++) loop[`${STORAGE}&n=${i}`] = redirect(`${STORAGE}&n=${i + 1}`);
    const net = fakeNet(loop);
    await expect(uiChannelFetch(net.inner)(asset)).rejects.toThrow(`mais de ${UI_CHANNEL_MAX_REDIRECTS} redirects`);
    expect(net.sent).toHaveLength(UI_CHANNEL_MAX_REDIRECTS + 1);
  });

  test("as recusas, uma a uma", () => {
    expect(channelUrlRefusal(new URL(`${UI_CHANNEL_BASE}notes.manifest.json`))).toBeNull();
    expect(channelUrlRefusal(new URL(`${UI_CHANNEL_BASE}notes.manifest.json?x=1`))).toContain("query");
    expect(redirectRefusal(new URL(STORAGE))).toBeNull();
    expect(redirectRefusal(new URL("https://objects.githubusercontent.com/x"))).toBeNull();
    expect(redirectRefusal(new URL("https://githubusercontent.com/x"))).toContain("outro host");
  });
});

// ---------------------------------------------------------------- com o canal do AppEngine de verdade

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const fn of cleanups.splice(0)) fn();
});

const key = generateSigningKey();

/** Um manifesto assinado pela nossa chave, com o pack no release ou em `bundleUrl`. */
function publish(seq: number, bundleUrl?: string) {
  const uiVersion = `0.2.${seq}`;
  const { bytes, sha256 } = buildUipack(uiVersion, new Map([["index.html", new TextEncoder().encode(`<p>${seq}</p>`)]]));
  const name = uipackFileName(uiVersion, sha256);
  const manifest: UiManifest = signManifest(
    { format: "livewire-manifest/1", keyId: key.keyId, seq, uiVersion, bundleUrl: bundleUrl ?? name, sha256, requiresContract: "^1.0.0", dataSchema: 1, publishedAt: Date.now() },
    key.privateKeyPem,
  );
  return { manifest, bytes, name };
}

function channelWith(inner: typeof fetch) {
  const dir = tempDir("kiwinotes-ui-channel-fetch-");
  const channel = new UiChannel({
    manifestUrl: `${UI_CHANNEL_BASE}notes.manifest.json`,
    trustedKeys: { [key.keyId]: key.publicKey },
    root: path.join(dir, "packs"),
    appdataRoot: path.join(dir, "appdata"),
    stateFile: path.join(dir, "channel.json"),
    fetch: uiChannelFetch(inner),
  });
  cleanups.push(() => {
    channel.stop();
    rmSync(dir, { recursive: true, force: true });
  });
  return channel;
}

describe("o canal do AppEngine pelo fetch guardado (T25029)", () => {
  test("baixa o manifesto e o pack do release, pelo armazenamento do GitHub, e só isso sai", async () => {
    const pub = publish(2);
    const asset = `${UI_CHANNEL_BASE}${pub.name}`;
    const net = fakeNet({
      [`${UI_CHANNEL_BASE}notes.manifest.json`]: () => Response.json(pub.manifest),
      [asset]: redirect(STORAGE),
      [STORAGE]: () => new Response(new Blob([pub.bytes as Uint8Array<ArrayBuffer>])),
    });
    expect(await channelWith(net.inner).check()).toMatchObject({ result: "available" });
    expect(net.sent.map((s) => s.url)).toEqual([`${UI_CHANNEL_BASE}notes.manifest.json`, asset, STORAGE]);
    for (const s of net.sent) {
      expect(s).toMatchObject({ method: "GET", body: undefined, credentials: "omit", redirect: "manual", referrerPolicy: "no-referrer" });
      expect(Object.keys(s.headers)).toEqual([]);
    }
  });

  test("um manifesto assinado que aponta o pack para outro host é recusado, e nada vai para lá", async () => {
    const pub = publish(3, "https://exemplo.invalid/coleta.uipack");
    const net = fakeNet({
      [`${UI_CHANNEL_BASE}notes.manifest.json`]: () => Response.json(pub.manifest),
      "https://exemplo.invalid/coleta.uipack": () => new Response(new Blob([pub.bytes as Uint8Array<ArrayBuffer>])),
    });
    const result = await channelWith(net.inner).check();
    expect(result).toMatchObject({ result: "refused" });
    expect((result as { reason: string }).reason).toContain("fora do release ui-channel");
    expect(net.sent.map((s) => s.url)).toEqual([`${UI_CHANNEL_BASE}notes.manifest.json`]);
  });
});
