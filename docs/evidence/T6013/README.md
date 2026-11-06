# T6013 · L17 · Busca semântica local

Issue #168, spec Kiwi #5849 (decisão #4766), plano aprovado pelo lead no #6282. O empacotamento do ONNX Runtime é a T6318 (@keen-vole), no mesmo branch.

## O que entra

- **Modelo:** `multilingual-e5-small` (MIT), no ONNX quantizado do `Xenova/multilingual-e5-small`, na revisão fixa `761b726`. São 3 arquivos e 135 MB, baixados uma vez do huggingface.co para `<dados do app>/models/`. Cada arquivo tem o SHA-256 conferido antes de entrar: um arquivo errado ou cortado é apagado e nunca é usado.
- **Runtime:** `onnxruntime-node` 1.30.0 (MIT) e `@huggingface/tokenizers` 0.2.0 (Apache-2.0), no processo do app. O texto nunca sai do Mac.
- **Índice:** a nota é dividida em trechos de ~200 tokens, e só os vetores ficam em `<dados do app>/folders/<chave>/semantic/vectors.bin`, fora do cofre e por versão da nota. O texto das notas não vai para o arquivo, e o teste confere isso. A fila roda em segundo plano, em lotes de 8, com 2 threads.
- **Busca:** o `notes.search` (a paleta e o agente) soma o BM25 e o sentido por RRF. O exato continua na frente e é reordenado pelo sentido; o que vem só pelo sentido aparece marcado ("pelo sentido") e antes do aproximado (erro de digitação). Os filtros `tag:`, `path:`, `-` e "frases" valem para tudo.
- **"Perto o bastante":** o e5 dá entre 0,80 e 0,84 até para o que não tem nada a ver. Uma nota entra só pelo sentido com 0,835 ou mais **e** pelo menos 0,025 acima da mediana das notas para aquela busca. Medido no modelo de verdade: 9 de 10 buscas acharam a nota certa, e as 3 sem nota certa não trouxeram nada.
- **Configurações:** "Buscar pelo sentido" fica ligada por padrão e mostra o estado (baixando, lendo as notas, pronta). Desligar apaga o modelo e os vetores.
- **Memória:** com o modelo carregado são ~0,55 GB (o tokenizer ~0,2 GB e o ONNX ~0,1 GB). Depois de 10 min sem uso, o modelo sai da memória e volta na próxima busca, em ~0,5 s em segundo plano.
- **Saída limpa:** o app e o headless soltam o ONNX Runtime antes de sair. Sem isso, o Bun caiu em 2 de 3 saídas depois de uso pesado.

## Verificação

- `bun test`: 1151 passaram, 0 falharam, 1 pulado (o teste com o modelo de verdade, que roda com `KIWI_MODELS_DIR`); `bun run typecheck` limpo.
- `e5.txt`: com o modelo de verdade, 8 buscas sem palavra em comum acham a nota certa, e 3 buscas sem nota certa não trazem nada.
- `benchmark.txt` (com `kiwi lock bench`): 1000 notas sintéticas, 2000 trechos em 65 s em segundo plano, arquivo de 3,1 MB, busca com mediana de 4,1 ms (máximo 9,1 ms), e reabrir sem mudança não refaz nada.
- O download real com o downloader do app: os 3 hashes conferidos em 6,5 s.
- WebKit headless, sem helper, sem janela, mic, clipboard ou diálogo:

```sh
cd app
bun run cli start --no-helper --data /tmp/kiwi-l17
KIWI_MODELS_DIR=/tmp/kiwi-models bun run cli ui notes --script scripts/ui-scripts/notas-sentido.json --out /tmp/kiwi-l17-prints --data /tmp/kiwi-l17
KIWI_MODELS_DIR=/tmp/kiwi-models-copia bun run cli ui hub --script scripts/ui-scripts/ajustes-sentido.json --out /tmp/kiwi-l17-prints --data /tmp/kiwi-l17b
```

O 2º roteiro desliga a busca e por isso apaga o modelo: rode com uma cópia.

## Limites

- O e5 é pequeno: "cópia de segurança dos dados" pôs a nota "Portaria" ("Segurança do prédio…") antes da nota "Backup", pela palavra em comum. As duas aparecem; a ordem fica com o modelo.
- O headless não baixa nada: usa só um modelo que já está no disco (`KIWI_MODELS_DIR`).
