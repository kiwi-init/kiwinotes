# ADR 0002: limpeza do ditado com regras primeiro e LLM local opcional

- Status: aceito (T52). O @harry escolheu a opção A em #171: regras primeiro, LLM só onde há folga.
- Código: [`app/src/cleanup/`](../../app/src/cleanup/). Contrato do LLM: [ADR 0001](0001-ipc.md) (`llm.complete`, `llm.prewarm`).

## Contexto
O spec (#15) pede a limpeza com um LLM local (Apple Foundation Models ou MLX) e a meta do T52 é ~400 ms por frase curta. Medimos o Foundation Models no M1 Pro (macOS 27.2, #144), com instruções em PT e geração greedy:
- **latência:** de 840 a 1660 ms por frase curta numa sessão nova, e ~600 ms com a sessão aquecida;
- **qualidade:** inventou um horário ("às 4"), deixou "É hum" e "tipo", e **respondeu** "what's the weather tomorrow" em vez de limpar.

Um texto que muda de sentido, colado direto no app da pessoa, é pior que um texto com uma muleta a mais.

## Decisão
1. **As regras sempre rodam e já entregam o texto** (`rules.ts`): muletas sem ambiguidade, autocorreções faladas ("não, quer dizer", "ou melhor", "I mean"), "nova linha"/"novo parágrafo"/"apaga isso", gagueira, listas com ordinais, pontuação, maiúsculas, dicionário e tom por app. É determinístico e leva ~0,01 ms por frase (p99 < 0,02 ms no `bench.ts`). Na dúvida, a regra não mexe: o ambíguo ("tipo" depois de artigo, "quer dizer que", "segundo ele") fica como foi dito.
2. **O dicionário é intocável:** os termos viram marcadores antes das regras e voltam com a grafia exata do dicionário no fim (inclusive no começo da frase, `kubectl` não vira `Kubectl`).
3. **Tom por bundle id** (`tone.ts`): `casual` (Slack, Teams, mensagens: uma frase sai sem ponto final), `formal` (Mail, Outlook), `literal` (terminal e IDE: comando sai sem maiúscula nem ponto, e prosa para o Claude Code ganha pontuação, mas nunca vira lista) e `default`.
4. **O LLM é uma camada opcional** atrás de `LlmBackend` (Foundation Models pelo sidecar hoje, MLX depois). O modo `auto` só chama o LLM no tom `formal` ou em ditado longo (≥ 40 palavras), nunca no `literal`. Tem limite de tempo (1,5 s por padrão) e uma **guarda** (`rejectReason`) que descarta a saída que responde em vez de revisar, cresce ou encolhe demais, perde termo do dicionário ou traz palavras que não estavam no texto. Em qualquer falha, fica o texto das regras.
5. **O prompt e o filtro da saída vêm do VoiceInk** (#258, `19546d2`): `prompts.ts` porta o `AIPrompts.enhancementSystemTemplate` com o prompt "Default", o bloco `<CUSTOM_VOCABULARY>` com o dicionário inteiro (até 150 termos, na ordem da pessoa) e o texto dentro de `<TRANSCRIPT>`. `outputFilter.ts` porta o `AIEnhancementOutputFilter`. Do Kiwi ficam a linha de tom e a guarda. A mensagem de sistema não depende do texto (`llmSystemMessage`), então o `llm.prewarm` antes do ditado serve para o `llm.complete` depois. Os pesos do VoiceInk Refine ficam fora: a licença deles só permite o uso no VoiceInk (#267). Um modelo aberto no MLX do VoiceInk é o T270.

### Medição com o prompt do VoiceInk (Foundation Models, M1 Pro, 7 frases em PT)
- **Latência:** de 2,2 a 2,8 s por frase numa sessão nova (5 s na primeira), e de 1,6 a 3,6 s com o `llm.prewarm`. O prompt tem ~1,3 mil tokens, contra ~100 do prompt curto do #144. Com o limite padrão de 1,5 s, o LLM quase nunca chega a tempo.
- **Bom:** a lista ("primeiro… segundo… terceiro" virou 1. 2. 3.), a pontuação, "tá" → "está", e não respondeu "what's the weather".
- **Ruim:**
  - **Traduziu** para o inglês um ditado em PT no tom casual. A guarda pegou (`novel_words`).
  - **Inverteu** uma autocorreção: "na quinta não espera na sexta" virou "na quinta, não na sexta".
  - Trocou "segue" por "segure" e tirou o nome "Ana".
  
  A guarda não pegou esses três.

Por isso o modo continua `off` por padrão, e o T270 compara os modelos nas mesmas frases.

### Foundation Models vs. modelos abertos no MLX (T270)
- **Conjunto:** as fixtures do T52 e as 7 frases do round 3 (#297), com os casos dos reviews (`evalset.ts`). São 75 casos que passam pelo LLM; o tom literal fica fora.
- **Como rodou:** pelo `eval.ts`, com o prompt de produção, `llmMode: "always"` e a guarda, num M1 Pro (16 GB) com o `kiwi lock bench`.
  - O FM roda pelo sidecar (`llm.complete`).
  - O MLX roda pelo `mlx_lm.server` 0.32.2 em 127.0.0.1, com temperatura 0,3 e `enable_thinking: false`, como no VoiceInk.
  - É o mesmo MLX do mlx-swift-lm, mas pelo Python, então a latência do app pode sair um pouco diferente.
- **Fidelidade:** revisão manual das saídas que a guarda deixou passar. Conta como "erro" o que muda o sentido ou o que foi ditado: um verbo trocado, uma palavra trocada ou tirada, uma tradução, uma resposta, um "Output:" que vazou ou um parágrafo perdido.

| | FM (sidecar) | Qwen3-1.7B-4bit | Qwen3.5-2B-4bit | SmolLM3-3B-4bit |
|---|---|---|---|---|
| 1ª chamada (fria) | 3,7 s | 1,7 s | 5,5 s (carrega o modelo) | 2,8 s |
| Depois: p50 / p90 / máx | 2,0 / 2,3 / 3,5 s | 0,23 / 0,42 / 0,90 s | 0,19 / 0,42 / 1,75 s | 0,37 / 1,0 / 4,9 s |
| Dentro de 1,5 s | 0 de 75 | 74 de 75 | 71 de 75 | 71 de 75 |
| Memória (RSS do servidor, pico) | fora do processo do Kiwi | 1,16 GB | 0,80 GB | 1,99 GB |
| Mexeu no texto das regras | 28 | 18 | 27 | 36 |
| Erros que passaram pela guarda | **9** | **6** | **5** | **~20** |
| Guarda descartou | 1 | 0 | 5 (traduções) | 14 |
| Traduziu PT → EN | 1 (passou) | 0 | 6 (1 passou) | 6 (2 passaram, 1 para FR) |
| Respondeu em vez de limpar | 0 | 0 | 0 | 1 ("Canberra", passou) |

- **FM:** são os mesmos erros do #144 e do round 3, agora em mais casos.
  - Troca de palavra: "segue" → "siga"/"segure", "me encontra" → "me encontro", "segunda" → "depois".
  - Uma autocorreção virou "O melhor ainda é que".
  - Tirou "Ana" e "já resolvi" e escreveu "20,000" em PT.
  - Nunca chega no limite de 1,5 s.
- **Qwen3-1.7B:** é o mais conservador e o único que nunca traduz nem responde.
  - Os erros: "Fechei" → "Feche" (2×), "seguro" → "segredo" numa lista, uma oração cortada no e-mail longo, um "Esse" inventado e um parágrafo ditado juntado.
  - Termina as linhas de lista com dois espaços (quebra do Markdown).
  - Quase não limpa: deixou o "é" no r3-relatorio.
- **Qwen3.5-2B:** é o que melhor pontua e limpa, mas traduz para o inglês (6 de 75).
  - A guarda pega quase todas as traduções; "É difícil explicar" → "It's difficult to explain" passou.
  - Fora isso: "time" → "tempo", "esquece" → "esqueci", "segundo ele" perdeu o "ele" e tirou "Ana".
- **SmolLM3-3B:** fica fora.
  - Vaza "Output:", responde pergunta, escreve poema quando pedido, traduz para EN e FR e cria frases ("Relatório: Amanhã de manhã.").

**Escolha do backend padrão para o `llm.complete`: Qwen3-1.7B-4bit no MLX** (Apache-2.0), quando o modo estiver ligado.
- Por quê:
  - É o único que cabe no limite de 1,5 s com folga (p90 0,42 s).
  - Erra menos que o FM.
  - Nunca traduz nem responde, que são os erros que a guarda não sabe pegar.
- O FM fica como reserva: não baixa nada e não ocupa a memória do Kiwi.
- **O modo continua `off` por padrão**, porque 6 erros em 75 ainda são demais para colar direto no app da pessoa.

Para ligar, falta:
- (a) o MLX no sidecar (mlx-swift-lm) e o download do modelo (~1 GB), em task própria;
- (b) a guarda pegar troca de idioma e verbo trocado;
- (c) tirar os espaços no fim da linha da saída.

### Foundation Models com aquecimento, nos modos `auto` e `always` (T1208)
- **Conjunto:** o `evalset.ts` com as 25 frases sintéticas do T1208 (`synthCases`: muletas, autocorreção no meio da frase, listas e tom por app). São 153 casos; os 35 do tom literal nunca passam pelo LLM.
- **Como rodou:**
  - Um probe que só chama o FoundationModels, em stdio. O `kiwi-helper` ficou fora porque liga o hotkey tap e o overlay.
  - Cada caso faz o que o app faz: `llm.prewarm` com a mensagem de sistema, 2 s de "fala" e o `llm.complete`.
  - Usa o prompt de produção, a geração greedy e a guarda, com limite de 30 s para medir a latência inteira.
  - M1 Pro, macOS 27.2, com o `kiwi lock bench`. A 1ª chamada fria levou 5 s.
- **Latência depois de soltar a tecla:**

| | p50 | p95 | Dentro de 1,5 s |
|---|---|---|---|
| Só regras | ~0,01 ms | < 0,02 ms | todos |
| Regras + FM, `always` (118 casos) | 1,54 s | 3,11 s | 51 de 118 |
| Regras + FM, `auto` (24: tom formal ou ≥ 40 palavras) | 1,73 s | 3,39 s | **3 de 24** |

  No `auto`, com o limite padrão de 1,5 s, 21 de 24 ditados esperariam 1,5 s e sairiam com o texto das regras mesmo.
- **Qualidade (`always`):** revisão manual das 50 saídas que mexeram no texto das regras.
  - **23 melhoram, 19 pioram e 8 ficam iguais.** Outras 64 saíram idênticas às regras, e a guarda descartou 2.
  - No `auto` sozinho, 11 melhoram, 6 pioram e 1 fica igual.
  - **Melhora:**
    - vírgulas e frases no ditado longo e no e-mail;
    - maiúscula em nome próprio (Maria, Carlos, Friday, São Paulo);
    - tira o "sabe" e o "like";
    - "primeiro… segundo… terceiro" sem vírgula vira 1. 2. 3.
  - **Piora: 15 mudam o sentido e passaram pela guarda.**
    - Traduziu para o inglês 4 vezes: "kubectl tá fora do path", "abre um PR", "Meu email é…" e "cem reais digo duzentos" → "The cost was 100 reais, I say 200".
    - Trocou o verbo: segue → siga/segure, me encontra → me encontro.
    - Inventou ou trocou: "às quatro" → "às 16h", segunda → depois, "Ou melhor ainda" → "O melhor ainda é que".
    - Tirou "Ana" e "já resolvi" e inverteu quinta/sexta.
    - Escreveu "20,000" e "10,000" em PT e passou nome de arquivo para maiúscula (`DICOM_STORE.py`).
  - A guarda descartou um acerto: "dez ou melhor dia doze" → "A entrega é dia 12." caiu no `shrank`.

**Decisão (#1228): o `llmMode` continua `off` por padrão, e o FM não ganha liga/desliga nas Configurações.**
- O `auto` quase nunca chega a tempo.
- O FM muda o sentido em 1 de cada 8 casos, e o texto vai colado direto no app da pessoa.
- O fallback para as regras no timeout já existe (`polish`).

O que o FM acerta aqui é, quase tudo, uma lacuna das regras: autocorreção no meio da frase ("ou melhor", "digo", "não espera", "apaga isso") e lista sem vírgula. Isso vai para as regras (T1229).

Se um LLM for ligado, a guarda precisa pegar:
- a troca de idioma em texto curto, porque a conta de palavras novas só vale com 3 ou mais;
- o número com separador en-US num texto em PT.

## Consequências
- A frase curta sai na hora e sempre igual, e as fixtures (`fixtures.ts`) descrevem exatamente o que a limpeza faz.
- O que precisa de entender a frase (gramática, "tipo" sem vírgula depois de nome, reescrita de tom) só melhora onde o LLM entra. Para mudar onde ele entra, basta mexer na política do `wantsLlm`, sem tocar na arquitetura.
- `rulesText` vai para o histórico (T57) junto com o texto final, para comparar o que o LLM mudou.
