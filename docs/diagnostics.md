# Log e diagnóstico (T5350, issue #161)

## O log em arquivo
- Fica em `~/Library/Application Support/KiwiNotes/logs/kiwi.log` (`KIWI_DATA_DIR/logs` nos testes e no headless).
- Cada linha do `console` do app vai também para o arquivo, com a hora (UTC) e o nível. A pasta da pessoa vira `~`.
- Gira em 1 MB: `kiwi.log` → `kiwi.1.log` → … → `kiwi.3.log`. O log nunca passa de uns 4 MB.
- Nível: `KIWI_LOG_LEVEL=debug|info|warn|error`. O padrão é `info`, e `debug` com `KIWI_DEBUG=1`.
- Do helper, só entram o diagnóstico do mic do ditado e da reunião (`mic: diag …`, `meeting mic: diag …`, #208) e as quedas, com o código de saída. O resto do helper fica de fora, porque o dryRun loga o texto do ditado.
- Nunca entram texto de ditado, texto de nota ou áudio. Um erro pode citar o caminho de uma nota (o nome do arquivo).

## Salvar diagnóstico
Em **Sobre › Salvar diagnóstico** (capacidade `diagnostics.save`, contrato 1.25.0), o app grava `Kiwi Notes diagnóstico AAAA-MM-DD HHhMM.txt` em `~/Downloads` e mostra o arquivo no Finder. O arquivo leva:
- a versão e o canal do app, e o contrato da UI;
- macOS, arquitetura, processador e memória;
- o helper: se está de pé, a versão, o pid, se o atalho recebe teclas e as quedas desde que o app abriu;
- as permissões, **só o estado**: nada é pedido, nenhum diálogo abre;
- o STT, o boosting do vocabulário, o microfone escolhido e o atalho das Notas;
- os relatórios de crash do macOS do Kiwi em `~/Library/Logs/DiagnosticReports`: só o nome e a data, sem abrir;
- as últimas 400 linhas do log.

Com `KIWI_DEBUG=1` e no headless, o arquivo vai para `<dados>/diagnostics` e nada abre na tela. No headless, os crashes vêm só de `KIWI_CRASH_DIR`, nunca dos reais.
