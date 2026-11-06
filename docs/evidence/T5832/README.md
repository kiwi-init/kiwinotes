# T5832 · L8: baixar a mídia durante o ditado

Implementa a opção aprovada **baixar o volume**, por propriedades públicas de volume escalar do Core Audio. Durante a captura do ditado, o volume vai a 25% do valor original; ao fechar a captura, restaura o valor anterior. Não envia comandos a players, não abre apps e não usa AppleScript/Automação. Código original do Kiwi.

A escolha foi aceita pelo lead no Kiwi #5869: atende ao “pausa ou baixa” do harry sem depender de MediaRemote. A referência [mediaremote-adapter](https://github.com/ungive/mediaremote-adapter) foi consultada: nas versões novas, seu bridge usa o binário Perl do sistema carregando um framework próprio. Nada desse bridge foi incluído ou executado. Não houve porte de código nem nova dependência.

O controlador guarda dispositivo **e UID** e os canais alterados (master, ou canais individuais). Considera a quantização aceita pelo driver. Só restaura um canal se o valor ainda é o que o Kiwi escreveu: preserva o ajuste manual da pessoa e não altera a nova saída quando ela troca de dispositivo. Dispositivo desconectado e volume não ajustável são tratados sem bloquear a captura. Um dispositivo sem volume escalar ajustável não será baixado; fica o código `media: volume_unavailable` no log.

Integração no helper:

- Baixa antes de `record.started`/`audio.start`; restaura depois de o mic fechar, no início de `finishRecording`, sem esperar STT/colagem.
- Restaura também no cancelamento, falha ao abrir a captura, perda do mic e encerramento normal do helper.
- Não baixa se uma reunião está gravando. Iniciar reunião durante um ditado libera a alteração antes de iniciar a captura da reunião, nas duas entradas de comando.
- **Headless e KIWI_DEBUG usam adaptador nil:** nem leem nem escrevem o volume real. Os testes usam `FakeVolume`.
- Com a 213, os cues ficarão fora dessa alteração: início antes de baixar o volume e abrir o mic, fim após restaurar (combinado #5880/#5897/#5898).

Verificação:

- `swift test`: **277 KiwiHelperCore + 2 KiwiExport, zero falhas**. Build debug completo do helper passou.
- Nove testes novos com volume falso: ordem antes da captura; restauração/falha; begin/end repetidos e próxima captura; reunião; ajuste manual; troca/desconexão; indisponível/read-only; volume zero e adaptador desabilitado; canais estéreo e quantização.
- `bun test`: **1.083 passaram**, zero falhas. `bun run typecheck`: sem erros.
- `fake-media-tests.txt` é a saída integral, sem edição, de `swift test --package-path ../native --skip-build --filter DictationMediaTests` executado em `app/`. É a prova em log permitida pelo spec da onda 4. Nenhum teste chamou o adaptador de volume do sistema ou um player real; nenhum som foi tocado, nenhum microfone aberto e nenhum diálogo disparado.

A mídia real, a audibilidade e a restauração no dispositivo da pessoa ficam para o roteiro da rc11. As checagens dos agentes comprovam o controlador e os caminhos de ciclo de vida; não alegam que tocamos mídia real.
