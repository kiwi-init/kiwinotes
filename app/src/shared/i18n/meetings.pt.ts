// O catálogo das Reuniões, em português (T29247, spec #28171): a aba Reuniões do hub, o card ao vivo e os ajustes de
// reunião (que o Ajustes também mostra). Entra no `pt.ts` por inteiro (`...ptMeetings`). O nome da pasta das reuniões
// é o do disco (`MEETINGS_FOLDER`) e entra como `{folder}`, sem tradução.

export const ptMeetings = {
  // A aba e a lista.
  "meetings.title": "Reuniões",
  "meetings.trashed": "“{title}” foi para a Lixeira.",
  "meetings.undo": "Desfazer",
  "meetings.loadFailed": "Não deu para ler as reuniões",
  "meetings.retry": "Tentar de novo",
  "meetings.empty": "Nenhuma reunião ainda",
  "meetings.emptyHint":
    "Quando o Teams, o Zoom ou o Meet pegar o microfone, o Kiwi pergunta se quer gravar. Ou use o atalho de reunião ({shortcut}, nos ajustes abaixo) a qualquer momento. A transcrição vira uma nota em {folder}/, e o áudio é apagado.",
  "meetings.today": "Hoje",
  "meetings.yesterday": "Ontem",
  "meetings.deleteFailed": "Não deu para apagar “{title}”.",
  "meetings.restoreFailed": "Não deu para trazer “{title}” de volta. Ela está na Lixeira das Notas.",
  "meetings.renameExists": "Já existe uma nota “{name}” nessa pasta.",
  "meetings.renameFailed": "Não deu para renomear “{title}”.",

  // Uma linha da lista: o estado, a duração e quem participou.
  "meetings.row.recording": "gravando",
  "meetings.row.interrupted": "interrompida",
  "meetings.row.open": "Abrir {title} nas Notas",
  "meetings.row.rename": "Renomear {title}",
  "meetings.row.delete": "Apagar {title}",
  "meetings.row.newName": "Novo nome da reunião",
  "meetings.duration.short": "menos de 1 min",
  "meetings.duration.minutes": "{n} min",
  "meetings.duration.hours": "{h} h {m}",
  "meetings.people.and": "{list} e {last}",
  "meetings.people.more": "{list} e mais {n}",

  // O card ao vivo.
  "meetings.live.label": "Gravando agora",
  "meetings.live.title": "Gravando",
  "meetings.live.titleApp": "Gravando · {app}",
  "meetings.live.minePaused": "seu mic está pausado",
  "meetings.live.silent": "Não estamos ouvindo o áudio da reunião. Confira a Gravação de áudio do sistema em Ajustes do Sistema › Privacidade.",
  "meetings.live.noTranscription": "A transcrição não subiu. O áudio fica guardado e é transcrito depois.",
  "meetings.live.noteRecreated": "A nota desta reunião foi apagada ou mudada. A transcrição segue numa nota nova, em {folder}.",
  "meetings.live.pauseMine": "Pausar meu mic",
  "meetings.live.resumeMine": "Voltar meu mic",
  "meetings.live.pauseFailed": "Não deu para mudar o seu mic.",
  "meetings.live.stop": "Parar",
  "meetings.live.stopFailed": "Não deu para parar. Tente o atalho.",

  // Os ajustes de reunião.
  "meetings.settings.title": "Ajustes de reunião",
  "meetings.settings.loadFailed": "Não deu para ler os ajustes de reunião.",
  "meetings.settings.suggest": "Perguntar se quer gravar",
  "meetings.settings.suggestHint": "Quando um app de reunião pega o microfone, uma vez por reunião. Nunca grava sozinho.",
  "meetings.settings.apps": "Apps que contam como reunião",
  "meetings.settings.appsHint": "O Meet conta pelo navegador. O próprio Kiwi nunca conta.",
  "meetings.settings.removeApp": "Tirar {name}",
  "meetings.settings.noApps": "Nenhum: o Kiwi não pergunta sozinho.",
  "meetings.settings.name": "Nome (Discord)",
  "meetings.settings.nameLabel": "Nome do app",
  "meetings.settings.id": "Identificador (com.hnc.Discord)",
  "meetings.settings.idLabel": "Identificador do app",
  "meetings.settings.add": "Adicionar",
  "meetings.settings.restore": "Restaurar a lista padrão",
  "meetings.settings.needName": "Dê um nome ao app.",
  "meetings.settings.badId": "O identificador é como com.empresa.App (no Finder: Mostrar Conteúdo do Pacote › Info.plist).",
  "meetings.settings.already": "Esse app já está na lista.",
} as const;
