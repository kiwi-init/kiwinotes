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

## Consequências
- A frase curta sai na hora e sempre igual, e as fixtures (`fixtures.ts`) descrevem exatamente o que a limpeza faz.
- O que precisa de entender a frase (gramática, "tipo" sem vírgula depois de nome, reescrita de tom) só melhora onde o LLM entra. Para mudar onde ele entra, basta mexer na política do `wantsLlm`, sem tocar na arquitetura.
- `rulesText` vai para o histórico (T57) junto com o texto final, para comparar o que o LLM mudou.
