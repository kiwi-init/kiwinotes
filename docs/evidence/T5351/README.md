# T5351 · helper vigiado

Spec Kiwi #5289, versão #5336 (onda 1), issue #153. Nenhum helper Swift, app na tela, mic, permissão ou clipboard. O processo de teste é `app/test/helpers/supervisor-helper.ts`: Bun puro, IPC falso, `ready` e exit 7; no modo `hang`, ignora SIGTERM e o fechamento do socket.

Reprodução antes da mudança: um fake que cai 10 ms depois de `ready` inicia **3 vezes em 1,15 s**. Depois, inicia só **2 vezes** nesse intervalo: a 2ª espera é de 1 s, pois `ready` não zera mais a conta.

## Política

| Limite | Padrão |
|---|---|
| Estabilidade para zerar o backoff | 60 s depois de ready |
| Ready depois do spawn | 15 s |
| Ping / prazo / perdas seguidas para reiniciar | 10 s após a resposta ou prazo / 5 s / 3 (~45 s sem resposta) |
| SIGTERM → SIGKILL | 2 s |
| Espera entre reinícios | 0,5 s, 1 s, 2 s… até 30 s |
| Limite de quedas | 5 em 5 minutos |

A janela de quedas usa relógio monotônico e não é zerada pela estabilidade: só o backoff é. Ao atingir o limite, para de reiniciar e o menu diz **“O ditado está com problema”**. Para tentar de novo, a pessoa reabre o app. Um processo novo só nasce depois de o anterior sair. Perder o socket também termina o processo antigo; se ele ignorar SIGTERM, recebe SIGKILL.

`stop()` cancela reinício, ready/ping/estabilidade e pedidos pendentes, manda SIGTERM e espera a saída, com SIGKILL após 2 s. A saída normal do app admite até 3 s para esse encerramento. No evento final `exit` do Bun, uma defesa síncrona manda SIGKILL ao filho que ainda existir.

## Log e diagnóstico

Linhas `[sidecar] supervisor …`, sem payload de comandos/eventos: spawn/ready/stable em INFO; timeout/exit/backoff em WARN; failed em ERROR. As 20 últimas saídas continuam em `sidecar.exits`, com código e sinal, para o diagnóstico da L10 (#219). O diagnóstico inclui o estado do supervisor. A ordem do kernel pode avisar o fechamento do socket antes do exit; o código e o sinal da saída permanecem no registro.

## Prova headless

A CLI expõe `helper: failed`, `session.supervision` e `menuLabel`. Essa legenda vem da **mesma função** usada pelo menu da barra. O roteiro real de cinco quedas verifica a legenda, cinco saídas com código 7 no log em arquivo e no diagnóstico; o teste de processo travado verifica o SIGKILL real e que o PID morreu.

O print mostra uma **nota de evidência**, criada com o status e os logs reais dessa CLI. Não é uma nova tela nem um menu simulado. Os JSONs e o trecho do log acompanham o print.

```sh
cd app
bun test src/bun/sidecar.test.ts src/headless/supervisor.test.ts src/bun/session-status.test.ts
bun run typecheck
KIWI_HELPER="$PWD/test/helpers/supervisor-helper.ts" KIWI_FAKE_SUPERVISOR=crash bun run cli start --data /tmp/kn-supervisor-proof
# Depois de ~8 s:
bun run cli status --data /tmp/kn-supervisor-proof
bun run cli invoke diagnostics.save '{}' --data /tmp/kn-supervisor-proof
bun run cli stop --data /tmp/kn-supervisor-proof
```

## Resultado final

- `bun test src scripts ui`: **976 passaram, 0 falharam**, sobre a main com a L10 e o cache do índice (#219 e #220).
- `bun run typecheck`: limpo.
- Supervisor/CLI focados: **25/0**; inclui processos de verdade falsos, sem Swift nem dispositivos.
- WebKit: pronto, sem erros da página, rede bloqueada ou erros de invoke (`ui-validation.json`).
- O headless da evidência foi fechado e o lock bench liberado.

## Ajuste da revisão #5448

Um ping isolado perdido não termina o helper. São necessárias três perdas consecutivas; qualquer resposta válida de ping zera a conta, inclusive tardia. Os ids recentes ficam limitados a dez e são descartados ao trocar ou encerrar o processo, para um resultado antigo não interferir em outro helper. Cada tentativa espera 10 s e dá 5 s para a resposta: cerca de 45 s de silêncio contínuo antes da decisão, sem sondas sobrepostas nem acúmulo de timers ao acordar o Mac.

Testes adicionais: duas perdas, um pong e mais duas perdas mantêm o helper; três perdas consecutivas terminam; pongs que chegam após o prazo também evitam a acumulação. Os artefatos de cinco exits e o print continuam os mesmos: a política de quedas não mudou.
