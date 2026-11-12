# Varredura: ditado (área 1 do spec #7424, T7438)

A varredura foi feita em 2026-11-11, na `main` em `c9a98f4`, com o helper `swift build` (debug) dessa mesma `main`.
Tudo rodou pela CLI headless (`bun run cli`), sem mic, sem colar de verdade (`dryRun`) e sem nada na tela. Todo o
áudio é sintético: o `say` (vozes Luciana e Samantha) ou um WAV gerado por script (tons, ruído, silêncio). Nenhum
áudio entrou no repo.

## Resumo

| | Resultado |
|---|---|
| `swift test` (native) | 343/0 |
| `bun test` do ditado (`src/bun/dictat*`, `learn-*`, `precise-*`, `microphone`) | 77/0 |
| `test:dictation`: texto | 113/0 |
| `test:dictation`: falados (`say` → Parakeet) | 28/0 |
| `test:dictation`: falsos positivos | 30/0 |
| `test:dictation --only precise` (Whisper small) | 3/0 (mediana 370 ms, pior 2461 ms) |
| Bugs achados | 1, com task própria: **T7454** |

## Bugs

### T7454: o Ditado preciso transforma som sem fala em texto colado

**Passo:** liga o Ditado preciso e dita um som sem fala.

| Áudio sintético | Preciso, sem dicionário | Preciso, com 4 termos no dicionário | Parakeet |
|---|---|---|---|
| tom de 440 Hz, 2 s (um bipe) | "Okay, now blessing is set" | "Thenhoni jc Ad Talks" | vazio |
| tom de 440 Hz, 5 s | "노!" | "Paycheck" | vazio |
| zumbido de 120 Hz, 3 s (ar-condicionado, ventilador) | vazio | "Atever you wear never plastic shirts, never sựcoal" | vazio |

- **O esperado:** o ditado sai vazio, como no Parakeet.
- **O que acontece:** o texto inventado é colado no app da pessoa. O resultado se repete igual em duas rodadas.
- **A causa:** o `PreciseRoute.usesWhisper` escolhe o Whisper pela energia do som (1 s ou mais acima de ~-40 dBFS), sem
  detector de fala. O Parakeet passa antes pelo VAD (`speechOnly`).
- **Efeito colateral:** ruído branco e rosa saem vazios, mas passam pelo Whisper e levam 2,3–3,1 s, contra ~0,3 s no
  Parakeet.

## O que funciona (com o passo que conferiu)

- **WAVs de borda pelo Parakeet:**
  - silêncio de 0,2 s e de 5 s, ruído branco, tom de 2 s e de 5 s, acorde, cliques e ruído rosa saem vazios
    (`skipped: "empty"`);
  - "sim" (0,56 s) sai certo;
  - 44,1 kHz estéreo e Float32 a 22 kHz saem certos, com o resample;
  - um ditado de 88 s sai inteiro (200 de ~208 palavras, sem cortar o fim).
  - Um WAV vazio ou que não é WAV dá `E_HELPER invalid_value`, um erro claro e sem travar.
- **A ordem dos ditados:** três ditados ao mesmo tempo (Mail, Ghostty e Slack), em 3 rodadas, saem cada um com o seu
  app e o seu tom: formal, literal sem espaço automático, e casual sem o ponto final.
- **O helper caindo no meio do ditado:** `kill -9` no helper durante um ditado de 88 s. O ditado fecha com
  `helper_restarted`, o helper volta sozinho, e o áudio fica na recuperação: no Histórico, como "interrupted". O
  `history.retry` transcreve o áudio inteiro e apaga a recuperação.
- **A nota rápida (`--note`):** cria a nota na `Caixa de entrada/` com `source: dictation` e o id do ditado. Duas
  vezes a mesma frase dá "… 2.md", sem sobrescrever.
- **Toque curto no atalho:** menos de 0,25 s (`holdThreshold`) cancela a gravação e não deixa nada no Histórico. Uma
  gravação de 0,25 s ou mais sem fala fica 7 dias na recuperação, como "stt_empty", que é o desenho do T5455.
- **Números (Parakeet):** "dia vinte e três às quinze e trinta, mil e duzentos reais" dá "dia 23 às 15h30, custa
  R$ 1.200,00", e o telefone sai certo.
- **Inglês no modo automático:** sai certo nos dois motores.

## Para observar (não é bug confirmado)

- **Pontuação falada no modo preciso:** "Oi Ana vírgula tudo bem ponto de interrogação nova linha…" sai do Whisper
  com palavras grudadas ("Koianna-Latudubeni.de.Interrogação…"), com ou sem dicionário. O Parakeet entende os comandos
  ("Oiana, tudo bem e? Ou↵Segue o arquivo."). A voz do `say` é robótica e o Whisper sofre mais com ela, então isso
  entra no roteiro do harry, com a voz dele.
- **O prompt do dicionário puxa o resto do texto no modo preciso:** com PACS, DICOM, Kubernetes e Grafana no
  dicionário, o telefone "nove nove oito…" virou "R$ 9,986,54321". Sem dicionário, sai certo ("9987654321").
- **Ferramenta de dev:** o `defaultHelper()` (`src/headless/server.ts`) prefere o `release` ao `debug`, mesmo quando o
  release é mais velho. Um release esquecido roda calado no lugar do código novo; foi o que aconteceu no #7082, com o
  release de 7/11 sem o modo preciso. Escolher o mais novo pelo mtime evitaria isso.

## O que não dá para testar sem pessoa (roteiro do harry, no teste final)

1. O Fn de verdade: segurar, soltar, toque duplo (modo contínuo) e Esc para cancelar. A pílula aparece e some.
2. O mic: o escolhido nos Ajustes, o automático, um AirPods (Bluetooth) e tirar o mic no meio do ditado (o aviso "O
   microfone caiu").
3. Colar de verdade num campo (Notas, Slack e Terminal), e o cartão "Adicionar ao dicionário?" depois de corrigir uma
   palavra.
4. O Ditado preciso com a voz dele: uma frase com "vírgula", "ponto final" e "nova linha", e um ditado com um ruído de
   fundo (ventilador ou música) sem falar nada. Depois do T7454, nada pode ser colado.
