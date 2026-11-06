# T5455 — recuperação local do ditado

Áudio exclusivamente sintético: `say -v Luciana`, “Este áudio foi recuperado sem perder o ditado”. Nenhum microfone, clipboard ou janela do app foi usado.

- `01-ditado-retido.png`: WAV e manifesto de uma transcrição interrompida aparecem no Histórico com “Transcrever de novo” e prazo de 7 dias.
- `02-ditado-recuperado.png`: clique no botão executou o STT local; o texto voltou à mesma entrada do Histórico. WAV e manifesto foram apagados após salvar o texto.
- Roteiro reproduzível: `app/scripts/ui-scripts/dictation-recovery.json`, pela CLI headless/WebKit, com um WAV PCM16 mono a 16 kHz no diretório temporário `recovery/dictation` e manifesto UUID correspondente.

O relatório da UI registrou uma chamada `history.retry`, nenhuma falha, nenhuma rede bloqueada e nenhuma escrita no clipboard. A nova tentativa só devolve texto ao Histórico: não insere no app em foco nem cria nota automaticamente.

Verificações: 1.023 testes Bun; typecheck; build completo do helper; 254 testes Swift, incluindo um processo de teste morto por SIGKILL antes de finalizar o WAV, com leitura posterior dos 8.000 frames.

`KIWI_HELPER=<helper desta worktree> bun run test:dictation --json`: 113 casos de texto, 27 falados e 30 de falso positivo passaram; zero falhas e zero casos `known`. STT dos casos falados: mediana 235 ms, pior 385 ms. A primeira execução foi interrompida porque um `say` travou ao gerar um fixture; a repetição completa passou.
