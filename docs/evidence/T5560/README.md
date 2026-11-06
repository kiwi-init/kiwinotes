# T5560 · E6: ortografia local no editor

Ativa `spellCheck` na BrowserWindow de Notas/hub e `spellcheck=true` no conteúdo do CodeMirror. Código, URLs e wiki-links recebem `spellcheck=false`. Não há substituição automática. A marcação depende do WebKit e dos idiomas instalados no macOS.

O menu E2 consulta uma palavra, apenas ao abrir por clique direito ou teclado. O helper usa as APIs de dados `NSSpellChecker.checkSpelling` e `guesses`, sem painel, alteração de idioma, preferências ou dicionário. A linguagem vem do documento (`pt-BR` atualmente), com correspondência ao idioma disponível. Sem helper/dicionário, ou após 600 ms, abre o menu comum. Até oito sugestões; escolher uma troca só a palavra e cria um passo próprio de desfazer. Respostas atrasadas são descartadas após outra ação, mudança de documento ou fechamento; uma sugestão já aberta também guarda o documento original.

Contrato AppEngine 1.31.0: `spelling.suggest({word, language?})`. IPC aditivo: `spelling.check`. Os dois limites validam palavra única, idioma e tamanho; sugestões são limitadas, deduplicadas e sem caracteres de controle/quebras de linha. Nada é enviado à rede. A exclusão por sintaxe adapta SilverBullet (MIT), com commit e licença em `spelling.ts`.

Verificação:

- `bun test`: 1.067 testes, zero falhas; `bun run typecheck`: sem erros.
- `swift test`: 265 testes de KiwiHelperCore e dois de KiwiExport, zero falhas. Inclui seis testes novos com corretor falso. Build debug do helper completo passou.
- Helper real em modo headless: `spelling.suggest` com a palavra sintética `reuniao`, idioma `pt-BR`, retornou erro ortográfico e incluiu `reunião`. O resumo guarda apenas booleanos, sem a lista de sugestões do sistema.
- `notas-ortografia.json`: 55 passos WebKit headless por tema. Clique direito abre sugestões; a escolha corrige só a palavra, ⌘Z/⇧⌘Z desfaz/refaz; palavra correta e código não mostram a seção; outra tecla cancela consulta atrasada. Confere atributos do editor e código, e o Markdown salvo.
- Regressão E2 (`notas-menu-editor.json`): 70 passos passaram, com espera pelo menu antes das setas.
- Os prints claro/escuro usam **corretor falso explícito**, para reproduzir o menu independentemente dos dicionários da máquina. Não provam o desenho do sublinhado nativo do WKWebView. Esse desenho fica para o teste do build pela pessoa; não abrimos o app na sessão dela nem desenhamos sublinhados artificiais.

Reproduzir o roteiro a partir de `app/`, em diretório de dados novo:

```sh
KIWI_FAKE_SPELLING="$PWD/scripts/ui-scripts/fixtures/spelling.json" bun run cli start --no-helper --data /tmp/e6-proof
bun run cli ui notes --script scripts/ui-scripts/notas-ortografia.json --theme light --out /tmp/e6-light --data /tmp/e6-proof
bun run cli stop --data /tmp/e6-proof
```

`ui-proof.json` resume as execuções e o texto sintético salvo. Sem mic, clipboard real, diálogos, preferências ou janela na tela.
