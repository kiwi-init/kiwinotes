# T5561 · E12: dividir nota, ferramentas de texto e /

No menu E2, **Ferramentas de texto** ordena linhas naturalmente (item2 antes de item10), remove duplicadas exatas mantendo a primeira, e muda maiúsculas/minúsculas com acentos. Ordenar/remover duplicadas expande a seleção para linhas inteiras, sem incluir a próxima linha quando a seleção termina no começo dela. Sem seleção, considera a linha atual; maiúsculas/minúsculas exigem seleção. Cada mudança tem seu próprio desfazer. Múltiplos cursores ficam desabilitados.

**Dividir nota aqui** exige um cursor entre o início e o fim. Cria primeiro uma nota `Título — continuação` na mesma pasta, pelo fluxo de criação que já evita sobrescrever nomes. Só depois remove o trecho do editor original e abre a continuação pelo fluxo normal de salvar/sair. Nenhum caractere é aparado ou adicionado à divisão. Se a criação falhar, o original não muda. Se a seleção/documento/nota mudar durante a espera, mantém o original inteiro, deixa a cópia criada e avisa seu caminho. Conflito ou rascunho pendente de decisão desabilita o comando. Falha ao salvar a origem fica no tratamento normal de rascunho/erro, sem apagar a continuação. Trocar entre notas de conteúdo idêntico agora também cria um novo estado do editor (e zera seu histórico), invalidando uma divisão atrasada.

O `/` ordena correspondência exata de nome/alias, prefixo e trecho, nessa ordem, sem acentos/caixa. Frequência desempata. Na consulta vazia, a seção **Mais usados** vem primeiro; guarda apenas contagens limitadas por ID de comando no armazenamento local, sem texto das notas. **Amanhã** e **Ontem** usam o calendário local (`setDate`, sem somar 24 horas). Nenhum código de outro projeto foi portado.

Verificação:

- `bun test`: 1.074 testes, zero falhas. `bun run typecheck`: sem erros.
- 12 testes focados (`tools.test.ts` e `slash.test.ts`): escopo de linhas, Unicode, undo, criação falha/atrasada, troca para nota idêntica, limites do cursor, ordem de busca/uso e virada de mês/ano.
- `scripts/ui-scripts/notas-ferramentas-texto.json`: **76 passos em cada tema**, WebKit headless. Usa as quatro ferramentas, divide, confere a nova nota, insere amanhã/ontem, confirma Mais usados antes dos demais e lê as duas notas salvas. `ui-proof.json` contém as notas sintéticas; o original ficou `item2\nitem10\n\n` e a continuação preservou o trecho e as datas esperadas.
- Regressão E2: 70 passos passaram, sem erros de página/CSP. Sem mudança nativa; nenhum helper, mic, clipboard real, diálogo ou janela na tela foi necessário.

Reprodução a partir de `app/`, com diretório novo:

```sh
bun run cli start --no-helper --data /tmp/e12-proof
bun run cli ui notes --script scripts/ui-scripts/notas-ferramentas-texto.json --theme light --out /tmp/e12-light --data /tmp/e12-proof
bun run cli stop --data /tmp/e12-proof
```

Os quatro prints por tema mostram as ferramentas, a divisão, amanhã e os comandos mais usados.
