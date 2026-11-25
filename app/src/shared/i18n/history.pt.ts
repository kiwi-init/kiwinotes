// O catálogo do Histórico, em português (T29247, spec #28171): a lista dos ditados, a busca e o "Enviar para nota…".
// Entra no `pt.ts` por inteiro (`...ptHistory`). A pasta da nota nova é a do disco (`INBOX`) e entra como `{folder}`.

export const ptHistory = {
  "history.title": "Histórico",
  "history.search": "Buscar nos ditados",
  "history.loadFailed": "Não deu para abrir o histórico",
  "history.retry": "Tentar de novo",
  "history.notFound": "Nada encontrado",
  "history.notFoundHint": "Nenhum ditado tem “{query}”. A busca ignora acentos e maiúsculas.",
  "history.empty": "Nenhum ditado ainda",
  "history.emptyHint": "Segure {key} em qualquer app e fale. Cada ditado aparece aqui, com o texto limpo e o original.",
  "history.today": "Hoje",
  "history.yesterday": "Ontem",
  "history.more": "Mostrar mais",
  "history.moreFailed": "Não deu para carregar. Tentar de novo",

  // Um ditado.
  "history.sendToNote": "Enviar para nota…",
  "history.copy": "Copiar o texto",
  "history.delete": "Apagar do histórico",
  "history.unfinished": "O ditado não foi concluído",
  "history.retrying": "Transcrevendo…",
  "history.retryAudio": "Transcrever de novo",
  "history.retryFailed": "Não foi possível transcrever. Tente novamente.",
  "history.audioUntil": "Áudio guardado neste Mac até {date}.",
  "history.audioKept": "Áudio guardado neste Mac.",

  // O "Enviar para nota…" e o que a tela diz depois.
  "history.toNote.dialog": "Enviar para nota",
  "history.toNote.search": "Buscar nota",
  "history.toNote.new": "＋ Nota nova",
  "history.toNote.in": "em {folder}",
  "history.toNote.notesFailed": "Não deu para abrir as notas",
  "history.toNote.sendFailed": "Não deu para enviar. Tente de novo",
  "history.sent.already": "Já estava em “{title}”",
  "history.sent.created": "Virou a nota “{title}”, em {folder}",
  "history.sent.appended": "Foi para o fim de “{title}”",
  "history.sent.root": "Notas",
} as const;
