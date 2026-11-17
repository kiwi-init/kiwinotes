// As datas das telas da aba Início (T15875), em português e no dia local de quem usa.

const WEEKDAY = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
const MONTH = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

/** `YYYY-MM-DD` (o dia local) → a data ao meio-dia, para o fuso e o horário de verão não trocarem o dia. */
const fromDate = (date: string) => {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(y!, m! - 1, d!, 12);
};

/** O rótulo do dia na linha do tempo: "Hoje", "Ontem", "sex 13". `i` é quantos dias antes de hoje. */
export function dayLabel(date: string, i: number): string {
  if (i === 0) return "Hoje";
  if (i === 1) return "Ontem";
  const d = fromDate(date);
  return `${WEEKDAY[d.getDay()]} ${d.getDate()}`;
}

/** "De 11 a 17 de novembro", "De 28 de outubro a 3 de novembro", com o ano só quando a semana cruza o ano. */
export function weekRange(first: string, last: string): string {
  const a = fromDate(first);
  const b = fromDate(last);
  if (a.getFullYear() !== b.getFullYear())
    return `De ${a.getDate()} de ${MONTH[a.getMonth()]} de ${a.getFullYear()} a ${b.getDate()} de ${MONTH[b.getMonth()]} de ${b.getFullYear()}`;
  if (a.getMonth() !== b.getMonth()) return `De ${a.getDate()} de ${MONTH[a.getMonth()]} a ${b.getDate()} de ${MONTH[b.getMonth()]}`;
  return `De ${a.getDate()} a ${b.getDate()} de ${MONTH[b.getMonth()]}`;
}

/** "42 min", "3 h 12", "2 h". */
export function hours(min: number): string {
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h} h ${String(m).padStart(2, "0")}` : `${h} h`;
}

/** "2 140": o milhar com espaço fino, como no resto do app. */
export const thousands = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
