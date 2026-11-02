# Kiwi Notes: fase 1, ditado (rascunho v3)

**Em uma frase:** um segundo cérebro local para macOS que se alimenta sozinho. Ele ouve seu ditado e suas reuniões, descobre de qual projeto é cada coisa, mantém a pasta do projeto atualizada para o Claude Code e te cobra o que ficou pendente.

**Ordem (decidida em #33): ditado primeiro.** Este spec cobre a **fase 1**: o ditado no nível do Wispr Flow, sobre o shell do app que as próximas fases reaproveitam. Reuniões e o resto viram specs próprios depois (veja "Roadmap").

## Princípios
- **100% local.** Áudio, transcrição e texto ficam no Mac, sem servidor nem conta (#21: a política da empresa permite; o Copilot é o que não serve). **Única exceção: o Claude Code (#34)**, usado nas fases seguintes para notas e atualização de projeto. Na fase 1 o ditado não depende dele.
- **Zero atrito.** Um atalho e você fala; o texto aparece limpo onde o cursor está.
- **Arquivos simples.** Histórico e configurações em arquivos locais legíveis.
- **Pouco por vez.** A fase 1 é usável sozinha no dia a dia.

## Fase 1: o que o ditado faz
1. **Atalho global.** Segurar uma tecla grava (push-to-talk) e duas batidas travam a gravação ligada (toggle). As duas teclas são configuráveis, e o padrão é Fn/🌐 ou ⌥ direito.
2. **Overlay mínimo.** Uma pílula flutuante perto do cursor ou da notch, com a onda de áudio animada no estilo do Channels. Não rouba o foco.
3. **Transcrição local em tempo real.** Com WhisperKit ou Parakeet (FluidAudio), latência curta depois de soltar a tecla (meta: menos de 1 s para frases curtas no M1 Pro). Português e inglês, misturados na mesma frase.
4. **Limpeza do texto (o que faz o Wispr Flow ser bom).** Tira "é, hum, tipo", aplica as autocorreções faladas ("não, quer dizer…"), pontua, cria parágrafos e listas, e ajusta o tom ao app ativo (Slack/Teams mais casual, e-mail mais formal, terminal e IDE literal). Roda local, com Apple Foundation Models (on-device) ou um modelo MLX pequeno, para não pagar a latência da nuvem a cada frase.
5. **Inserção.** Cola no app ativo e preserva o clipboard. Se não houver campo de texto, deixa no clipboard e avisa.
6. **Dicionário pessoal e snippets.** Termos técnicos do trabalho (DICOM, PACS, Healthcare API, nomes de projetos e de pessoas) entram como vocabulário. Snippets por voz ("meu e-mail" → texto).
7. **Histórico local.** Cada ditado (áudio opcional, transcrição crua e texto final) fica salvo, com busca. Ele é a semente das notas das fases seguintes.

## Stack
- **App:** Electrobun Livewire (fork da Kiwi; main em Bun mais WKWebView). UI em **React + TypeScript + Vite**, com animações no estilo do Channels: soft, smooth e com cara de macOS premium. Fica na barra de menu, com janela de configurações e de histórico.
- **Nativo:** um helper em Swift (sidecar) para áudio, atalho global, overlay, inserção de texto (Accessibility) e notificações. O Bun conversa com ele por um socket local.
- **STT:** WhisperKit ou Parakeet via FluidAudio. A escolha sai de um benchmark de latência e precisão em PT-BR no M1 Pro.
- **Limpeza:** um LLM local (Apple Foundation Models / MLX).
- **Referência:** VoiceInk (GPL-3.0) só como referência de arquitetura, sem copiar código.
- **Dev loop:** o `ELECTROBUN_AGENT_CONTROL=1` do Livewire deixa os agentes dirigirem e testarem o app.

## Roadmap (specs futuros)
- **Fase 2, reuniões:** captura do áudio do sistema mais o microfone (Core Audio taps, sem bot e sem integração com o Teams) → transcrição com diarização local → notas → roteamento de projeto → `<projeto>/.kiwi/` (INDEX, STATUS, todos, meetings) → contexto no Claude Code → lembretes no macOS.
- **Fase 3, visão e memória:** diagramas por projeto (Mermaid ou BonsAI), estudos com revisão espaçada, busca semântica, cobranças diárias.

## Fora do escopo da fase 1
Reuniões, roteamento de projeto, diagramas, sync na nuvem, mobile, Windows e Linux.

## Perguntas em aberto (para @harry)
1. **Atalho padrão:** Fn/🌐 (igual ao Wispr Flow) ou ⌥ direito?
2. **macOS:** Apple Foundation Models exige o Apple Intelligence ligado. Está ligado aí?

## Done when
- [ ] Segurar o atalho em qualquer app, falar em PT-BR ou EN e soltar insere o texto limpo no campo ativo.
- [ ] O modo toggle (duas batidas) funciona para ditados longos.
- [ ] Transcrição e limpeza rodam 100% no Mac: com o Wi-Fi desligado, tudo continua funcionando.
- [ ] Frases curtas aparecem em menos de ~1 s depois de soltar a tecla, no M1 Pro.
- [ ] O texto sai sem muletas, pontuado, com as autocorreções faladas aplicadas e o tom ajustado ao app ativo.
- [ ] O dicionário pessoal corrige termos técnicos (DICOM, PACS etc.) e os snippets por voz funcionam.
- [ ] O histórico local é pesquisável, e o clipboard do usuário é preservado.
- [ ] O app roda em Electrobun Livewire com React + TS + Vite, na barra de menu, com o overlay animado no estilo do Channels.
