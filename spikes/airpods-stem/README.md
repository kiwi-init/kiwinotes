# airpods-stem: o Mac recebe o "segurar" da haste? (T3245)

Spike para o ditado pelo AirPods (spec #3222; o jow escolheu no #3335 **segurar começa, segurar de novo para**). Não vai para o app.

**O que se sabe:** o AirPods só manda eventos prontos de haste pelo AAP, o protocolo privado documentado pelo [LibrePods](https://github.com/kavishdevar/librepods): toque, duplo, triplo e segurar (opcode `0x19`). Não existe evento de soltar. O "segurar" só vem se o control command `0x39` (Raw Gestures) tiver o bit `0x08`.

**O que falta saber:** se o macOS deixa outro processo abrir o canal AAP (L2CAP, PSM `0x1001`), que o próprio sistema já usa. Ninguém mostrou isso funcionando num Mac, e é o que o protótipo testa.

## O que o protótipo faz (e não faz)

- Abre o canal AAP, manda o handshake e pede as notificações. Lê o `0x39` de agora e liga o bit do segurar, sem desligar os outros.
- A cada evento da haste, escreve o tipo e o lado. No segurar, escreve "começaria a ditar" ou "pararia".
- **Não grava e não liga o microfone.** Não muda o modo de ruído, os toques nem nada além do `0x39`.
- No fim (Ctrl-C, 2 minutos ou o fone desconectando), devolve o `0x39` ao valor de antes e fecha o canal.
- Os pacotes que não interessam viram só "opcode e tamanho". Com `--raw`, sai cada um em hex, mas eles podem ter o número de série do fone: não cole esses no canal.

## Rodar (o jow, com o AirPods dele)

```sh
cd spikes/airpods-stem
swift build
.build/debug/kiwi-airpods-probe            # --device "parte do nome" se houver outro fone; --seconds 60
```

1. AirPods conectados ao Mac e nos ouvidos.
2. Na primeira vez, o macOS pede o Bluetooth para o app de terminal (Terminal, Rex…): **Permitir**. Se a permissão já foi negada, ligue o app em Ajustes do Sistema › Privacidade e Segurança › Bluetooth e rode de novo.
3. Com o "PRONTO" na tela, segure a haste (cerca de 1 s) e solte. Depois segure de novo. Faça também um toque e um toque duplo.
4. Repare se o segurar ainda troca o modo de ruído (ou chama a Siri), além de aparecer no terminal.
5. Ctrl-C. O bloco **RESULTADO** é o que vai para o canal.

Se o fone ficar estranho depois, guarde no estojo e tire de novo: ele volta ao que o Mac configura.

## Testes

`swift test` cobre os bytes (`AAP.parse`, `AAP.control`) e o segurar começa / segurar de novo para (`StemToggle`, que ignora um segundo segurar em menos de 0,8 s). O Bluetooth de verdade só o jow testa: o agente não pede permissão nem mexe no fone de ninguém (AGENTS.md).
