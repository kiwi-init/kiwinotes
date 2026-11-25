// Os textos do resumo executivo em Ajustes › Agente (spec #11546), na parte das reuniões: os 6 blocos e o período do
// primeiro resumo. Só texto, para testar sem a tela. Cada função leva a língua no fim (T29273): sem ela, o português.

import { type Locale, translate } from "../../src/shared/i18n/index.ts";
import type { SummaryBlock, SummarySettings } from "../../src/shared/summary-settings.ts";
import { listOf } from "./meetingsText.ts";

export const SUMMARY_SETTINGS_TITLE = translate("pt", "settings.meetings.summary.title");
export const SUMMARY_SETTINGS_HINT = translate("pt", "settings.meetings.summary.hint");

const BLOCK_ORDER: SummaryBlock[] = ["situacao", "andou", "decisoes", "riscos", "proximos", "reunioes"];
export const summaryBlockLabels = (locale: Locale = "pt"): { key: SummaryBlock; label: string }[] =>
  BLOCK_ORDER.map((key) => ({ key, label: translate(locale, `settings.meetings.summary.block.${key}`) }));
export const SUMMARY_BLOCK_LABELS = summaryBlockLabels();

export const firstDaysOptions = (locale: Locale = "pt"): { value: "7" | "14" | "30"; label: string }[] =>
  (["7", "14", "30"] as const).map((value) => ({ value, label: translate(locale, "settings.meetings.summary.days", { n: Number(value) }) }));
export const FIRST_DAYS_OPTIONS = firstDaysOptions();

export function firstDaysHint(days: SummarySettings["firstDays"], locale: Locale = "pt"): string {
  return translate(locale, "settings.meetings.summary.first.hint", { n: days });
}

export function summaryBlocksHint(blocks: SummarySettings["blocks"], locale: Locale = "pt"): string {
  const all = summaryBlockLabels(locale);
  const on = all.filter((b) => blocks[b.key]).map((b) => b.label);
  if (!on.length) return translate(locale, "settings.meetings.summary.blocks.none");
  if (on.length === all.length) return translate(locale, "settings.meetings.summary.blocks.all");
  return translate(locale, "settings.meetings.summary.blocks.some", { list: listOf(on, locale) });
}
