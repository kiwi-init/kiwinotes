# ADR 0014: o runtime da voz do gato (Qwen3-TTS)

- Status: **proposto** (T26708, spec #26687). O harry escolheu o Qwen3-TTS local no #26687; este ADR decide só **como** ele roda dentro do Kiwi.
- Modelo: `mlx-community/Qwen3-TTS-12Hz-0.6B-Base-8bit`, revisão `50f45ef0`, 1,9 GB em disco, baixado com o clique da pessoa como os modelos de voz (AGENTS.md).
- Código: nenhum ainda. O processo é o T26732.

## Decisão
**O porte em Swift, o `mlx-audio-swift`, num processo próprio, fora do helper.**

- **Versão fixa:** `v0.2.1` (`ff174ab2`), com o `mlx-swift` 0.33.0.
- **O processo** sobe quando o gato vai falar e sai depois de um tempo quieto. Ele devolve PCM em pedaços de 0,5 s (`streamingInterval: 0.5`).
- **Teto de memória:** `Memory.cacheLimit = 512 MB` na inicialização. Sem ele, o pico chega a 7,0 GB; com ele, fica em 4,2 a 4,5 GB, perto do Python com o mesmo teto (3,9 GB).
- **Fora do helper:** o helper sobe com o Kiwi e fica pequeno. O motor da voz ocupa uns 4 GB enquanto fala e precisa sair por inteiro para soltá-los, e um travamento do MLX não derruba o ditado.

## Plano B
O motor em Python (`mlx-audio` 0.6.8) empacotado no app, com um Python próprio, sem depender do Python da máquina. Ele fala o mesmo protocolo de pedaços de PCM, então só o processo muda.

Ele entra se o porte em Swift ficar para trás numa correção de que o gato precise, ou se o harry ouvir diferença entre os dois.

## Os números
Medidos no M1 Pro de 16 GB do time, com o `kiwi lock bench`, nas mesmas 10 frases inventadas e com uma voz de referência inventada (6,7 s, do `say`). A configuração é a do #26661: `stream`, intervalo de 0,5 s, português e a amostragem padrão de cada lado. Cada rodada faz 3 voltas das 10 frases e descarta a 1ª frase, que é fria (29 frases quentes). A memória é o `phys_footprint` do processo, que soma a GPU (o `maxrss` não soma).

As três rodadas em par, uma logo depois da outra. O load é o do macOS no começo do par, e o resto da máquina (outros agentes, o navegador) variou durante cada uma:

| Rodada | Teto de cache | 1º PCM p50 / p95 | Velocidade p50 / mínima | Pico de memória (`phys_footprint`) |
|---|---|---:|---:|---:|
| b, load ~18 | nenhum | Swift 0,49 / 1,26 s · Python 0,47 / 0,49 s | Swift 1,71× / 1,02× · Python 1,89× / 1,66× | Swift 7,0 GB · Python 5,4 GB |
| c, load ~12 | só no Swift | Swift 0,50 / 0,79 s · Python 0,47 / 0,57 s | Swift 1,73× / 1,24× · Python 1,88× / 1,61× | Swift 4,4 GB · Python 5,4 GB |
| e, load de 6 a 30 | **512 MB nos dois** | Swift 0,50 / 0,78 s · Python 0,74 / 2,94 s | Swift 1,81× / 1,27× · Python 1,58× / 0,45× | Swift 4,2 GB · Python 3,9 GB |

| Fora da tabela | Swift | Python |
|---|---:|---:|
| Falta de áudio num player simulado | 0 nas três | 0 em b e c, 4,3 s numa frase de e |
| Pico do MLX | 4,2 GB | 3,6 GB |
| Carga do modelo, com o disco quente | 0,8 a 1,7 s | 3,1 a 3,8 s |
| Peso que entra no app | **~32 MB** (binário de 27 MB e `default.metallib` de 4,5 MB) | **~555 MB** (Python de 73 MB, `mlx` 239, `scipy` 83, `transformers` 59…) |

- **Velocidade: empate dentro do ruído.** Nenhum dos dois ganha em todas as rodadas: o p95 do Swift foi pior em b e c, e o do Python foi pior em e. Os dois passam de 1× na mediana, e a voz não falta num player simulado, a não ser no pior momento de e. Com esta máquina compartilhada, não dá para separar mais do que isso.
- **Memória: empate com o teto.** Com 512 MB de cache nos dois (rodada e), ficam em 4,2 GB e 3,9 GB. Sem o teto, o Swift chega a 7,0 GB: o teto é obrigatório no processo.
- **A primeira execução do Swift** depois de instalar compila os kernels Metal: a 1ª frase levou 19 s, uma vez só. O processo deve aquecer em segundo plano depois de instalar ou atualizar, antes de o gato falar.
- **O T26732 mede de novo** com o Kiwi aberto ao lado, que é o caso real.
- **Não ouvi o áudio** (nada no alto-falante). Os dois rodam os mesmos pesos, mas o Swift é um porte. Comparar de ouvido é do harry, antes do T26732 fechar.
- A referência do #26661 (Python, outra voz de referência): 0,50 s e 1,86×. O Python em b e c deu o mesmo.

## Por que não o Python
- **Peso:** ~555 MB a mais no download, contra 32 MB.
- **Assinatura:** centenas de `.so` e `.dylib` para assinar e notarizar a cada release.
- **Ganho:** nenhum. Na velocidade e na memória (com o teto nos dois) eles empatam, então o peso e a assinatura decidem.

## O que muda no build
O SwiftPM pela linha de comando não compila os shaders Metal do MLX (README do `mlx-swift`). O processo da voz se constrói com o `xcodebuild` (Release, 6 min a frio neste Mac), num produto separado do `kiwi-helper`, que continua no `swift build`. O `release.yml` e o CI ganham esse passo no T26732.

## Licenças
O app é GPL-3.0, e tudo o que entra é compatível:

| O que entra | Licença |
|---|---|
| `mlx-swift`, `mlx-audio-swift`, `yyjson`, `EventSource` | MIT |
| `swift-transformers`, `swift-huggingface`, `swift-jinja`, `swift-crypto`, `swift-asn1`, `swift-collections`, `swift-numerics` | Apache-2.0 |
| `zstd` | BSD (licença dupla com a GPLv2; usamos a BSD) |
| Os pesos do modelo | Apache-2.0 |
| No plano B: `mlx`, `mlx-audio` | MIT |

As licenças entram em `licenses/` e no `NOTICE` no PR que traz o código.
