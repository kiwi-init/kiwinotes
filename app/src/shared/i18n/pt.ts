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
} as const;
