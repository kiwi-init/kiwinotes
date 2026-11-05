# A nota da reunião (R4 / T4945 / issue #197)

Spec Kiwi #4823, detalhe R4 em #4901. A captura/ASR não fazem parte deste item: os testes usam eventos falsos. O bridge `MeetingNoteSession` apenas escuta eventos; nunca manda um comando de captura.

A nota nasce em `Reuniões/AAAA-MM-DD HHhMM Reunião do <app>.md`. O horário do nome é local; um título repetido usa o sufixo do vault. O frontmatter usa:

```yaml
type: meeting
session: <uuid>
date: "2026-11-05"                 # dia local
start: "2026-11-05T17:32:00.000Z"   # ISO completo
end: "2026-11-05T17:52:00.000Z"     # ausente enquanto grava
duration: 1200                     # segundos, pode ter fração
app: "Teams"
participants: [Você, Ana]
meeting_speakers: {"Você": "Você", "Pessoa 1": "Ana"}
```

O mapa `meeting_speakers` mantém o nome original do ASR associado ao nome escolhido pela pessoa. O R6 pode ignorá-lo. A busca por `session`, seguida da validação do frontmatter, encontra a nota mesmo depois de renomeada ou movida.

## Escrita e edição ao mesmo tempo

`meeting.started` cria a nota com `## Minhas notas` e `## Transcrição`. O bridge recebe `meeting.segment {session?,channel?,start,end,speaker,text,final}`; os tempos são segundos relativos ao começo da reunião. Segmentos provisórios não vão ao disco. Os finais são juntados por ~5 s, ordenados no lote e anexados no fim da seção Transcrição, antes de uma eventual seção seguinte. `meeting.stopped` drena o lote e escreve fim/duração. R3 deve mandar `session` explícita nos finais que chegam depois do stop e na recuperação, e manter a ordem temporal entre lotes.

Cada append relê o disco e chama o `Vault.save` condicional do ADR 0007. Se houver uma edição entre ler e substituir o arquivo temporário, o writer relê e reaplica só o acréscimo, até cinco tentativas. Se não conseguir, mantém os segmentos pendentes e reporta falha sem registrar texto em logs. Comentários `%%meeting-segment:<hash>%%` no Markdown tornam o replay idempotente, mesmo depois de reiniciar o writer. Não há gravação fora do vault nem reescrita das notas pessoais.

O editor manda `baseContent` opcional no `notes.save`, junto da versão. Só uma mudança no disco que consista em acréscimo da transcrição e metadados da reunião pode ser mesclada automaticamente. A base é conferida pelo hash; outras mudanças continuam no fluxo normal de conflito. A atualização no CodeMirror preserva cursor/seleção e não vira uma ação de desfazer. O rascunho da pessoa acompanha a base nova. Campos de frontmatter desconhecidos e seu corpo são preservados.

## Integração com R3

`MeetingNotes.onCommitted((session, segments) => ...)` é chamado depois que o lote foi salvo. O R3 deve liberar áudio com `meeting.ack` **só depois desta confirmação**, por canal, e conservar o contexto combinado no R1. Parar a captura não confirma texto. Segmentos finais tardios da mesma sessão continuam sendo aceitos após o stop. O callback não existe para segmentos provisórios nem para um lote cuja escrita falhou.

## Renomear falante

O menu da nota aberta de reunião oferece “Renomear falante…”. As capacidades `meetings.speakers` e `meetings.renameSpeaker {path,from,to}` leem a lista e atualizam rótulos da transcrição, participantes e aliases para as falas futuras. O texto pessoal que mencione o nome não é alterado. Nomes duplicados ou inválidos são recusados. O contrato AppEngine passa a 1.22.0; engines antigos não recebem os argumentos novos e não exibem a ação.

## Verificação sem sessão real

- `bun test src/notes/meetings.test.ts`: nome/data, eventos falsos, parciais/finais, lote, replay, edição durante a escrita, recuperação do writer, rename, falha de escrita e rebase do editor.
- `bun scripts/meeting-note-ui-check.ts`: inicia a CLI headless com helper desligado e dados temporários, abre a UI real em WebKit headless, digita durante uma fala falsa, verifica a preservação do texto e do cursor, resolve um conflito real pelo botão “Manter a minha”, renomeia um falante pelo menu e gera os prints claro/escuro. O relatório exige zero erro, clipboard ou rede externa.
- Evidência em `docs/evidence/T4945/`. Só texto sintético; nenhum mic, som, helper de sessão, diálogo do macOS ou janela real.
