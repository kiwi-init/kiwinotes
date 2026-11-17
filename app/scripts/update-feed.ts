// O feed do Updater (T1969, ADR 0008): o manifesto que o release publica e o endereço de onde o app o lê.
//
// - **O manifesto** é o `stable-macos-arm64-update.json` do build do Electrobun, conferido contra o app que o release
//   assinou: o mesmo identificador, canal e hash. O Updater só aceita um tar cujo nome comece pelo prefixo da
//   plataforma (`stable-macos-arm64-`), e o app confere a assinatura do que baixou antes de oferecer.
// - **A versão** vem do tag, no formato do Channels (spec #13879): `vANO.MÊS.N`, em que o N conta os releases do mês
//   (`v2026.11.1`, `v2026.11.2`, `v2026.12.1`). O release se chama "Kiwi Notes 2026.11.1". Não há mais rc.
// - **O endereço** (`KIWI_UPDATE_URL`, que vira o `release.baseUrl` do build) é o `releases/latest/download`, o release
//   mais novo que não é prerelease.
// - **O feed antigo das rc** (`updates-rc`): as rc instaladas (até a rc19) leem dele. O publish segue sobrescrevendo
//   ele a cada release, para quem está numa rc receber a versão nova; daí em diante, o app lê o `latest`.
//
//   bun scripts/update-feed.ts url <tag> <owner/repo>     # o KIWI_UPDATE_URL do build
//   bun scripts/update-feed.ts version <tag>              # o KIWI_VERSION do build (`v2026.11.1` → `2026.11.1`)
//   bun scripts/update-feed.ts name <tag>                 # o nome do release (`Kiwi Notes 2026.11.1`)
//   bun scripts/update-feed.ts next <AAAA-MM> [tags…]     # o tag do próximo release do mês, pelos tags que já existem

/** O feed antigo das rc: só o publish escreve nele, para as rc instaladas chegarem à versão nova. */
export const RC_FEED_TAG = "updates-rc";

/** O tag de um release: `vANO.MÊS.N`, com o mês de 1 a 12 e o N a partir de 1, sem zero à esquerda. */
const RELEASE_TAG = /^v(20\d\d)\.([1-9]|1[0-2])\.([1-9]\d*)$/;

/** Se o tag é de um release (`v2026.11.1`). Um `v0.1.0-rc19` ou um `v0.2.0` não é mais. */
export function isReleaseTag(tag: string): boolean {
  return RELEASE_TAG.test(tag);
}

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

/** O endereço do feed para o build de um tag, ou "" fora de um tag de release (ensaio). */
export function feedUrl(tag: string, repo: string): string {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new Error(`update-feed: ${repo} isn't owner/repo`);
  return isReleaseTag(tag) ? `https://github.com/${repo}/releases/latest/download` : "";
}

/** A versão do app para o build de um tag (`v2026.11.1` → `2026.11.1`), ou "" fora de um tag de release. */
export function tagVersion(tag: string): string {
  return isReleaseTag(tag) ? tag.slice(1) : "";
}

/** O nome do release, como no Channels: "Kiwi Notes 2026.11.1". */
export function releaseName(tag: string): string {
  if (!isReleaseTag(tag)) throw new Error(`update-feed: ${tag} isn't vANO.MÊS.N`);
  return `Kiwi Notes ${tag.slice(1)}`;
}

/** O tag do próximo release do mês (`2026-11` e os tags que existem → `v2026.11.3`): o N conta os releases do mês. */
export function nextTag(month: string, tags: readonly string[]): string {
  const m = /^(20\d\d)-(0[1-9]|1[0-2])$/.exec(month);
  if (!m) throw new Error(`update-feed: ${month} isn't AAAA-MM`);
  const prefix = `v${m[1]}.${Number(m[2])}.`;
  const n = tags.filter((t) => isReleaseTag(t) && t.startsWith(prefix)).map((t) => Number(t.slice(prefix.length)));
  return `${prefix}${Math.max(0, ...n) + 1}`;
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
  const [cmd, tag, ...rest] = process.argv.slice(2);
  if (cmd === "version" && tag !== undefined) console.log(tagVersion(tag));
  else if (cmd === "url" && tag !== undefined && rest[0]) console.log(feedUrl(tag, rest[0]));
  else if (cmd === "name" && tag !== undefined) console.log(releaseName(tag));
  else if (cmd === "next" && tag !== undefined) console.log(nextTag(tag, rest));
  else {
    console.error("usage: bun scripts/update-feed.ts url <tag> <owner/repo> | version <tag> | name <tag> | next <AAAA-MM> [tags…]");
    process.exit(2);
  }
}
