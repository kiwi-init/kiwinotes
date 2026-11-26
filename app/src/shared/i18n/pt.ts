// O catálogo em português (spec #28171): a fonte dos textos. Cada chave nova entra aqui e em `en.ts`, ou no catálogo da
// área (`<área>.pt.ts` e `<área>.en.ts`), que entra com uma linha só em `PT_PARTS`. Duas partes com a mesma chave
// quebram o `i18n.test.ts`: no espalhar, a última ganharia calada.
import { ptCatOverlay } from "./catoverlay.pt.ts";
import { ptAgent } from "./agent.pt.ts";
import { ptCommon } from "./common.pt.ts";
import { ptDiagnostics } from "./diagnostics.pt.ts";
import { ptActivity } from "./activity.pt.ts";
import { ptHistory } from "./history.pt.ts";
import { ptHub } from "./hub.pt.ts";
import { ptEditor } from "./editor.pt.ts";
import { ptMeetingsSettings } from "./meetings-settings.pt.ts";
import { ptMeetings } from "./meetings.pt.ts";
import { ptNotes } from "./notes.pt.ts";
import { ptSettings } from "./settings.pt.ts";
import { ptViewers } from "./viewers.pt.ts";

// A chave diz onde o texto aparece (`settings.…` em Ajustes); o plural vai como `{ one, other }`, com o parâmetro `n`.

const ptBase = {
  // As línguas, pelo nome delas mesmas (o seletor mostra "English" também com o app em português).
  "language.pt": "Português",
  "language.en": "English",

  // Ajustes: a casca e os assuntos (spec #11966).
  "settings.window.title": "Configurações",
  "settings.topics.aria": "Assuntos de Ajustes",
  "settings.back": "‹ Voltar",
  "settings.tab.general": "Geral",
  "settings.tab.shortcuts": "Atalhos",
  "settings.tab.transcription": "Transcrição",
  "settings.tab.dictionary": "Dicionário",
  "settings.tab.snippets": "Snippets",
  "settings.tab.folder": "Pasta e opções",
  "settings.tab.sidebar": "Barra lateral",
  "settings.tab.recording": "Gravação",
  "settings.tab.yours": "Suas reuniões",
  "settings.tabs.aria": "Abas do assunto",
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
  "settings.language.hint": "Automático segue a língua do macOS. O ditado, a voz do Kiwi e as respostas do agente não mudam aqui.",
  "settings.language.auto": "Automático",
  "settings.language.autoNow": "Pelo macOS, agora em {language}.",

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
  // As atualizações no Sobre (T29006): os erros e o motivo de estarem desligadas, que o main escreve.
  "update.swapFailed": "A {version} foi baixada, mas não deu para trocar o app. Tente de novo; se continuar, instale pelo .dmg do release.",
  "update.offline": "Sem internet: não deu para falar com o GitHub.",
  "update.serverDown": "O servidor das atualizações não respondeu. Tente de novo mais tarde.",
  "update.checkFailed": "Não deu para verificar agora. Tente de novo mais tarde.",
  "update.downloadFailed": "O download da {version} falhou. Tente de novo.",
  "update.refused": "A {version} foi recusada: a assinatura não confere.",
  "update.off.agents": "modo de teste dos agentes",
  "update.off.dev": "build de desenvolvimento",
  "update.off.channel": "build fora dos canais de release",
  "update.off.noUrl": "build local, sem o endereço das atualizações",
  "update.off.badUrl": "o endereço das atualizações deste build não é válido",
  // O porquê no pedido de permissão do macOS (T29006): vai ao InfoPlist.strings do .app e segue a língua do Mac.
  "system.micUsage": "O Kiwi Notes usa o microfone quando você dita ou pede para gravar uma reunião, e transcreve tudo no seu Mac.",
  "system.audioCaptureUsage": "O Kiwi Notes captura o áudio da reunião só quando você pede. A transcrição acontece no Mac e o áudio é apagado depois de transcrito.",
} as const;

/** As partes do catálogo, cada uma com as suas chaves. */
export const PT_PARTS = {
  base: ptBase,
  common: ptCommon,
  notes: ptNotes,
  editor: ptEditor,
  viewers: ptViewers,
  settings: ptSettings,
  meetingsSettings: ptMeetingsSettings,
  catOverlay: ptCatOverlay,
  agent: ptAgent,
  meetings: ptMeetings,
  history: ptHistory,
  hub: ptHub,
  activity: ptActivity,
  diagnostics: ptDiagnostics,
} as const;

export const pt = {
  ...ptBase,
  ...ptCommon,
  ...ptNotes,
  ...ptSettings,
  ...ptMeetingsSettings,
  ...ptCatOverlay,
  ...ptAgent,
  ...ptMeetings,
  ...ptHistory,
  ...ptHub,
  ...ptActivity,
  // O editor das Notas (T29842): `editor.pt.ts`.
  ...ptEditor,
  // Os visualizadores das Notas (T29245): `viewers.pt.ts`.
  ...ptViewers,
  // O arquivo do Salvar diagnóstico (T30631): `diagnostics.pt.ts`.
  ...ptDiagnostics,
} as const;
