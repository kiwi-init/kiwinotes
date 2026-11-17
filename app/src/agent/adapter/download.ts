// O download do adaptador do Claude Code (spec #8368, ADR 0011 e 0012).
//
// - **Só a pedido.** Nada aqui roda sozinho: quem chama é a CLI (`bun run cli agent download`) e, depois, o clique da
//   pessoa em Ajustes › Agente.
// - **A lista fixa** (`pinned.ts`): cada .tgz é conferido contra o `integrity` antes de ir para o disco. Um que chega
//   diferente é recusado, e nada fica instalado: a pasta de trabalho do download é apagada.
// - **Sem a cópia do Claude Code** que o SDK traria como dependência opcional: ela não está na lista.
// - **Tudo ou nada.** Os pacotes abrem numa pasta `.part`, que só vira a pasta da versão no fim, com um marcador.
// - **A única ida à rede** é pedir os .tgz. Nada da pessoa vai junto: é um GET sem cookie nem conta.

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import { AgentError } from "../errors.ts";
import { ADAPTER_PACKAGE, ADAPTER_PACKAGES, ADAPTER_VERSION, NPM_REGISTRY, tarballUrl, type PinnedPackage } from "./pinned.ts";

/** O marcador que diz que a pasta da versão está completa. */
const MARKER = "kiwi-adapter.json";
/** O prazo de cada pacote. O maior tem uns 3 MB. */
const PACKAGE_TIMEOUT_MS = 120_000;

export interface AdapterLocation {
  /** `<dados>/agent/adapter`: todas as versões baixadas ficam aqui, e remover o adaptador é apagar esta pasta. */
  root: string;
  version?: string;
}

/** A pasta de uma versão do adaptador. */
export function adapterDir(o: AdapterLocation): string {
  return path.join(o.root, o.version ?? ADAPTER_VERSION);
}

/** O programa do adaptador dentro da pasta da versão. */
export function adapterEntry(dir: string): string {
  return path.join(dir, "node_modules", ADAPTER_PACKAGE, "dist", "index.js");
}

/** A pasta da versão, se ela está completa (o marcador da mesma lista e o programa no lugar); senão, null. */
export function installedAdapter(o: AdapterLocation, packages: readonly PinnedPackage[] = ADAPTER_PACKAGES): string | null {
  const dir = adapterDir(o);
  try {
    const marker = JSON.parse(readFileSync(path.join(dir, MARKER), "utf8")) as { packages?: { name: string; integrity: string }[] };
    const same =
      marker.packages?.length === packages.length &&
      packages.every((p) => marker.packages!.some((m) => m.name === p.name && m.integrity === p.integrity));
    return same && existsSync(adapterEntry(dir)) ? dir : null;
  } catch {
    return null;
  }
}

export interface DownloadOptions extends AdapterLocation {
  /** O registro do npm (nos testes, um servidor local falso). */
  registry?: string;
  packages?: readonly PinnedPackage[];
  fetch?: typeof fetch;
  agentName?: string;
  /** Avisa cada pacote baixado. */
  onPackage?: (p: { name: string; version: string; bytes: number }) => void;
  /** O progresso em bytes, a cada pedaço que chega (T8678): `total` é a soma dos `size` da lista. */
  onProgress?: (p: { done: number; total: number }) => void;
  /** Cancela o download: a pasta `.part` é apagada e nada fica instalado (`E_ADAPTER_CANCELLED`). */
  signal?: AbortSignal;
}

export interface DownloadResult {
  dir: string;
  /** `true` quando ela já estava baixada e nada foi à rede. */
  already: boolean;
  packages: { name: string; version: string; bytes: number }[];
}

/** O sha512 de um arquivo, no formato do `integrity` do npm (`sha512-<base64>`). */
export function integrityOf(bytes: Uint8Array): string {
  return `sha512-${new Bun.CryptoHasher("sha512").update(bytes).digest("base64")}`;
}

/** Baixa e confere a lista fixa. Devolve a pasta pronta, ou lança um `AgentError` sem deixar nada pela metade. */
export async function downloadAdapter(o: DownloadOptions): Promise<DownloadResult> {
  const packages = o.packages ?? ADAPTER_PACKAGES;
  const name = o.agentName ?? "Claude Code";
  const ready = installedAdapter(o, packages);
  if (ready) return { dir: ready, already: true, packages: [] };

  const dir = adapterDir(o);
  mkdirSync(o.root, { recursive: true, mode: 0o700 });
  const part = `${dir}.part-${process.pid}-${Date.now()}`;
  const got: DownloadResult["packages"] = [];
  const total = packages.reduce((sum, p) => sum + p.size, 0);
  let before = 0;
  try {
    mkdirSync(path.join(part, "node_modules"), { recursive: true, mode: 0o700 });
    o.onProgress?.({ done: 0, total });
    for (const pkg of packages) {
      if (o.signal?.aborted) throw new AgentError("E_ADAPTER_CANCELLED", name);
      const bytes = await fetchPackage(pkg, o.registry ?? NPM_REGISTRY, o.fetch ?? fetch, name, o.signal, (n) =>
        o.onProgress?.({ done: Math.min(before + n, total), total }),
      );
      before += bytes.byteLength;
      const actual = integrityOf(bytes);
      if (actual !== pkg.integrity) {
        throw new AgentError("E_ADAPTER_TAMPERED", name, `${pkg.name}@${pkg.version}: esperado ${pkg.integrity}, chegou ${actual}`);
      }
      unpack(pkg, bytes, part, name);
      got.push({ name: pkg.name, version: pkg.version, bytes: bytes.byteLength });
      o.onPackage?.(got[got.length - 1]!);
    }
    writeFileSync(
      path.join(part, MARKER),
      JSON.stringify({ adapter: ADAPTER_PACKAGE, version: o.version ?? ADAPTER_VERSION, packages: packages.map(({ name, version, integrity }) => ({ name, version, integrity })) }, null, 2) + "\n",
      { mode: 0o600 },
    );
    if (o.signal?.aborted) throw new AgentError("E_ADAPTER_CANCELLED", name);
    rmSync(dir, { recursive: true, force: true });
    renameSync(part, dir);
  } catch (e) {
    rmSync(part, { recursive: true, force: true });
    throw e;
  }
  // As versões antigas (de um Kiwi anterior) e restos de downloads que caíram no meio saem.
  for (const entry of readdirSync(o.root)) {
    if (entry !== path.basename(dir)) rmSync(path.join(o.root, entry), { recursive: true, force: true });
  }
  return { dir, already: false, packages: got };
}

/** Remove o adaptador baixado (a pessoa desligou o agente e pediu para remover). */
export function removeAdapter(o: Pick<AdapterLocation, "root">): void {
  rmSync(o.root, { recursive: true, force: true });
}

async function fetchPackage(
  pkg: PinnedPackage,
  registry: string,
  fetcher: typeof fetch,
  name: string,
  cancel: AbortSignal | undefined,
  progress: (bytes: number) => void,
): Promise<Uint8Array> {
  const url = tarballUrl(pkg, registry);
  const signal = cancel ? AbortSignal.any([cancel, AbortSignal.timeout(PACKAGE_TIMEOUT_MS)]) : AbortSignal.timeout(PACKAGE_TIMEOUT_MS);
  const failed = (e: unknown) =>
    cancel?.aborted
      ? new AgentError("E_ADAPTER_CANCELLED", name)
      : new AgentError("E_ADAPTER_OFFLINE", name, `${url}: ${String((e as Error)?.message ?? e)}`);
  let res: Response;
  try {
    res = await fetcher(url, { signal, redirect: "follow" });
  } catch (e) {
    throw failed(e);
  }
  if (!res.ok) throw new AgentError("E_ADAPTER_DOWNLOAD", name, `${url}: HTTP ${res.status}`);
  // Lido aos pedaços, para o progresso andar dentro de um pacote e o cancelar parar no meio dele.
  const chunks: Uint8Array[] = [];
  let got = 0;
  try {
    const reader = res.body!.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      got += value.byteLength;
      progress(got);
    }
  } catch (e) {
    throw failed(e);
  }
  const bytes = new Uint8Array(got);
  let at = 0;
  for (const c of chunks) {
    bytes.set(c, at);
    at += c.byteLength;
  }
  return bytes;
}

/**
 * Abre o .tgz (já conferido) em `node_modules/<nome>`, tirando a pasta de cima (`package/` no npm). O `tar` do macOS
 * não segue caminhos absolutos nem `..` sem o `-P`.
 */
function unpack(pkg: PinnedPackage, bytes: Uint8Array, part: string, name: string): void {
  const dest = path.join(part, "node_modules", pkg.name);
  mkdirSync(dest, { recursive: true, mode: 0o700 });
  const tgz = path.join(part, `${pkg.name.replace(/[/@]/g, "_")}.tgz`);
  writeFileSync(tgz, bytes, { mode: 0o600 });
  const r = spawnSync("/usr/bin/tar", ["-xzf", tgz, "-C", dest, "--strip-components", "1"], { encoding: "utf8" });
  rmSync(tgz, { force: true });
  if (r.status !== 0) throw new AgentError("E_ADAPTER_DOWNLOAD", name, `${pkg.name}: o tar falhou: ${r.stderr}`);
  let manifest: { name?: unknown; version?: unknown };
  try {
    manifest = JSON.parse(readFileSync(path.join(dest, "package.json"), "utf8"));
  } catch {
    throw new AgentError("E_ADAPTER_TAMPERED", name, `${pkg.name}: sem package.json`);
  }
  if (manifest.name !== pkg.name || manifest.version !== pkg.version) {
    throw new AgentError("E_ADAPTER_TAMPERED", name, `${pkg.name}: o package.json diz ${String(manifest.name)}@${String(manifest.version)}`);
  }
}
