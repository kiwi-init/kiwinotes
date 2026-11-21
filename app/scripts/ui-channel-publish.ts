// Publica as UIs no canal **remoto** (spec #25011, parte 2, T25030): o release `ui-channel` do GitHub, que o app lê
// para trocar a tela sem release ("Nova aparência pronta"). Quem roda é o workflow `ui-publish.yml`; o canal local de
// dev continua no `ui-publish.ts`.
//
//   UI_SIGNING_KEY=<pem> bun scripts/ui-channel-publish.ts --out DIR --app-contract 1.95.0 --source-time 1795000000 \
//     [--previous-base https://github.com/<repo>/releases/download/ui-channel] [--base-url <mesmo>]
//
// Para cada janela de `UI_WINDOWS`, a partir do `dist/<janela>` do `ui-build.ts`, deixa em DIR, num nível só (asset de
// release não tem pasta):
// - `<janela>.manifest.json`: o manifesto assinado, com o `bundleUrl` absoluto;
// - `<uiVersion>-<sha12>.uipack`: o pack (o nome do devkit).
//
// E recusa, antes de assinar:
// - uma chave que não está em `ui-keys.ts` (o app recusaria tudo);
// - uma UI com contrato mais novo que o do app publicado (`--app-contract`, o do último `v*`): ela chamaria capacidades
//   que o app não tem. O pack leva `requiresContract: ^<contrato>`, e um app mais velho recusa antes do download;
// - uma UI de um commit que não é mais novo que o da UI no canal (`--source-time` contra o `uiVersion` publicado).
//
// A chave vem só da variável `UI_SIGNING_KEY` (o segredo da org), nunca de arquivo, e nunca é impressa.

import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync, cpSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { publish, readPreviousManifest } from "../.hutch/devkit/api/sdks/main/appengine/cli.ts";
import { keyIdFor, publicKeyFromPrivate } from "../.hutch/devkit/api/sdks/main/appengine/format.ts";
import pkg from "../package.json" with { type: "json" };
import { UI_TRUSTED_KEYS } from "../src/bun/ui-keys.ts";
import { UI_CONTRACT_VERSION, UI_WINDOWS, type UiWindow } from "../src/shared/ui-contract.ts";

/** O nome do manifesto de uma janela no release `ui-channel`. O canal do app (T25028) lê este nome. */
export function manifestAssetName(window: UiWindow): string {
  return `${window}.manifest.json`;
}

/** `1.95.0` → [1, 95, 0]. Só a forma `X.Y.Z`, como o `UI_CONTRACT_VERSION`. */
export function parseVersion(v: string): [number, number, number] {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(v.trim());
  if (!m) throw new Error(`not a X.Y.Z version: ${JSON.stringify(v)}`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

/**
 * A UI pode ir para o app publicado? Só se o contrato dela não for mais novo que o do app, na mesma major. Uma UI de
 * contrato mais novo chamaria capacidades que o app não tem; essa só chega junto com um release.
 */
export function contractError(uiContract: string, appContract: string): string | null {
  const [ua, ub, uc] = parseVersion(uiContract);
  const [aa, ab, ac] = parseVersion(appContract);
  if (ua !== aa) return `the UI contract ${uiContract} isn't the app's major (${appContract}); that needs a release`;
  if (ub > ab || (ub === ab && uc > ac)) {
    return `the UI contract ${uiContract} is newer than the published app's ${appContract}; it only ships with a release`;
  }
  return null;
}

/**
 * O `uiVersion` de um pack do canal: a versão do app, mais a hora do commit da UI (UTC, em segundos). Fica dentro do
 * manifesto assinado, e é por ela que a próxima publicação sabe se é mais nova.
 */
export function channelUiVersion(appVersion: string, sourceTimeSec: number): string {
  if (!Number.isInteger(sourceTimeSec) || sourceTimeSec <= 0) throw new Error(`bad --source-time ${sourceTimeSec}`);
  const d = new Date(sourceTimeSec * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  const stamp = `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}`;
  return `${appVersion}-ui.${stamp}`;
}

/** A hora do commit (`YYYYMMDDHHmmss`) de um `uiVersion` do canal, ou null para um que não é do canal. */
export function sourceStampOf(uiVersion: string): string | null {
  return /-ui\.(\d{14})$/.exec(uiVersion)?.[1] ?? null;
}

/** A UI nova é de um commit mais novo que a publicada? Um commit igual ou mais velho volta a tela para trás. */
export function staleError(next: string, previous: string | null): string | null {
  if (!previous) return null;
  const a = sourceStampOf(next);
  const b = sourceStampOf(previous);
  if (!a) throw new Error(`not a channel uiVersion: ${next}`);
  if (!b) return null;
  return a > b ? null : `the UI ${next} isn't newer than the published ${previous}`;
}

/** A chave assina algo que o app aceita? Uma chave fora do `ui-keys.ts` publicaria packs que todo app recusa. */
export function keyError(privateKeyPem: string, trusted: Record<string, string>): string | null {
  let publicKey: string;
  try {
    publicKey = publicKeyFromPrivate(privateKeyPem);
  } catch {
    return "UI_SIGNING_KEY isn't an Ed25519 private key (PEM)";
  }
  const id = keyIdFor(publicKey);
  return trusted[id] === publicKey ? null : `the signing key ${id} isn't in src/bun/ui-keys.ts`;
}

export type ChannelOptions = {
  distDir: string;
  outDir: string;
  privateKeyPem: string;
  appContract: string;
  sourceTimeSec: number;
  baseUrl: string;
  /** Onde ler os manifestos publicados (a URL do release, ou uma pasta nos testes). */
  previousBase?: string;
  windows?: readonly UiWindow[];
  trusted?: Record<string, string>;
  uiContract?: string;
  appVersion?: string;
  now?: number;
};

export async function publishChannel(o: ChannelOptions) {
  const keyProblem = keyError(o.privateKeyPem, o.trusted ?? UI_TRUSTED_KEYS);
  if (keyProblem) throw new Error(keyProblem);
  const uiContract = o.uiContract ?? UI_CONTRACT_VERSION;
  const contractProblem = contractError(uiContract, o.appContract);
  if (contractProblem) throw new Error(contractProblem);
  const uiVersion = channelUiVersion(o.appVersion ?? pkg.version, o.sourceTimeSec);
  const windows = o.windows ?? UI_WINDOWS;

  // Primeiro confere todas as janelas: ou o canal todo anda, ou nada sai.
  const previous = new Map<UiWindow, Awaited<ReturnType<typeof readPreviousManifest>>>();
  for (const w of windows) {
    const where = o.previousBase ? joinBase(o.previousBase, manifestAssetName(w)) : null;
    // Uma janela que nunca foi publicada: 404 na URL, ou sem o arquivo na pasta.
    const prev = where && (/^https?:\/\//i.test(where) || existsSync(where)) ? await readPreviousManifest("", where) : null;
    const stale = staleError(uiVersion, prev?.uiVersion ?? null);
    if (stale) throw new Error(`${w}: ${stale}`);
    previous.set(w, prev);
  }

  mkdirSync(o.outDir, { recursive: true });
  const out = [];
  for (const w of windows) {
    const src = path.join(o.distDir, w);
    const work = mkdtempSync(path.join(tmpdir(), `kiwinotes-ui-channel-${w}-`));
    try {
      const pack = path.join(work, "src");
      cpSync(src, pack, { recursive: true });
      const ui = JSON.parse(readFileSync(path.join(pack, "ui.json"), "utf8"));
      writeFileSync(path.join(pack, "ui.json"), JSON.stringify({ ...ui, uiVersion, requiresContract: `^${uiContract}` }));
      const site = path.join(work, "site");
      const prev = previous.get(w);
      if (prev) {
        mkdirSync(site, { recursive: true });
        writeFileSync(path.join(site, "manifest.json"), JSON.stringify(prev));
      }
      const r = await publish({ srcDir: pack, privateKeyPem: o.privateKeyPem, siteDir: site, baseUrl: o.baseUrl, flat: true, now: o.now });
      const bundle = path.basename(r.bundlePath);
      renameSync(r.bundlePath, path.join(o.outDir, bundle));
      renameSync(r.manifestPath, path.join(o.outDir, manifestAssetName(w)));
      out.push({ window: w, uiVersion: r.manifest.uiVersion, seq: r.manifest.seq, bundle, requiresContract: r.manifest.requiresContract });
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  }
  return out;
}

function joinBase(base: string, name: string): string {
  return /^https?:\/\//i.test(base) ? `${base.replace(/\/+$/, "")}/${name}` : path.join(base, name);
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const flag = (name: string) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const need = (name: string) => flag(name) ?? (console.error(`ui-channel-publish: ${name} is required`), process.exit(2));
  const key = process.env.UI_SIGNING_KEY;
  if (!key) {
    console.error("ui-channel-publish: UI_SIGNING_KEY is empty (the org secret)");
    process.exit(2);
  }
  const appDir = path.resolve(import.meta.dirname, "..");
  try {
    const published = await publishChannel({
      distDir: path.join(appDir, "dist"),
      outDir: path.resolve(need("--out")),
      privateKeyPem: key,
      appContract: need("--app-contract"),
      sourceTimeSec: Number(need("--source-time")),
      baseUrl: need("--base-url"),
      previousBase: flag("--previous-base"),
    });
    for (const p of published) console.log(`ui-channel-publish: ${p.window} ${p.uiVersion} seq ${p.seq} ${p.requiresContract} → ${p.bundle}`);
  } catch (e) {
    console.error(`ui-channel-publish: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  }
}
