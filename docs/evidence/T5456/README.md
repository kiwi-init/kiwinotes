# T5456 · L4: gravar +250 ms depois de soltar o atalho

Issue #155, onda 2 do levelup (spec Kiwi #5292). Sem mic (AGENTS.md): o rabo da captura é testado no `swift test` com o motor falso, e a bateria falada usa o `say`.

## `swift test` (211 testes, 0 falhas)
`CaptureTests`, os novos:
- `testTheTailKeepsRecordingAQuarterSecondAfterLettingGo`: depois de soltar, o mic continua ligado, e os 0,24 s falados no rabo entram na gravação (0,5 s + 0,24 s). Depois o mic fecha.
- `testACancelDuringTheTailDiscardsRightAway`: um cancelamento no rabo fecha o mic na hora e não entrega nada.
- `testANewPressDuringTheTailEndsItWithWhatCameSoFar`: apertar de novo no rabo fecha a gravação anterior com o que veio, e a nova começa já.
- `testAMicLostDuringTheTailEndsThroughOnLostOnly`: o mic que cai no rabo termina pelo `onLost`, uma vez só.

## Bateria falada (`bun run test:dictation --only wav`, helper de debug, sob o `kiwi lock bench`)
O caso novo, "falado: última palavra ao soltar": "me lembra de ligar para o fornecedor amanhã", com o atalho solto 450 ms antes de a fala acabar.

Com o rabo (o padrão):
```
falado (falados.jsonl, say → STT): 27/27 ok
  boosting do vocabulário: ready · STT: mediana 220 ms, pior 373 ms (27 casos)
falso positivo (falsos-positivos.jsonl, say → STT): 30/30 ok
tudo ok
```

Sem o rabo (`KIWI_RELEASE_TAIL_MS=0`, como era antes):
```
falado (falados.jsonl, say → STT): 26/27 ok
  FALHOU  falado: última palavra ao soltar (L4, +250 ms)
          text: expected it to contain "amanhã"
          got: "Me lembra de ligar para o fornecedor amarelo."
falso positivo (falsos-positivos.jsonl, say → STT): 30/30 ok
1 caso(s) falharam
```

Para escolher o corte, o mesmo WAV foi transcrito com `kiwi-helper --transcribe`, cortando o fim:

| corte | texto |
|---|---|
| 0 a 300 ms | "amanhã" |
| 400 ms | "amantando" |
| 500 ms | "ampão" |

O caso usa 450 ms: sem o rabo a última palavra se perde, e com o rabo o corte cai para 200 ms.
