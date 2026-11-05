# ADR 0009: o ASR e a diarização das reuniões

- Status: proposto (T4926, R0 do spec #4823). A escolha final é do harry.
- Spike: [`spikes/meeting-bench/`](../../spikes/meeting-bench/README.md). Medido em 2026-11-05 num M1 Pro com 16 GB e macOS 27.2, com o FluidAudio 0.18.2 (o mesmo do ditado, ADR 0003), com `kiwi lock bench`.

## Contexto
A reunião é transcrita **ao vivo** e o áudio é **apagado** depois de transcrito (#4840). Separamos os canais: o canal **você** é o mic, e o canal **sistema** é o áudio da reunião, que é o único que passa pela diarização. Antes de construir o R3, precisávamos saber:
- quanto o streaming custa em precisão no PT;
- qual diarização ao vivo segura uma reunião;
- o atraso até o texto firme;
- o peso no M1 Pro.

## Como foi medido
- **A reunião sintética** (`gen.ts`):
  - um diálogo de trabalho sobre a migração de um PACS, com os termos (STOW, QIDO, AE Title, VM, BigQuery…);
  - falado em arquivo pelo `AVSpeechSynthesizer`, sem tocar som;
  - WAV de dois canais a 16 kHz, com 8% de falas que se sobrepõem.
- **As três reuniões:**
  - **curta:** 8,4 min, você e mais 3 pessoas;
  - **curta-eco:** a curta com o sistema vazando no mic (alto-falante sem fone);
  - **longa:** 26,8 min, você e mais 5 pessoas, uma a mais que o teto do Sortformer.
- **As vozes:** só a Luciana (pt-BR) e a Joana (pt-PT) são naturais e abertas a apps. As outras pessoas são elas com a fala reamostrada (tom e formantes juntos). Vozes da mesma família são o **caso difícil** para a diarização: os números de falante aqui são pessimistas.
- **A nota** (`score.ts`):
  - WER por canal, com os números por extenso;
  - erro de falante por palavra (WDER), com o melhor casamento um-para-um dos rótulos;
  - falantes achados;
  - palavras de eco no canal "você".

## Resultados
| reunião | ASR | diarizador | WER você | WER sistema | erro de falante | falantes (achados/reais) | velocidade* | CPU | memória de pico |
|---|---|---|---|---|---|---|---|---|---|
| curta | streaming | **Sortformer** | 5,1% | 8,3% | 16,1% | 2/3 | 0,19 | 37% | 246 MB |
| curta | streaming | LS-EEND | 5,1% | 8,3% | 52,2% | 1/3 | 0,10 | 60% | 179 MB |
| curta | lote | VBx (no fim) | 5,1% | 8,8% | 16,2% | 2/3 | 0,08 | 47% | 830 MB |
| curta-eco | streaming | Sortformer | **242,6%** | 8,3% | 16,1% | 2/3 | 0,19 | 43% | 221 MB |
| longa | streaming | **Sortformer** | 6,3% | 9,4% | 35,3% | 4/5 | 0,18 | 34% | 491 MB |
| longa | streaming | LS-EEND | 6,3% | 9,4% | 53,9% | 2/5 | 0,05 | 119% | 451 MB |
| longa | lote | VBx (no fim) | 7,1% | 9,6% | **1,9%** | **5/5** | 0,03 | 116% | 1.024 MB |

\* Tempo de parede ÷ duração do áudio, com o arquivo entregue o mais rápido possível: os dois canais de ASR e a diarização juntos. Abaixo de 1 cabe no tempo real com folga. A CPU é a média nesse modo apressado; ao vivo, no ritmo da fala, ela cai na mesma proporção.

**Ao vivo de verdade** (a curta no ritmo da fala, `--realtime`, com Sortformer):
- a palavra fica firme **5,9 s** depois de dita na mediana, e **10,6 s** no p90;
- a precisão é a mesma da tabela;
- **8% de CPU** e **156 MB** de pico, com os dois canais e a diarização juntos.

Durante 30 s dessa rodada, outro agente rodou a suíte do Bun na mesma máquina; o efeito no atraso é desprezível.

## O que os números dizem
1. **O streaming não custa precisão em PT.** O `SlidingWindowAsrManager` (`.streaming`: pedaço de 11 s com 2 + 2 s de contexto) fica igual ao lote, ou um pouco melhor: 5,1% contra 5,1% na curta e 6,3% contra 7,1% na longa, no canal "você". O canal "sistema" erra mais (8 a 10%), pelas vozes reamostradas.
2. **O eco é obrigatório.** Sem fone, o canal "você" transcreve a reunião inteira de novo: 794 palavras a mais, e o WER vai a 242%. O R3 precisa tirar do "você" a fala que aparece nos dois canais ao mesmo tempo, desde a primeira versão.
3. **O LS-EEND está fora.** Ele junta todo mundo em 1 ou 2 falantes: mais de 50% de erro, e mais CPU.
4. **O Sortformer ao vivo serve até 4 pessoas.** Na curta, ele empata com o VBx (16%; os dois juntam as duas vozes mais parecidas). Na longa, ele bate no teto: acha 4 de 5 e erra 35%.
5. **O VBx no fim é muito melhor numa reunião grande:** 1,9% de erro, os 5 achados. Mas ele precisa do **áudio inteiro do canal sistema** no fim, e pesa mais (~1 GB de pico com o ASR em lote).

## Decisão (proposta)
- **ASR:** `SlidingWindowAsrManager` com `.streaming` e o Parakeet Ultra, um por canal.
- **Diarização ao vivo:** `SortformerDiarizer` (`.default`) só no canal sistema, para os rótulos enquanto a reunião acontece.
- **Eco:** a regra de duplicata entre canais no R3, com a `curta-eco` como teste de regressão (meta: perto de 0 palavras de eco).
- **Pedaço do spool:** 10 s (o padrão do R1), guardando tudo depois de `firmeAté − 2 s`.
- **O que o harry decide:** o acerto final dos falantes no fim da reunião (o VBx). Veja abaixo.

## A decisão que é do harry
O VBx no fim acerta muito mais os falantes numa reunião com 5 pessoas ou mais, mas precisa do áudio do canal sistema até a reunião acabar. Hoje o áudio é apagado logo que o texto fica firme (#4840).
- **A. Só o Sortformer ao vivo.** O áudio é apagado na hora. Bom até 4 pessoas; com mais, os rótulos erram mais.
- **B. Guardar o canal sistema até o fim**, rodar o VBx para acertar os rótulos e então apagar. Melhor resultado; o áudio fica no disco (0600) só durante a reunião.
- **C. Guardar só as "impressões de voz" (embeddings)**, sem o áudio, e agrupar no fim. Sem áudio guardado, mas precisa de pesquisa no FluidAudio (`embedSpans`, `cluster`) antes de virar spec.

## Consequências
- O R3 começa com `.streaming` e o Sortformer, que é o padrão provisório que o @sparkly-vole já escolheu (#5089), e com a regra do eco.
- `kiwi-helper --meeting` e o `meeting-bench` ficam como a régua: o modo `--meeting-live` do R3 é medido pelo mesmo `score.ts`.
- **Limites desta medida:** são vozes sintéticas da mesma família, uma reunião de cada tamanho e sem ruído de sala. A reunião de verdade do harry (a última caixa do spec #4823) confirma.
