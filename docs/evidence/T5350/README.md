# T5350 · L10: log em arquivo e "Salvar diagnóstico"

Issue #161, onda 1 do levelup. Headless com dados sintéticos num tmp, sem helper, sem mic, sem diálogo e sem nada na tela.

```sh
cd app
bun run cli start --no-helper --data "$DIR"
bun run cli ui hub --script scripts/ui-scripts/hub-diagnostico.json --data "$DIR" --theme light
bun run cli stop --data "$DIR"
# o .txt fica em $DIR/diagnostics e o log em $DIR/logs/kiwi.log
```

| arquivo | o que mostra |
|---|---|
| `01-sobre-com-diagnostico-*` | Sobre: o "Salvar diagnóstico" embaixo, discreto, com a linha do que leva |
| `02-diagnostico-salvo-*` | depois do clique: onde ficou o arquivo |
| `exemplo-diagnostico-headless.txt` | o .txt gerado (headless sem helper: "sem o helper" no lugar do estado); o tmp virou `<tmp>` |
| `exemplo-kiwi.log` | o log em arquivo do mesmo roteiro |

Com o helper de pé (o app de verdade), o .txt traz também a versão e o pid do helper, as permissões (só o estado), o STT, o boosting e as quedas. Os testes de `src/bun/diagnostics.test.ts` conferem esse caso com um estado sintético. A rotação, o nível, o `~` e o `console` passando pelo arquivo estão em `src/bun/file-log.test.ts`.
