// Um registro do npm falso, local (spec #8368): os testes do download nunca vão à internet. Ele monta .tgz de verdade
// (com o `tar` do macOS, na pasta `package/` como o npm) e serve em `<url>/<nome>/-/<nome sem escopo>-<versão>.tgz`.
// Conta os pedidos e guarda os cabeçalhos, para os testes provarem que nada da pessoa vai junto.

import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { integrityOf } from "../adapter/download.ts";
import { tarballUrl, type PinnedPackage } from "../adapter/pinned.ts";

export interface FakePackage {
  name: string;
  version: string;
  /** Arquivos além do `package.json`, relativos à pasta do pacote (bytes aleatórios não comprimem: o .tgz fica grande). */
  files?: Record<string, string | Uint8Array>;
  /** O `package.json` que vai dentro (o padrão diz o mesmo nome e versão). */
  manifest?: Record<string, unknown>;
}

/** Monta o .tgz de um pacote, como o npm publica. */
export function packTarball(p: FakePackage): Uint8Array {
  const dir = mkdtempSync(path.join(tmpdir(), "kiwi-fake-pkg-"));
  try {
    const root = path.join(dir, "package");
    mkdirSync(root, { recursive: true });
    writeFileSync(path.join(root, "package.json"), JSON.stringify(p.manifest ?? { name: p.name, version: p.version }));
    for (const [rel, body] of Object.entries(p.files ?? {})) {
      mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
      writeFileSync(path.join(root, rel), body);
    }
    const out = path.join(dir, "p.tgz");
    const r = spawnSync("/usr/bin/tar", ["-czf", out, "-C", dir, "package"], { encoding: "utf8" });
    if (r.status !== 0) throw new Error(`tar: ${r.stderr}`);
    return new Uint8Array(readFileSync(out));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export interface FakeRegistry {
  url: string;
  /** A lista "fixa" que confere com o que ele serve. */
  pinned: PinnedPackage[];
  /** Troca o que ele serve para um pacote (por exemplo, um .tgz adulterado), sem mexer na lista fixa. */
  serve(name: string, bytes: Uint8Array | null): void;
  requests: { path: string; headers: Record<string, string> }[];
  stop(): void;
}

export interface FakeRegistryOptions {
  /** Serve cada .tgz em pedaços de `chunk` bytes, com `delayMs` entre eles: o progresso anda aos poucos, e dá tempo de cancelar. */
  slow?: { chunk: number; delayMs: number };
}

export function fakeRegistry(packages: FakePackage[], opts: FakeRegistryOptions = {}): FakeRegistry {
  const bodies = new Map<string, Uint8Array | null>();
  const pinned: PinnedPackage[] = [];
  const requests: FakeRegistry["requests"] = [];
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch(req) {
      const u = new URL(req.url);
      requests.push({ path: u.pathname, headers: Object.fromEntries(req.headers.entries()) });
      const body = bodies.get(u.pathname);
      if (!body) return new Response("not found", { status: 404 });
      const slow = opts.slow;
      if (!slow) return new Response(body as unknown as BodyInit);
      let at = 0;
      const stream = new ReadableStream<Uint8Array>({
        async pull(controller) {
          if (at >= body.byteLength) return controller.close();
          await Bun.sleep(slow.delayMs);
          controller.enqueue(body.slice(at, at + slow.chunk));
          at += slow.chunk;
        },
      });
      return new Response(stream, { headers: { "content-length": String(body.byteLength) } });
    },
  });
  const url = `http://127.0.0.1:${server.port}`;
  const pathOf = (name: string, version: string) => new URL(tarballUrl({ name, version }, url)).pathname;
  for (const p of packages) {
    const bytes = packTarball(p);
    bodies.set(pathOf(p.name, p.version), bytes);
    pinned.push({ name: p.name, version: p.version, integrity: integrityOf(bytes), license: "MIT", size: bytes.byteLength });
  }
  return {
    url,
    pinned,
    requests,
    serve(name, bytes) {
      const p = pinned.find((x) => x.name === name)!;
      bodies.set(pathOf(p.name, p.version), bytes);
    },
    stop() {
      server.stop(true);
    },
  };
}
