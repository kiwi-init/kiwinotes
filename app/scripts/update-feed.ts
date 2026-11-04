// O feed do Updater (T1969, ADR 0008): o manifesto que o release publica e o endereço de onde o app o lê.
//
// - **O manifesto** é o `stable-macos-arm64-update.json` do build do Electrobun, conferido contra o app que o release
//   assinou: o mesmo identificador, canal e hash. O Updater só aceita um tar cujo nome comece pelo prefixo da
//   plataforma (`stable-macos-arm64-`), e o app confere a assinatura do que baixou antes de oferecer.
// - **O endereço** (`KIWI_UPDATE_URL`, que vira o `release.baseUrl` do build) vem do tag:
//   - versão final (`v0.2.0`): `releases/latest/download`, o release mais novo que não é prerelease;
//   - rc (`v0.2.0-rc3`): `releases/download/updates-rc`, um release fixo que o publish sobrescreve a cada rc e a cada
//     versão final. Assim quem testa as rc recebe a rc seguinte e, depois, a versão final; e quem está numa versão
//     final nunca recebe uma rc.
//
//   bun scripts/update-feed.ts url <tag> <owner/repo>     # o KIWI_UPDATE_URL do build

export const RC_FEED_TAG = "updates-rc";

export interface UpdateManifest {
  schemaVersion: 1;
  identifier: string;
  channel: string;
  version: string;
  hash: string;
  platform: string;
  arch: string;
  artifact: { file: string };
}

/** O endereço do feed para o build de um tag, ou "" fora de um tag de versão (ensaio). */
export function feedUrl(tag: string, repo: string): string {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new Error(`update-feed: ${repo} isn't owner/repo`);
  const m = /^v\d+\.\d+\.\d+(-[0-9A-Za-z.]+)?$/.exec(tag);
  if (!m) return "";
  return m[1] ? `https://github.com/${repo}/releases/download/${RC_FEED_TAG}` : `https://github.com/${repo}/releases/latest/download`;
}

/** O manifesto do build, conferido contra o version.json do app assinado. Lança se não bate. */
export function updateManifest(built: unknown, app: Record<string, unknown>): UpdateManifest {
  const m = built as Partial<UpdateManifest>;
  if (!m || m.schemaVersion !== 1 || typeof m.artifact?.file !== "string") throw new Error("update-feed: the built update.json isn't schemaVersion 1");
  for (const key of ["identifier", "channel", "version", "hash"] as const) {
    if (typeof m[key] !== "string" || m[key] !== app[key]) {
      throw new Error(`update-feed: update.json says ${key} ${String(m[key])}, the signed app says ${String(app[key])}`);
    }
  }
  if (m.channel !== "stable") throw new Error(`update-feed: channel ${m.channel}, the release is stable`);
  if (m.platform !== "macos" || m.arch !== "arm64") throw new Error(`update-feed: ${m.platform}/${m.arch}, not macos/arm64`);
  const prefix = `${m.channel}-${m.platform}-${m.arch}-`;
  if (!m.artifact.file.startsWith(prefix) || !m.artifact.file.endsWith(".tar.zst") || /[/\\]/.test(m.artifact.file)) {
    throw new Error(`update-feed: artifact ${m.artifact.file} isn't a ${prefix}*.tar.zst`);
  }
  if (typeof app.baseUrl !== "string" || !app.baseUrl.startsWith("https://")) {
    console.warn(`update-feed: the app has no https baseUrl (${String(app.baseUrl)}): it won't check for updates`);
  }
  return {
    schemaVersion: 1,
    identifier: m.identifier!,
    channel: m.channel,
    version: m.version!,
    hash: m.hash!,
    platform: m.platform,
    arch: m.arch,
    artifact: { file: m.artifact.file },
  };
}

if (import.meta.main) {
  const [cmd, tag, repo] = process.argv.slice(2);
  if (cmd !== "url" || tag === undefined || !repo) {
    console.error("usage: bun scripts/update-feed.ts url <tag> <owner/repo>");
    process.exit(2);
  }
  console.log(feedUrl(tag, repo));
}
