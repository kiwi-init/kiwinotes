# ADR 0002: limpeza do ditado com regras primeiro e LLM local opcional

- Status: proposto (T52). O caminho principal espera a decisão do @harry em #146.
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

## Consequências
- A frase curta sai na hora e sempre igual, e as fixtures (`fixtures.ts`) descrevem exatamente o que a limpeza faz.
- O que precisa de entender a frase (gramática, "tipo" sem vírgula depois de nome, reescrita de tom) só melhora onde o LLM entra. Se o @harry escolher a opção B ou C do #146, muda só a política do `wantsLlm`, não a arquitetura.
- `rulesText` vai para o histórico (T57) junto com o texto final, para comparar o que o LLM mudou.
