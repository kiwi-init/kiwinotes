// Os textos da seção Sobre (T2386, spec #16837), fora do componente: assim os testes não carregam o CSS nem o ícone.

import { formatNumber, formatTime, type TextKey } from "../../src/shared/i18n/index.ts";
import { type AppChannel, type UiAppearance, type UiWindow, UPDATES_OFF_BY_SETTING, type UpdatesView } from "../../src/shared/ui-contract.ts";
import { appLocale, t } from "../src/i18n.ts";

/** O canal do build, na língua do app (spec #28171). */
export const CHANNEL: Record<AppChannel, TextKey> = {
  stable: "about.channel.stable",
  dev: "about.channel.dev",
};

/** A hora de um ISO, no relógio do Mac e no costume da língua (`12:30` / `12:30 PM`). */
const time = (iso: string) => formatTime(appLocale().locale, new Date(iso));

/**
 * O progresso do download, se o updater mandar os bytes (parte 1 do spec #16837, T17097). Lido sem depender do tipo:
 * sem `done` e `total` válidos, a barra fica indeterminada, sem número inventado.
 */
export function downloadProgress(v: UpdatesView): { done: number; total: number } | null {
  const p = v as { done?: unknown; total?: unknown };
  if (typeof p.done !== "number" || typeof p.total !== "number") return null;
  if (!Number.isFinite(p.done) || !Number.isFinite(p.total) || p.total <= 0 || p.done < 0) return null;
  return { done: Math.min(p.done, p.total), total: p.total };
}

const MB = 1024 * 1024;
const mb = (bytes: number) => formatNumber(appLocale().locale, Math.round(bytes / MB));

/** O que a faixa da atualização mostra (spec #16837, mockup B): o tom, as duas linhas, a barra e o botão. */
export interface UpdateBand {
  /** A cor da faixa e da bolinha: neutra, andando, pronta (a cor do app) ou com erro. */
  tone: "quiet" | "busy" | "ready" | "error";
  title: string;
  detail: string;
  /** Só no baixando: `pct` null é a barra indeterminada. */
  bar: { pct: number | null } | null;
  /** No baixando e no pronta, a versão nova cujas notas o "O que muda" abre (spec #16837). */
  notesOf: string | null;
  /** O botão da direita, ou nenhum. */
  action: { kind: "check" | "apply"; label: string } | null;
}

/** A faixa em cada estado das atualizações: parado, procurando, baixando, pronta, aplicando, erro ou desligado. */
export function updateBand(v: UpdatesView): UpdateBand {
  const check = (label = t("about.update.check")) => ({ kind: "check" as const, label });
  const apply = { kind: "apply" as const, label: t("about.update.apply") };
  const off = t("about.update.off");
  switch (v.state) {
    case "off":
      // Desligado pela pessoa (T25110): diz o que deixa de acontecer, e o interruptor fica logo abaixo.
      if (v.reason === UPDATES_OFF_BY_SETTING)
        return { tone: "quiet", title: off, detail: t("about.update.offBySetting"), bar: null, notesOf: null, action: null };
      return { tone: "quiet", title: off, detail: t("about.update.offInBuild", { reason: v.reason }), bar: null, notesOf: null, action: null };
    case "checking":
      return { tone: "busy", title: t("about.update.checking"), detail: t("about.update.checkingDetail"), bar: null, notesOf: null, action: null };
    case "downloading": {
      const p = downloadProgress(v);
      const pct = p ? Math.floor((p.done / p.total) * 100) : null;
      const detail = p ? t("about.update.bytes", { done: mb(p.done), total: mb(p.total), pct: String(pct) }) : t("about.update.downloadingShort");
      return { tone: "busy", title: t("about.update.downloading", { version: v.version }), detail, bar: { pct }, notesOf: v.version, action: null };
    }
    case "ready":
      // Pronta, mas a troca já falhou uma vez (o "Atualizar e reiniciar" voltou): diz o porquê, e o botão segue lá.
      if (v.lastCheck?.result === "error")
        return { tone: "error", title: v.lastCheck.message, detail: t("about.update.stillDownloaded", { version: v.version }), bar: null, notesOf: v.version, action: apply };
      return { tone: "ready", title: t("about.update.ready", { version: v.version }), detail: t("about.update.readyDetail"), bar: null, notesOf: v.version, action: apply };
    case "applying":
      return { tone: "busy", title: t("about.update.applying"), detail: t("about.update.applyingDetail"), bar: null, notesOf: null, action: null };
    case "idle": {
      const last = v.lastCheck;
      if (!last) return { tone: "quiet", title: t("about.update.never"), detail: "", bar: null, notesOf: null, action: check() };
      const checked = t("about.update.checkedAt", { time: time(last.at) });
      if (last.result === "latest") return { tone: "quiet", title: t("about.update.latest"), detail: checked, bar: null, notesOf: null, action: check() };
      if (last.result === "error")
        return { tone: "error", title: t("about.update.failed"), detail: t("about.update.failedDetail", { message: last.message, time: time(last.at) }), bar: null, notesOf: null, action: check(t("about.update.retry")) };
      return { tone: "quiet", title: t("about.update.available", { version: last.version }), detail: checked, bar: null, notesOf: null, action: check() };
    }
  }
}


/**
 * O software de terceiros que vai dentro do app e pede crédito (spec #7079): cada visualizador de arquivo das Notas
 * que usa uma biblioteca entra aqui, com a licença dela.
 */
export const CREDITS: readonly { name: string; by: string; license: string; use: string; /** O pacote npm, de onde vem o texto da licença (ou o repo, para o que vai copiado no app). */ pkg: string }[] = [
  { name: "PDF.js", by: "Mozilla", license: "Apache-2.0", use: "abrir pdf nas Notas e ler pdf para o agente", pkg: "pdfjs-dist" },
  { name: "Mammoth", by: "Michael Williamson", license: "BSD-2-Clause", use: "ler docx para o agente", pkg: "mammoth" },
  // O docx nas Notas, em páginas como no Word (T21151, spec #21080). O npm não diz o autor: é o repo eigenpal/docx-editor.
  { name: "docx-editor", by: "eigenpal", license: "Apache-2.0", use: "abrir docx nas Notas, em páginas como no Word", pkg: "@docx-editor.dev/core" }, // i18n-ok: o uso no arquivo de licenças; a tela usa o about.credit.docxEditor
  { name: "SheetJS Community Edition", by: "SheetJS LLC", license: "Apache-2.0", use: "abrir xlsx nas Notas, e ler e gerar xlsx com o agente", pkg: "xlsx" },
  // Não vem do npm: o viewer oficial vai no repo, com a licença (`scripts/drawio-viewer.ts`, T7112).
  { name: "draw.io", by: "JGraph Ltd", license: "Apache-2.0", use: "abrir diagramas .drawio nas Notas", pkg: "jgraph/drawio" },
  // Os arquivos que o agente gera (spec #11549): o pdf e o docx são montados no Mac por estas duas.
  { name: "pdf-lib", by: "Andrew Dillon", license: "MIT", use: "gerar pdf com o agente", pkg: "pdf-lib" },
  { name: "docx", by: "Dolan Miu", license: "MIT", use: "gerar docx com o agente", pkg: "docx" },
  // O host do agente (spec #4576): a biblioteca oficial do ACP, para o Kiwi conversar com o agente escolhido.
  { name: "Agent Client Protocol SDK", by: "Zed Industries", license: "Apache-2.0", use: "conversar com o agente", pkg: "@agentclientprotocol/sdk" },
];

/**
 * O "Para …" de cada biblioteca nas Licenças, na língua do app (spec #28171). O `use` de cada uma fica em português:
 * é o texto do arquivo de avisos, que o `bun scripts/third-party-notices.ts` gera.
 */
const CREDIT_USE: Record<string, TextKey> = {
  "pdfjs-dist": "about.credit.pdfjs",
  mammoth: "about.credit.mammoth",
  "@docx-editor.dev/core": "about.credit.docxEditor",
  xlsx: "about.credit.xlsx",
  "jgraph/drawio": "about.credit.drawio",
  "pdf-lib": "about.credit.pdfLib",
  docx: "about.credit.docx",
  "@agentclientprotocol/sdk": "about.credit.acp",
};
export const creditUse = (c: { pkg: string; use: string }): string => (CREDIT_USE[c.pkg] ? t(CREDIT_USE[c.pkg]!) : c.use);

/** O arquivo com o texto de cada licença, que vai no pack das Notas (`ui/notes/public/`, copiado para `dist/notes/`). */
export const NOTICES_FILE = "THIRD_PARTY_NOTICES.txt";

/** O texto do arquivo de avisos: cada biblioteca, com a versão e a licença inteira, como o pacote dela traz. */
export function noticesText(items: readonly { name: string; by: string; license: string; use: string; pkg: string; version: string; text: string }[]): string {
  const head = "Kiwi Notes: software de terceiros que vai dentro do app, com as licenças.\nGerado por `bun scripts/third-party-notices.ts`; não edite à mão.\n"; // i18n-ok: o arquivo de licenças gerado, não aparece na tela
  return [head, ...items.map((i) => `${"=".repeat(78)}\n${i.name} ${i.version} (${i.pkg}), de ${i.by}: ${i.use}\nLicença: ${i.license}\n\n${i.text.trim()}\n`)].join("\n"); // i18n-ok: o arquivo de licenças gerado, não aparece na tela
}

/** O nome de cada janela na lista "Aparência" do Sobre (spec #25011). */
export const WINDOW_NAME: Record<UiWindow, TextKey> = {
  hub: "about.window.hub",
  notes: "about.window.notes",
  settings: "about.window.settings",
  history: "about.window.history",
  intro: "about.window.intro",
};

/** Uma linha da lista "Aparência": a janela e a UI dela, a de fábrica ou uma que chegou depois. */
export function appearanceLine(w: UiAppearance["windows"][number]): { name: string; version: string } {
  const version = w.builtIn ? t("about.ui.builtIn", { version: w.uiVersion }) : w.uiVersion;
  return { name: t(WINDOW_NAME[w.window]), version: w.pending ? t("about.ui.pending", { version, pending: w.pending }) : version };
}
