# As vozes do Kiwi-cat: o catálogo e as receitas

Spec #27531 (T27778), sobre o runtime da voz do [ADR 0014](../adr/0014-runtime-da-voz.md). O código está em
`app/src/shared/cat-voices.ts` (o id, o nome e a descrição mostrados) e em `app/src/bun/cat-voice-model.ts` (o WAV,
o texto dele e o texto do Ouvir).

## O catálogo

| Id | Nos Ajustes | Descrição | Idioma | WAV de referência | Bytes | SHA-256 |
|---|---|---|---|---|---:|---|
| `en-a` | Kiwi EN-1 | Animada e divertida | inglês | `T-ref.wav` | 566444 | `e1fe8f725c475e65be6dcceb5128e07ae693ec6be3c605da20a48a0dc26f7d80` |
| `en-b` | Kiwi EN-2 | Suave e fofa | inglês | `B-ref.wav` | 662444 | `0c75109a3de8af28611055f249d3f9263b052d229878a9db6b928b3c922418d8` |
| `pt-a` | Kiwi PT-1 | Leve, com sotaque brasileiro | português | `PT-ref.wav` | 440684 | `76f2e075ec3659fe120b690274337b1d9fb8209f6c7c9340b84336d79b6b20e1` |

- **A padrão é a `pt-a`** (harry #28142, T28150). Quem nunca escolheu ouve a Kiwi PT-1, e o seletor de idioma abre
  em Português. Uma escolha guardada (`kiwicat.voz`) não muda.
- **O id é estável.** O nome e a descrição podem mudar sem mexer no que já foi baixado nem na escolha guardada
  (`kiwicat.voz`).
- **Cada WAV fica num diretório só dele** (`cat-voice-<id>`, revisão `cat-voices-1`). Baixar ou apagar uma voz não
  mexe na outra. Os pesos do Qwen3-TTS são os mesmos para todas.
- **A URL é fixa:** `https://github.com/kiwi-init/kiwinotes/releases/download/cat-voices-1/<WAV>`. O release
  `cat-voices-1` está publicado (pre-release, não é o latest), com os três WAV (#28153).
- **O WAV:** PCM16 mono, 24 kHz, 11,8 s (en-a) e 13,8 s (en-b). São três falas da rodada 11, com dois intervalos de
  300 ms.
- **A transcrição dos dois** (o `refText` do clone), que também é o texto do Ouvir:
  `Hi. I'm Kiwi. Your notes have a cat now. Hmm. Found it. That note was hiding. Done. Your note is right where it belongs.`
- **A `pt-a`:** a referência original, a R0, nunca a refinada R1, que afinava o timbre no fim das frases longas
  (harry #28133). A transcrição dela (o `refText`):
  `Achei! Era exatamente essa nota que você queria! Pronto. A nota está salva e organizada.`
  O Ouvir dela fala outras três frases: `Oi. Eu sou o Kiwi. Suas notas agora têm um gato.`,
  `Hum. Achei. Essa nota estava escondida.` e `Pronto. Sua nota está no lugar certo.`

## As receitas (#27781)

- **O modelo de origem:** VoiceDesign `Qwen3-TTS-12Hz-1.7B-VoiceDesign-bf16` @
  `7d3824abff87e49756bb0f83fb5411de75d160c4`, mlx-audio 0.6.8, `language="english"`.
- **A semente** é reiniciada antes de cada fala: 1113 para a en-a e 1133 para a en-b.
- **Sem pós-processamento:** sem clone e sem efeito na geração de origem.

A base da descrição, igual para as duas:

> The voice of a small animated cat character from a cartoon, a little companion that lives in a notes app. It is a
> character voice, not a realistic human voice: androgynous, neither clearly male nor clearly female, and not a child.
> Small and light, clear articulation, short lines. Clean studio recording.

O que se acrescenta, depois de um espaço:

- **en-a:** `Mischievous: playful and teasing, a bouncy rhythm with a grin in the voice, as if it is up to something.`
- **en-b:** `A cute little creature: soft, cozy and gentle, rounded tone, with a faint purring quality in the way it speaks.`

A `pt-a` é a referência R0 da rodada em português (#28133), com `language: "portuguese"` no app.

## Como o app usa

- **Um clique baixa tudo:** o modelo e todas as vozes do catálogo, com o SHA-256 conferido. O tamanho mostrado é a
  soma.
- **Com o modelo no disco e uma voz faltando,** o botão vira "Completar as vozes" e baixa só o que falta, sem os pesos.
- **O erro é de cada voz** (`download` ou `hash`). Uma voz quebrada não cala o gato: a fala usa a escolhida, ou, se ela
  não está no disco, a primeira do catálogo que está.
- **Remover apaga o modelo e todas as vozes.**
- **Trocar de voz não baixa nada.** Cada `speak` do `kiwi-voice` leva a voz (`refAudio`, `refText`, `language`), lida
  uma vez por fala. A fala que está tocando termina na voz antiga, e a próxima já sai na nova. O processo quente não
  recarrega o modelo.
- **O Ouvir** fala o texto fixo da voz daquela linha, sem mudar a escolhida e sem o agente.
  - Uma prévia nova corta a anterior.
  - Durante uma fala do gato, a prévia espera ela acabar.
  - Sem a voz no disco, a linha mostra o botão de baixar, e o Ouvir nunca baixa.
  - A saída de som de verdade é o T27825. Até lá, só o headless (uma saída muda) tem o Ouvir.
