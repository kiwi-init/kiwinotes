// Kiwi in the Calendar, in English (spec #32129, T32156): the same keys as `calendar-kiwi.pt.ts`.

import type { Entry } from "./index.ts";
import type { ptCalendarKiwi } from "./calendar-kiwi.pt.ts";

export const enCalendarKiwi: { readonly [K in keyof typeof ptCalendarKiwi]: Entry } = {
  "calendarKiwi.kind.meeting": "meeting",
  "calendarKiwi.kind.reminder": "reminder",
  "calendarKiwi.kind.task": "task",
  "calendarKiwi.kind.note": "note",
  "calendarKiwi.kind.focus": "focus time",
  "calendarKiwi.when.now": "Now",
  "calendarKiwi.when.minutes": { one: "In {n} minute", other: "In {n} minutes" },
  "calendarKiwi.when.at": "At {time}",
  "calendarKiwi.when.tomorrow": "Tomorrow",
  "calendarKiwi.when.tomorrowAt": "Tomorrow at {time}",
  "calendarKiwi.alert.title": "{when}: {kind}",
  "calendarKiwi.alert.bodyProject": "{title} · {project}",
  "calendarKiwi.alert.speech": "{when}, {kind}: {title}.",
  "calendarKiwi.day.today": "today",
  "calendarKiwi.day.tomorrow": "tomorrow",
  "calendarKiwi.day.yesterday": "yesterday",
  "calendarKiwi.suggest.overdue": "“{title}” has been overdue since {day}. Want me to move it to tomorrow, {time}?",
  "calendarKiwi.suggest.deadline": "“{title}” is due {day}, {time}. Want me to remind you?",
  "calendarKiwi.suggest.deadlineDay": "“{title}” is due {day}. Want me to remind you?",
  "calendarKiwi.suggest.meetingTomorrow": "“{title}” is tomorrow at {time}. Want a reminder 30 minutes before?",
  "calendarKiwi.suggest.move": "Move to tomorrow",
  "calendarKiwi.suggest.remind": "Yes, remind me",
  "calendarKiwi.suggest.notify30": "Remind me 30 min before",
  "calendarKiwi.suggest.dismiss": "Not now",
  "calendarKiwi.panel.aria": "Kiwi in the calendar",
  "calendarKiwi.panel.today": "Today",
  "calendarKiwi.panel.todayEmpty": "Nothing scheduled for today.",
  "calendarKiwi.panel.undated": "Undated tasks",
  "calendarKiwi.panel.undatedEmpty": "No undated tasks.",
  "calendarKiwi.panel.dragHint": "Drag onto the calendar to schedule.",
  "calendarKiwi.panel.inProject": "{project}: {title}",
  "calendarKiwi.panel.notify": "Kiwi reminds you {when}",
};
