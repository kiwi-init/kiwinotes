# A RAM do app: o que cada roteiro custa, e por quê

Spec #20953, parte 3 (T21015). Os números saem do `bun run mem:scenarios` (T21014, PR #149), num app sem tela, num tmp e
com dados inventados. Nenhum roteiro mede o app de ninguém. A conta é o `phys_footprint` de cada processo, o mesmo número
do Monitor de Atividade; os modelos de voz no Neural Engine ficam fora dela (#20960).

## A tabela

Em MB: **antes → pico → 30 s depois**. Em negrito, o que passa do limite do spec (mais de 50 MB que ficam, ou pico
acima de 300 MB).

| Roteiro | Principal | Helper | Passa do limite? |
|---|---|---|---|
| 1. Pasta grande (2.000 notas) | 44 → 129 → 97 (**+53**) | — | sim, o que fica |
| 2. 50 ditados | 44 → 58 → 55 (+11) | 71 → 75 → 52 | não |
| 3. Reunião de 5 min | 19 → 39 → 30 (+11) | 105 → **838** → 189 (**+84**) | sim, o pico e o que fica |
| 4. Agente (20 respostas longas) | 45 → 82 → 68 (+23) | — | não |
| 5. Janelas (40 vezes) | 44 → 56 → 51 (+7) | — | não |
| 6. 1, 2, 4 e 5 somados | 45 → 146 → 124 (**+79**) | 73 → 77 → 49 | sim, o que fica |

## As causas

### 1. Pasta grande: o índice de busca guarda o texto de novo, fora do heap do JS

Medido à parte com as mesmas 2.000 notas do roteiro 1 (3,45 milhões de caracteres), só o `Vault.open()`:

| | Pico | 15 s depois | Heap do JS |
|---|---|---|---|
| Como está | 114 | 65 | 20 |
| Sem o `NoteSearchIndex.sync` | 61 | 47 | 19 |

- **O índice FTS5 em memória** (`app/src/notes/search-index.ts:44`, chamado em `app/src/notes/vault.ts:2313`) custa
  **53 MB no pico e 18 MB que ficam**. Cada nota entra com o corpo dobrado e com as formas de cada palavra
  (`search-index.ts:64`), tudo numa transação só (`search-index.ts:53`). É memória do SQLite: o heap do JS não a vê.
  - **Proposta:** a tabela FTS5 sem conteúdo (`content=''`, `contentless_delete=1`, o SQLite do Bun é o 3.54), com o
    caminho num `Map` ao lado, e a sincronização em lotes de algumas centenas de notas. Medido à parte, a tabela sem
    conteúdo fica com 15 MB no lugar de 24 MB, e o pico cai 9 MB.
- **O índice do cofre guarda cada nota duas vezes** (`app/src/notes/vault.ts:1947` e `:1950`): o `content` e o
  `folded` da busca. O `folded` pesa 6,9 MB para 3,45 milhões de caracteres (ele sai em UTF-16), e o `content`, outros
  3,5 MB. Mais os `flatText` e `wordSet` da busca (`vault.ts:401` e `:412`), feitos na primeira busca por frase ou
  aproximada.
  - **Proposta:** dobrar na hora da busca, só nas notas que o FTS5 já escolheu, e tirar o `folded` da entrada.
- **Do pico ao que fica:** o processo fica 44 MB acima da base, com 20 MB de heap do JS e 18 MB do SQLite. A memória que
  o alocador segura depois do pico volta sozinha, mas devagar: de 81 para 65 MB uns 10 s depois da abertura.

### 3. Reunião: o VBx do fim roda dentro do helper que fica aberto

- **O pico de 838 MB** sai depois do fim do áudio, no VBx sobre o canal inteiro do sistema
  (`native/Sources/kiwi-helper/LiveMeetingTranscriber.swift:92`, que chama o `OfflineDiarizerManager` em `:110`–`:112`).
  A ADR 0009 já previa ~1 GB. Durante os 5 min, o helper fica entre 130 e 150 MB.
- **Os 189 MB que ficam** (+84) são do mesmo passo: os modelos e o que o VBx alocou não voltam ao sistema, porque o
  helper continua aberto.
- **O áudio do canal entra inteiro na memória** (`LiveMeetingTranscriber.swift:125`, chamado de
  `native/Sources/kiwi-helper/Helper.swift:1251`): 16 kHz em `Float`, ~3,8 MB por minuto. Numa reunião de 1 h, são
  ~230 MB só para o vetor, antes do VBx começar. O roteiro de 5 min não mostra isso.
- **Proposta:** rodar o VBx num processo curto (`kiwi-helper --vbx <pasta>`), que lê os pedaços do disco e devolve
  tudo ao sistema quando sai. O helper que fica aberto não passa mais de ~150 MB numa reunião.

### 6. Somados: é o cofre grande

- Os +79 MB que ficam são quase todos do roteiro 1: o cofre aberto continua aberto. Os ditados, o agente e as janelas
  somam pouco por cima (+27 MB juntos), e o helper volta a 49 MB.
- **Proposta:** a mesma do roteiro 1.

### Abaixo do limite, para registro

- **Agente (+23 MB):** as 20 respostas e as 20 leituras de ~150 KB. Fica abaixo do limite; não procurei a causa.

## O que os roteiros não explicam

**Nenhum roteiro chega perto do app instalado:** 418 MB no principal, com pico de 1,2 GB, depois de 12 h 30 aberto
(#20960). O maior aqui é 146 MB. Então o grosso não está em nenhum dos roteiros, nem nos quatro somados. O que eles
não têm:

- **As janelas de verdade.** O roteiro 5 abre um WebKit à parte. No app, a RAM das páginas fica nos processos
  `WebContent` do WebKit, que esta conta não pega.
- **Horas de uso.** Os roteiros duram de 1 a 5 min. O que cresce devagar (um histórico, um cache, a fragmentação
  do alocador do Bun, que deixou 11 blocos de 128 MB usados de 6% a 60% no app do harry) não aparece.
- **Os dados de verdade.** Um cofre com notas longas, anexos e muitas buscas pesa diferente das 2.000 notas inventadas
  de 250 palavras.

**Próximo passo:** uma leitura do app já aberto há horas, só `ps` e o `cli mem`, com os processos do WebKit (o lead
pediu ao harry em #21589). Com ela, dá para separar o que é das janelas e o que é do principal.

## Como reproduzir

- Os roteiros: `cd app && bun run mem:scenarios` (os 2, 3 e 6 pegam o `kiwi lock bench` sozinhos).
- A medida do índice: um `Vault` aberto sobre o cofre do `bigVault()` (`app/scripts/mem-scenarios.ts`), com o
  `processMemory` de `app/src/bun/memory.ts` a cada segundo por 15 s, com e sem o `NoteSearchIndex.prototype.sync`.
