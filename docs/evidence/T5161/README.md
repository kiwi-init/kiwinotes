# T5161 · pasta das notas

Spec Kiwi #5149, versão #5172. Dados e textos sintéticos em tmp; helper desligado; seletor falso via `KIWI_TEST_NOTES_FOLDER`. Nenhum seletor nativo, app na tela, microfone ou diálogo de permissão.

Reprodução do roteiro:

```sh
cd app
# Criar DIR/vault/Nota interna.md, DIR/vault/Reuniões/2026-11-05 14h32 Reunião do Teams.md (frontmatter `type: meeting`)
# e EXTERNA/Projeto Atlas.md, EXTERNA/Pessoas/Ana.md e EXTERNA/.obsidian/app.json (pastas de teste).
KIWI_TEST_NOTES_FOLDER="$EXTERNA" bun run cli start --no-helper --data "$DIR"
bun run cli ui hub --script scripts/ui-scripts/notas-pasta.json --data "$DIR" --out ../docs/evidence/T5161
bun run cli stop --data "$DIR"
```

A pasta externa deve se chamar `Obsidian de teste`. O roteiro mostra a árvore original, abre a pasta pelo controle das notas, confere a árvore nova, edita uma nota, abre a aba Reuniões com a pasta externa aberta (a reunião continua vindo da pasta interna, spec #5149 v5172), volta pela lista de recentes e confere o controle nos Ajustes.

| print | o que mostra |
|---|---|
| `01-pasta-padrao.png` | a árvore da pasta padrão |
| `02-arvore-externa.png` | a pasta do Obsidian aberta, com subpasta |
| `03-editada-na-pasta.png` | uma nota editada no Kiwi, gravada na pasta escolhida |
| `04-pastas-recentes.png` | o menu "Abrir pasta…" e as recentes |
| `05-reunioes-na-base-interna.png` | a aba Reuniões com a pasta externa aberta: a reunião continua na pasta do Kiwi |
| `06-ajustes-pasta.png` | Configurações › Notas › Pasta das notas |

Depois do roteiro, a `.obsidian/app.json` da pasta externa fica igual, e nada novo aparece nela. Os relatórios guardam os passos e as chamadas ao engine.

Testes automatizados adicionais: preferências e versões separadas por pasta, anexos, wikilinks, busca, watcher, rascunhos com mesmo caminho, pasta grande com confirmação/cancelamento, acesso negado e proteção dos dados reais no headless. Listar/abrir/editar/renomear/apagar/desfazer reuniões continua na base interna mesmo com notas externas. O histórico do ditado permanece global. O teste humano com o Obsidian é do harry, pedido pelo lead.
