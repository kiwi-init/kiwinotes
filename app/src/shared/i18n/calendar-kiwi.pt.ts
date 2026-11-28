// O catálogo do Kiwi no Calendário, em português (spec #32129, T32156): os avisos (a notificação e a fala), a sugestão
// do painel ("quer que eu te lembre?") e o painel. Entra no `pt.ts` por inteiro (`...ptCalendarKiwi`).

export const ptCalendarKiwi = {
  // O tipo do item, em minúscula, como entra no meio da frase do aviso.
  "calendarKiwi.kind.meeting": "reunião",
  "calendarKiwi.kind.reminder": "lembrete",
  "calendarKiwi.kind.task": "pendência",
  "calendarKiwi.kind.note": "nota",
  "calendarKiwi.kind.focus": "foco",
  // Quando é, do ponto de vista do aviso: o começo da frase.
  "calendarKiwi.when.now": "Agora",
  "calendarKiwi.when.minutes": { one: "Em {n} minuto", other: "Em {n} minutos" },
  "calendarKiwi.when.at": "Às {time}",
  "calendarKiwi.when.tomorrow": "Amanhã",
  "calendarKiwi.when.tomorrowAt": "Amanhã às {time}",
  // A notificação: o título diz quando e o quê; o corpo, o item e o projeto.
  "calendarKiwi.alert.title": "{when}: {kind}",
  "calendarKiwi.alert.bodyProject": "{title} · {project}",
  // A fala: uma frase por aviso.
  "calendarKiwi.alert.speech": "{when}, {kind}: {title}.",
  // O dia como se fala na sugestão.
  "calendarKiwi.day.today": "hoje",
  "calendarKiwi.day.tomorrow": "amanhã",
  "calendarKiwi.day.yesterday": "ontem",
  // A sugestão do painel ("quer que eu te lembre?"), uma por regra, e os botões.
  "calendarKiwi.suggest.overdue": "“{title}” ficou para trás desde {day}. Quer que eu passe para amanhã, {time}?",
  "calendarKiwi.suggest.overdueToday": "“{title}” era hoje, {at}, e ficou para trás. Quer que eu passe para amanhã, {time}?",
  "calendarKiwi.suggest.deadline": "“{title}” é {day}, {time}. Quer que eu te lembre?",
  "calendarKiwi.suggest.deadlineDay": "“{title}” é {day}. Quer que eu te lembre?",
  "calendarKiwi.suggest.meetingTomorrow": "Amanhã às {time} tem “{title}”. Quer um aviso 30 minutos antes?",
  "calendarKiwi.suggest.move": "Passar para amanhã",
  "calendarKiwi.suggest.remind": "Sim, me lembra",
  "calendarKiwi.suggest.notify30": "Avisar 30 min antes",
  "calendarKiwi.suggest.dismiss": "Agora não",
  // O painel do Kiwi à direita do Calendário.
  "calendarKiwi.panel.aria": "O Kiwi no calendário",
  "calendarKiwi.panel.today": "Hoje",
  "calendarKiwi.panel.todayEmpty": "Nada marcado para hoje.",
  "calendarKiwi.panel.undated": "Pendências sem data",
  "calendarKiwi.panel.undatedEmpty": "Nenhuma pendência sem data.",
  "calendarKiwi.panel.dragHint": "Arraste para o calendário para marcar.",
  "calendarKiwi.panel.inProject": "{project}: {title}",
  "calendarKiwi.panel.notify": "o Kiwi avisa {when}",
  // A busca do Kiwi (⌘K) na barra do Calendário.
  "calendarKiwi.ask.placeholder": "Peça ao Kiwi: “me lembra da entrega amanhã às 9h”",
  "calendarKiwi.ask.label": "Pedido ao Kiwi",
  "calendarKiwi.ask.thinking": "Pensando…",
  "calendarKiwi.ask.failed": "Não deu para pedir agora. Tente de novo daqui a pouco.",
  "calendarKiwi.ask.stop": "Parar",
  "calendarKiwi.ask.close": "Fechar a resposta",
} as const;
