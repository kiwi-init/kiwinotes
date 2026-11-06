# T5797 · O spool não bloqueia o ditado

A falha ao iniciar o journal agora emite o aviso estável `mic: recording_storage` no log e deixa a captura seguir em memória. Não emite mais `record.error` nem recusa o WAV de diagnóstico por falta de spool. A próxima gravação tenta criar o journal outra vez. Sem metadata válida, não instala o callback de escrita, não publica uma recuperação falsa e não finaliza/cancela o journal de outra gravação.

Depois de salvar o texto no Histórico, o fluxo remove o WAV e o manifesto mesmo se a inserção ou a criação da nota falharem. Se não há texto salvo nem entregue, preserva o áudio para recuperação. Falha de STT e STT vazio continuam recuperáveis. Nada muda na limpeza, no tom ou no texto inserido.

Reproduções antes da correção:

- Teste de inserção falha encontrou `recoveryId` e os dois arquivos, apesar do texto salvo no Histórico.
- Helper real em modo **headless**, com `recovery/dictation` ocupado por um arquivo regular, recusou um WAV de silêncio sintético com `E_HELPER / debug.transcribe: recording_storage`. Não foi necessário encher o disco, abrir diálogo ou ligar o mic.

Depois, o mesmo caso passou pela leitura do WAV e STT, retornando `skipped: empty` pelo silêncio, sem erro de armazenamento e com o aviso no log. Um teste com engine falso verifica os 3.200 samples retidos em memória quando a pasta está indisponível. Os testes de journal também verificam aviso, nova tentativa na gravação seguinte e preservação de uma recuperação ativa.

Verificação:

- `bun test`: 1.083 passaram; `swift test`: 268 de KiwiHelperCore + 2 de KiwiExport, zero falhas; `bun run typecheck`: sem erros. Build debug completo do helper passou.
- Sete testes Bun de recuperação: inserção falha com Histórico salvo, falha dupla (preserva áudio), equivalentes para nota, cancelamento, STT falho e vazio.
- `bun run test:dictation`: **113 texto + 27 falados + 30 falsos positivos**, todos passaram. Falados só com `say`, sem mic; lease `bench` mantida durante a bateria e depois liberada.
- `scripts/recovery-storage-proof.ts` usa sidecar falso que recusa `insert.text`, mas executa o Dictation/HistoryStore reais com texto sintético. Comprova uma entrada salva, nenhuma recuperação e zero arquivos restantes. Os prints WebKit claro/escuro mostram esse Histórico; sete passos por tema confirmam texto e ausência de botão de retranscrição. `proof.json` contém os resumos derivados das execuções.

Reprodução da prova visual a partir de `app/`, usando DATA inexistente:

```sh
bun scripts/recovery-storage-proof.ts /tmp/t5797-history-new
bun run cli start --no-helper --data /tmp/t5797-history-new
bun run cli ui history --script scripts/ui-scripts/dictation-stored-no-retry.json --theme light --out /tmp/t5797-light --data /tmp/t5797-history-new
bun run cli stop --data /tmp/t5797-history-new
```

Sem mic real, clipboard real, mudanças de permissões, diálogos ou app na tela. Nenhum áudio foi incluído no repo.
