# ADR 0004: o motor do VoiceInk dentro do Kiwi, e a licença GPLv3

- Status: aceito (decisão do harry em #254, opção A do #252; T257)
- Origem: [VoiceInk](https://github.com/Beingpax/VoiceInk) no commit `19546d2a7f85578f49efb538eb888b37ff2f8f8c` (GPL-3.0)

## Contexto
O VoiceInk é um app de ditado para macOS, em Swift e open source, e já resolve as partes difíceis da fase 1: transcrição local com Parakeet (FluidAudio) e Whisper, pós-processamento com o dicionário, colagem no app ativo e limpeza com IA local (MLX, com um modelo próprio). O spec dizia para usá-lo "só como referência, sem copiar código". O harry pediu para usar o motor dele (#247).

A leitura do código (#255) mostrou que:
- a chamada ao Parakeet é a mesma do nosso benchmark (T51);
- ele tem a dica de idioma, o encoder int8, o VAD (Silero) e modelos de streaming;
- o dicionário age depois da transcrição: filtro, depois `PhoneticVocabularyMatcher`, depois substituição de palavras e, opcionalmente, IA;
- ele também oferece STT e LLM na nuvem, além de atualização pelo Sparkle e config remota.

## Decisão
- **O app continua o nosso:** Electrobun com React, barra de menu, Configurações, Histórico, o overlay e o sidecar Swift com o IPC do ADR 0001.
- **O sidecar porta o motor local do VoiceInk** para transcrever (T256), colar (T55) e limpar com IA (T52). As regras em TS continuam como caminho rápido da limpeza (#171).
- **Só a parte local entra.** Ficam de fora os provedores de nuvem (OpenAI, Groq, Deepgram e outros), o Sparkle, o RemoteConfig, os `announcements` e o licenciamento pago. Com o Wi-Fi desligado, tudo funciona.
- **Cada arquivo portado** diz no topo de onde veio e o que mudou:
  ```swift
  // Portado de VoiceInk/<caminho> @ 19546d2 (GPL-3.0). Mudanças: <o que mudou>.
  ```
- **O modelo VoiceInk-Refine fica de fora.** O LICENSE.md dos pesos (`beingpax/VoiceInk-Refine-V1`) só permite o uso no app VoiceInk, e a GPLv3 do código não cobre os pesos (#267). A limpeza com IA usa os prompts (`AIPrompts`) e o `AIEnhancementOutputFilter` do VoiceInk, com o Foundation Models ou um modelo aberto (T270).
- **Dependências em releases fixas:** o FluidAudio entra numa release, não na branch `main` que o VoiceInk usa.

## Consequências
- **O Kiwi Notes passa a ser GPLv3** (`LICENSE` e `NOTICE` na raiz). O repo é privado e de uso pessoal, então nada muda hoje. Se um dia o app for distribuído, o código-fonte inteiro precisa ir junto, sob a GPLv3.
- O que já está pronto e testado (o atalho, o mic, o overlay e o histórico) fica. A colagem e a limpeza ganham o jeito do VoiceInk onde ele for melhor.
- Atualizar o motor quer dizer comparar com um commit novo do VoiceInk e portar a diferença à mão. Não há dependência de build com o repo dele.
