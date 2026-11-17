# O que saiu do repo

Na arrumação do repo (spec #13895, T13933), estas coisas saíram da `main`. Nada foi apagado do histórico: cada uma está inteira no commit [`2d5493a2`](https://github.com/kiwi-init/kiwinotes/tree/2d5493a2), o último antes da arrumação.

| O que era | Onde achar agora |
|---|---|
| `spikes/stt-bench/`: a medida dos modelos de voz do ditado (ADR 0003) | [no commit 2d5493a2](https://github.com/kiwi-init/kiwinotes/tree/2d5493a2/spikes/stt-bench) |
| `spikes/meeting-bench/`: a medida das reuniões, com os dois canais e o `run-live.sh` (ADR 0009) | [no commit 2d5493a2](https://github.com/kiwi-init/kiwinotes/tree/2d5493a2/spikes/meeting-bench) |
| `docs/evidence/`: os prints e vídeos dos PRs, uma pasta por task (69 MB) | no branch [`evidence`](https://github.com/kiwi-init/kiwinotes/tree/evidence), e os prints novos também vão para lá (veja o `AGENTS.md`) |
| Os vídeos da arte do Kiwi Cat (as passagens, os símbolos, as caretas e a névoa): 41 arquivos, 14 MB, que o app não usa | no release [Arte do Kiwi Notes (`arte-v1`)](https://github.com/kiwi-init/kiwinotes/releases/tag/arte-v1), um zip com os caminhos de `docs/design/`; os links dos READMEs da arte apontam para cada vídeo no commit 2d5493a2 |
| `docs/varredura/`: a varredura da qualidade do app, por área (o "overall level up") | [no commit 2d5493a2](https://github.com/kiwi-init/kiwinotes/tree/2d5493a2/docs/varredura) |
| `docs/mega-ideia/roadmap.md`: o roadmap da mega-ideia (o agente e o Kiwi Cat) | [no commit 2d5493a2](https://github.com/kiwi-init/kiwinotes/blob/2d5493a2/docs/mega-ideia/roadmap.md) |
| `docs/kiwicat-demo/`: o zip da demo do Kiwi Cat | [no commit 2d5493a2](https://github.com/kiwi-init/kiwinotes/tree/2d5493a2/docs/kiwicat-demo) |
| `docs/screenshots/`: os prints da fase 1 (T48) | [no commit 2d5493a2](https://github.com/kiwi-init/kiwinotes/tree/2d5493a2/docs/screenshots) |
| `docs/kiwinote.md`: um arquivo vazio | [no commit 2d5493a2](https://github.com/kiwi-init/kiwinotes/blob/2d5493a2/docs/kiwinote.md) |
| `docs/design/brand/intro/`: a intro do prisma (o modelo, o `gerar.ts`, o protótipo e a prancha), que a intro do KiwiCat trocou (T14851, spec #14766) | [no commit c30559fa](https://github.com/kiwi-init/kiwinotes/tree/c30559fa/docs/design/brand/intro) |
| `app/ui/intro/intro.js`, `rive.ts` e `rive.test.ts`: o script da intro do prisma e o gato do Rive (T14851) | [no commit c30559fa](https://github.com/kiwi-init/kiwinotes/tree/c30559fa/app/ui/intro) |

## O gato three.js (T14885, spec #14813)

O gato novo trocou o motor do Kiwi Cat. O de antes está inteiro no commit [`c30559fa`](https://github.com/kiwi-init/kiwinotes/tree/c30559fa), o último da `main` com ele.

| O que era | Onde achar agora |
|---|---|
| O motor three.js de `app/ui/kiwicat/` (`index.ts`, `shader.ts`, `state.ts`, `gestures.ts`, `vectors.ts`, `symbols.ts`) e as demos (`demo.ts`, `cat-demo.ts`, `exposure-demo.ts`) | [no commit c30559fa](https://github.com/kiwi-init/kiwinotes/tree/c30559fa/app/ui/kiwicat) |
| As imagens de referência e as máscaras dele (`app/ui/kiwicat/assets/`, menos a prévia) | [no commit c30559fa](https://github.com/kiwi-init/kiwinotes/tree/c30559fa/app/ui/kiwicat/assets) |
| Os 50 scripts que só conferiam ou mediam o motor antigo (`app/scripts/kiwicat-*` das demos, os `.py` e o `cat-color-check.ts`) | [no commit c30559fa](https://github.com/kiwi-init/kiwinotes/tree/c30559fa/app/scripts) |

## O que mudou de lugar

| Antes | Agora |
|---|---|
| `docs/brand/` e `docs/mockups/` | `docs/design/brand/` e `docs/design/mockups/` |
| `docs/meetings/` | `docs/specs/reunioes/` |
| `docs/notes-folders.md` e `docs/diagnostics.md` | `docs/specs/pasta-das-notas.md` e `docs/specs/log-e-diagnostico.md` |
| `docs/licenses/` | `licenses/`, na raiz, ao lado do `NOTICE` |
