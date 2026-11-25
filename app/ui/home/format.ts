// Como a tela de Início escreve as horas (spec #15728): "há 12 min", "10:40", "hoje, 14:00", "ontem, 9:05",
// "12 de nov., 14:00". Tudo no fuso local. Em inglês (spec #28171): "12 min ago", "10:40 AM", "today, 2:00 PM",
// "Nov 12, 2:00 PM".

import { formatTime } from "../../src/shared/i18n/index.ts";
import { appLocale, t } from "../src/i18n.ts";

const two = (n: number) => String(n).padStart(2, "0");
/** A hora: `14:00` em português (o costume do app desde o spec #15728), `2:00 PM` em inglês. */
const clock = (d: Date) => (appLocale().locale === "en" ? formatTime("en", d) : `${two(d.getHours())}:${two(d.getMinutes())}`);
const MONTHS = ["jan.", "fev.", "mar.", "abr.", "maio", "jun.", "jul.", "ago.", "set.", "out.", "nov.", "dez."];

function dayDiff(a: Date, b: Date): number {
  const da = new Date(a.getFullYear(), a.getMonth(), a.getDate()).getTime();
  const db = new Date(b.getFullYear(), b.getMonth(), b.getDate()).getTime();
  return Math.round((db - da) / 86_400_000);
}

/** Há quanto tempo: "agora", "há 12 min", "há 3 h", e depois de um dia, o dia e a hora. */
export function ago(at: number, now: number): string {
  const min = Math.floor((now - at) / 60_000);
  if (min < 1) return t("home.time.now");
  if (min < 60) return t("home.time.minAgo", { min: String(min) });
  const h = Math.floor(min / 60);
  if (h < 24 && dayDiff(new Date(at), new Date(now)) === 0) return t("home.time.hAgo", { h: String(h) });
  return when(at, now);
}

/** A hora de algo de hoje: "10:40". */
export function hour(at: number): string {
  return clock(new Date(at));
}

/** O dia e a hora: "hoje, 14:00", "ontem, 9:05" ou "12 de nov., 14:00". */
export function when(at: number, now: number): string {
  const d = new Date(at);
  const diff = dayDiff(d, new Date(now));
  if (diff === 0) return t("home.time.today", { time: clock(d) });
  if (diff === 1) return t("home.time.yesterday", { time: clock(d) });
  if (appLocale().locale === "en") return `${new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(d)}, ${clock(d)}`;
  return `${d.getDate()} de ${MONTHS[d.getMonth()]}, ${clock(d)}`;
}

/** A data do topo: "Segunda, 17 de novembro" / "Monday, November 17". */
export function today(now: number): string {
  if (appLocale().locale === "en") return new Date(now).toLocaleDateString("en-US", { weekday: "long", day: "numeric", month: "long" });
  const s = new Date(now).toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" });
  const t = s.replace(/-feira/, "").replace(/^(\S+?),?\s/, "$1, ");
  return t.charAt(0).toUpperCase() + t.slice(1);
}
