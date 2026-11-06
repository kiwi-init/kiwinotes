# T5832 · L8: baixar a mídia durante o ditado

Implementa a opção aprovada **baixar o volume**, por propriedades públicas de volume escalar do Core Audio. Durante a captura do ditado, o volume vai a 25% do valor original; ao fechar a captura, restaura o valor anterior. Não envia comandos a players, não abre apps e não usa AppleScript/Automação. Código original do Kiwi.

A escolha foi aceita pelo lead no Kiwi #5869: atende ao “pausa ou baixa” do harry sem depender de MediaRemote. A referência [mediaremote-adapter](https://github.com/ungive/mediaremote-adapter) foi consultada: nas versões novas, seu bridge usa o binário Perl do sistema carregando um framework próprio. Nada desse bridge foi incluído ou executado. Não houve porte de código nem nova dependência.

Antes de alterar qualquer canal, grava um registro privado **0600** em `dictation-media-volume.json`, no diretório de dados. A escrita é atômica, com fsync do arquivo, sem seguir symlinks. Sem registro gravável, não baixa o volume e não bloqueia o ditado.

O controlador guarda dispositivo **e UID** e os canais alterados (master, ou canais individuais). Considera a quantização aceita pelo driver. Só restaura um canal se o valor ainda é o que o Kiwi escreveu: preserva o ajuste manual da pessoa e não altera a nova saída quando ela troca de dispositivo. Na abertura seguinte do helper, lê o registro e restaura somente os canais ainda no valor que o Kiwi escreveu; após restaurar ou reconhecer ajuste manual, remove o registro. Dispositivo desconectado ou falha ao restaurar mantém a pendência para nova tentativa, inclusive ao reconectar a saída; um novo dispositivo pode ser baixado sem acumular reduções na pendência antiga. O UID estável permite reencontrar o mesmo hardware se o Core Audio mudar seu ID. Registro inválido impede novas alterações, sem bloquear o mic. Um dispositivo sem volume escalar ajustável não será baixado; fica o código `media: volume_unavailable` no log.

Integração no helper:

- Baixa antes de `record.started`/`audio.start`; restaura depois de o mic fechar, no início de `finishRecording`, sem esperar STT/colagem.
- Restaura também no cancelamento, falha ao abrir a captura, perda do mic e encerramento normal do helper.
- Não baixa se uma reunião está gravando. Iniciar reunião durante um ditado libera a alteração antes de iniciar a captura da reunião, nas duas entradas de comando.
- **Headless e KIWI_DEBUG usam adaptador nil:** nem leem nem escrevem o volume real. Os testes usam `FakeVolume`.
- Com a 213, os cues ficarão fora dessa alteração: início antes de baixar o volume e abrir o mic, fim após restaurar (combinado #5880/#5897/#5898).

Verificação:

- `swift test`: **286 KiwiHelperCore + 2 KiwiExport, zero falhas**. Build debug completo do helper passou.
- Dezoito testes com volume falso: ordem antes da captura; restauração/falha; begin/end repetidos e próxima captura; reunião; ajuste manual; troca/desconexão; indisponível/read-only; volume zero e adaptador desabilitado; canais estéreo e quantização. Também verifica arquivo 0600 antes da primeira mudança, morte sem `end()`, nova instância, queda real de processo filho com **SIGKILL**, ajuste manual após queda, marcador não gravável/corrompido, falha ao restaurar, renumeração por UID e saída desconectada pendente.
- `bun test`: **1.083 passaram**, zero falhas. `bun run typecheck`: sem erros.
- `fake-media-crash-tests.txt` é a saída integral, sem edição, de `swift test --package-path ../native --skip-build --filter DictationMediaTests` executado em `app/` (18/0). O log da primeira rodada, `fake-media-tests.txt`, também foi preservado. É a prova em log permitida pelo spec da onda 4. Nenhum teste chamou o adaptador de volume do sistema ou um player real; nenhum som foi tocado, nenhum microfone aberto e nenhum diálogo disparado.

A mídia real, a audibilidade e a restauração no dispositivo da pessoa ficam para o roteiro da rc11. As checagens dos agentes comprovam o controlador e os caminhos de ciclo de vida; não alegam que tocamos mídia real.
