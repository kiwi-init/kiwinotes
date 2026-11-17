// As notas de um release no formato do Channels (spec #13879): os PRs que entraram desde o release anterior, um por
// linha, com o título em negrito e o link do PR, do mais novo para o mais velho, e um rodapé que diz onde baixar e como
// conferir os arquivos. É o mesmo formato do CHANGELOG.md.
//
// A `main` só muda por PR com squash, então cada commit é "Título do PR (#N)". O publish do `release.yml` pega os
// commits pela API de compare do GitHub (sem o histórico inteiro no runner) e passa os assuntos aqui, um por linha:
//
//   gh api repos/<owner/repo>/compare/<anterior>...<tag> --paginate --jq '.commits[].commit.message | split("\n")[0]' \
//     | bun scripts/release-notes.ts <owner/repo> <tag> <anterior>

/** Um commit do squash: o título e o número do PR. Sem o "(#N)" no fim, só o título (um commit direto, raro). */
function parse(subject: string): { title: string; pr: number | null } {
  const m = /^(.*\S)\s+\(#(\d+)\)$/.exec(subject.trim());
  return m ? { title: m[1]!, pr: Number(m[2]) } : { title: subject.trim(), pr: null };
}

/**
 * O corpo das notas. `subjects` vem na ordem da API (do mais velho para o mais novo); sai do mais novo para o mais
 * velho, como no CHANGELOG.
 */
export function releaseNotes(o: { repo: string; tag: string; previous: string; subjects: readonly string[] }): string {
  if (!/^[\w.-]+\/[\w.-]+$/.test(o.repo)) throw new Error(`release-notes: ${o.repo} isn't owner/repo`);
  const lines = o.subjects
    .map((s) => s.trim())
    .filter(Boolean)
    .reverse()
    .map(parse)
    .map(({ title, pr }) => (pr === null ? `- **${title}**` : `- **${title}** ([#${pr}](https://github.com/${o.repo}/pull/${pr}))`));
  const version = o.tag.replace(/^v/, "");
  return [
    "## O que entrou",
    "",
    ...(lines.length ? lines : ["- Nenhum PR desde o release anterior."]),
    "",
    "---",
    "",
    `**Para baixar:** o \`.dmg\` em Assets, abaixo, é o Kiwi Notes ${version} para Mac com Apple Silicon. Quem já tem o Kiwi Notes recebe esta versão sozinho, pelo menu.`,
    "",
    `**Para conferir:** o app é assinado com o Developer ID da Kiwi Init e notarizado pela Apple. No Terminal, \`spctl -a -vv "/Applications/Kiwi Notes.app"\` mostra "accepted" e "Notarized Developer ID", e \`codesign --verify --deep --strict "/Applications/Kiwi Notes.app"\` não diz nada.`,
    "",
    `**Todas as mudanças:** [${o.previous}...${o.tag}](https://github.com/${o.repo}/compare/${o.previous}...${o.tag})`,
    "",
  ].join("\n");
}

if (import.meta.main) {
  const [repo, tag, previous] = process.argv.slice(2);
  if (!repo || !tag || !previous) {
    console.error("usage: … | bun scripts/release-notes.ts <owner/repo> <tag> <previous-tag>   (os assuntos dos commits no stdin)");
    process.exit(2);
  }
  const subjects = (await new Response(Bun.stdin.stream()).text()).split("\n");
  process.stdout.write(releaseNotes({ repo, tag, previous, subjects }));
}
