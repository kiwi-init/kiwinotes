# O que saiu do repo

**Repo antigo:** desde 2026-11-17, o repo no GitHub é novo e começa num commit só (`99f8dd66`). Os commits `2d5493a2` e `c30559fa` e o release `arte-v1` são da história antiga, que não está no GitHub, por isso essas linhas não têm link.

Na arrumação do repo (spec #13895, T13933), estas coisas saíram da `main`. Cada uma ficou inteira no commit `2d5493a2` do repo antigo, o último antes da arrumação.

| O que era | Onde achar agora |
|---|---|
| `spikes/stt-bench/`: a medida dos modelos de voz do ditado (ADR 0003) | no commit `2d5493a2` do repo antigo |
| `spikes/meeting-bench/`: a medida das reuniões, com os dois canais e o `run-live.sh` (ADR 0009) | no commit `2d5493a2` do repo antigo |
| `docs/evidence/`: os prints e vídeos dos PRs, uma pasta por task (69 MB) | no branch [`evidence`](https://github.com/kiwi-init/kiwinotes/tree/evidence), e os prints novos também vão para lá (veja o `AGENTS.md`) |
| Os vídeos da arte do Kiwi Cat (as passagens, os símbolos, as caretas e a névoa): 41 arquivos, 14 MB, que o app não usa | no release Arte do Kiwi Notes (`arte-v1`) do repo antigo, um zip com os caminhos de `docs/design/`, e no commit `2d5493a2` do repo antigo |
| `docs/varredura/`: a varredura da qualidade do app, por área (o "overall level up") | no commit `2d5493a2` do repo antigo |
| `docs/mega-ideia/roadmap.md`: o roadmap da mega-ideia (o agente e o Kiwi Cat) | no commit `2d5493a2` do repo antigo |
| `docs/kiwicat-demo/`: o zip da demo do Kiwi Cat | no commit `2d5493a2` do repo antigo |
| `docs/screenshots/`: os prints da fase 1 (T48) | no commit `2d5493a2` do repo antigo |
| `docs/kiwinote.md`: um arquivo vazio | no commit `2d5493a2` do repo antigo |
| `docs/design/brand/intro/`: a intro do prisma (o modelo, o `gerar.ts`, o protótipo e a prancha), que a intro do KiwiCat trocou (T14851, spec #14766) | no commit `c30559fa` do repo antigo |
| `app/ui/intro/intro.js`, `rive.ts` e `rive.test.ts`: o script da intro do prisma e o gato do Rive (T14851) | no commit `c30559fa` do repo antigo |
| `docs/design/brand/kiwi-cat-familia/`: o teste de ícone do T2025, o Kiwi-cat na família do ícone do Channels em 3 variações (aura, vidro e lâmina), sem nenhuma escolhida (T17495, spec #17478) | [no commit 13bfc890](https://github.com/kiwi-init/kiwinotes/tree/13bfc890a0fc41790e962062f32fbf82d5e4e0a3/docs/design/brand/kiwi-cat-familia) |

## O gato three.js (T14885, spec #14813)

O gato novo trocou o motor do Kiwi Cat. O de antes está inteiro no commit `c30559fa` do repo antigo, o último da `main` com ele.

| O que era | Onde achar agora |
|---|---|
| O motor three.js de `app/ui/kiwicat/` (`index.ts`, `shader.ts`, `state.ts`, `gestures.ts`, `vectors.ts`, `symbols.ts`) e as demos (`demo.ts`, `cat-demo.ts`, `exposure-demo.ts`) | no commit `c30559fa` do repo antigo |
| As imagens de referência e as máscaras dele (`app/ui/kiwicat/assets/`, menos a prévia) | no commit `c30559fa` do repo antigo |
| Os 50 scripts que só conferiam ou mediam o motor antigo (`app/scripts/kiwicat-*` das demos, os `.py` e o `cat-color-check.ts`) | no commit `c30559fa` do repo antigo |

## O que mudou de lugar

| Antes | Agora |
|---|---|
| `docs/brand/` e `docs/mockups/` | `docs/design/brand/` e `docs/design/mockups/` |
| `docs/meetings/` | `docs/specs/reunioes/` |
| `docs/notes-folders.md` e `docs/diagnostics.md` | `docs/specs/pasta-das-notas.md` e `docs/specs/log-e-diagnostico.md` |
| `docs/licenses/` | `licenses/`, na raiz, ao lado do `NOTICE` |
