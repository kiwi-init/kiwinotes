// O catálogo em português (spec #28171): a fonte dos textos. Cada chave nova entra aqui e em `en.ts`.
// A chave diz onde o texto aparece (`settings.…` em Ajustes); o plural vai como `{ one, other }`, com o parâmetro `n`.

export const pt = {
  // As línguas, pelo nome delas mesmas (o seletor mostra "English" também com o app em português).
  "language.pt": "Português",
  "language.en": "English",

  // Comuns.
  "common.notes": { one: "{n} nota", other: "{n} notas" },
  "common.saveFailed": "Não deu para salvar. Tente de novo.",

  // Ajustes: a casca e os assuntos (spec #11966).
  "settings.window.title": "Configurações",
  "settings.topics.aria": "Assuntos de Ajustes",
  "settings.back": "‹ Voltar",
  "settings.topic.general": "Geral",
  "settings.topic.appearance": "Aparência",
  "settings.topic.dictation": "Ditado",
  "settings.topic.notes": "Notas",
  "settings.topic.meetings": "Reuniões",
  "settings.topic.agent": "Agente",
  "settings.topic.activity": "Atividade do agente",
  "settings.topic.privacy": "Privacidade",
  "settings.topic.about": "Sobre",

  // Ajustes › Geral: o idioma do app (T28190).
  "settings.language.section": "Idioma",
  "settings.language.label": "Idioma do app",
  "settings.language.hint": "Automático segue a língua do macOS. O ditado, a voz do gato e as respostas do agente não mudam aqui.",
  "settings.language.auto": "Automático",
  "settings.language.autoNow": "Pelo macOS, agora em {language}.",
  "settings.language.autoPending": "Por enquanto, o Automático fica em português: o resto do app ainda está sendo traduzido.",

  // O menu do app, a bandeja e o status do ditado (T28192).
  "menu.quit": "Sair do Kiwi Notes",
  "menu.edit": "Editar",
  "menu.window": "Janela",
  "tray.open": "Abrir o Kiwi Notes",
  "tray.allowAccess": "Permitir acesso… ({permission})",
  "tray.notes": "Notas…",
  "tray.notesFolder": "Abrir pasta de notas…",
  "tray.dictation": "Ditado…",
  "tray.settings": "Configurações…",
  "tray.about": "Sobre o Kiwi Notes…",
  "tray.updating": "Atualizando…",
  "tray.updateRestart": "Atualizar e reiniciar",
  "tray.updateRestartVersion": "Atualizar e reiniciar (v{version})",
  "status.failed": "O ditado está com problema",
  "status.starting": "Iniciando…",
  "status.hotkeyOff": "Atalho desligado: falta {permission}",
  "status.aPermission": "permissão",
  "status.modelLoading": "Preparando o modelo de voz…",
  "status.modelUnavailable": "Modelo de voz indisponível",
  "status.vocabularyLoading": "Pronto para ditar · baixando o vocabulário…",
  "status.noPriority": "Pronto para ditar · atalhos sem prioridade: falta {permission}",
  "status.ready": "Pronto para ditar",
  "status.helperOff": "Helper desligado",

  // As permissões do macOS, pelo nome que o Ajustes do Sistema usa.
  "permission.systemAudio": "Áudio do sistema",
  "permission.microphone": "Microfone",
  "permission.accessibility": "Acessibilidade",
  "permission.inputMonitoring": "Monitoramento de Entrada",

  // O diálogo do link e a notificação do agente.
  "dialog.link.title": "Abrir o link?",
  "dialog.link.message": "Abrir este link no navegador?",
  "dialog.link.open": "Abrir",
  "dialog.link.cancel": "Cancelar",
  "notice.agent.title": "O agente espera uma resposta sua",
  "notice.agent.bodyNote": "Dúvida em {note}. Clique para responder.",
  "notice.agent.bodyRequest": "Dúvida no texto do seu pedido. Clique para responder.",

  // A pílula do ditado: uma linha de 38 letras (`OverlayModel.maxMessageLength`).
  "pill.notPasted.noFocus": "Nenhum campo em foco: está no clipboard",
  "pill.notPasted.noTextField": "Não é um campo de texto: está no clipboard",
  "pill.notPasted.noAccessibility": "Falta a Acessibilidade: está no clipboard",
  "pill.nothingToPaste": "Ainda não há ditado para colar",
  "pill.secureInput": "O texto também ficou no clipboard",
  "pill.micLost": "O microfone caiu: transcrevi até aqui",
  "pill.micFellBack": "Mic escolhido ausente: usei o {mic}",
  "pill.mic.builtin": "do Mac",
  "pill.mic.default": "padrão",
  "pill.micLostEmpty": "Sem áudio do microfone",
  "pill.noteCreated": "Virou nota: {title}",
  "pill.noteFailed": "Não deu para criar a nota: o texto está no Histórico",
  "pill.pasteFailed": "Não deu para colar o texto",
  "pill.modelUnavailable": "O modelo de voz não está pronto",
  "pill.sttFailed": "Não deu para transcrever",
} as const;
