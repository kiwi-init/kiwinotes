// Os textos da seção Sobre (T2386, spec #16837), fora do componente: assim os testes não carregam o CSS nem o ícone.

import type { AppChannel, UiAppearance, UiWindow, UpdatesView } from "../../src/shared/ui-contract.ts";

export const CHANNEL: Record<AppChannel, string> = {
  stable: "estável",
  dev: "desenvolvimento",
};

const time = (iso: string) => new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

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
const mb = (bytes: number) => Math.round(bytes / MB).toLocaleString("pt-BR");

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
  const check = (label = "Verificar atualizações") => ({ kind: "check" as const, label });
  switch (v.state) {
    case "off":
      return { tone: "quiet", title: "Atualizações desligadas", detail: `Neste build (${v.reason}).`, bar: null, notesOf: null, action: null };
    case "checking":
      return { tone: "busy", title: "Procurando atualizações…", detail: "Conferindo no GitHub.", bar: null, notesOf: null, action: null };
    case "downloading": {
      const p = downloadProgress(v);
      const pct = p ? Math.floor((p.done / p.total) * 100) : null;
      const detail = p ? `${mb(p.done)} de ${mb(p.total)} MB · ${pct}%` : "Baixando…";
      return { tone: "busy", title: `Baixando a versão ${v.version}`, detail, bar: { pct }, notesOf: v.version, action: null };
    }
    case "ready":
      // Pronta, mas a troca já falhou uma vez (o "Atualizar e reiniciar" voltou): diz o porquê, e o botão segue lá.
      if (v.lastCheck?.result === "error")
        return { tone: "error", title: v.lastCheck.message, detail: `A versão ${v.version} segue baixada.`, bar: null, notesOf: v.version, action: { kind: "apply", label: "Atualizar e reiniciar" } };
      return { tone: "ready", title: `A versão ${v.version} está pronta`, detail: "Baixada e conferida. Reinicia em segundos.", bar: null, notesOf: v.version, action: { kind: "apply", label: "Atualizar e reiniciar" } };
    case "applying":
      return { tone: "busy", title: "Reiniciando…", detail: "O Kiwi Notes vai fechar e abrir de novo.", bar: null, notesOf: null, action: null };
    case "idle": {
      const last = v.lastCheck;
      if (!last) return { tone: "quiet", title: "Ainda não verificado", detail: "", bar: null, notesOf: null, action: check() };
      if (last.result === "latest")
        return { tone: "quiet", title: "Você está na última versão", detail: `Verificado às ${time(last.at)}.`, bar: null, notesOf: null, action: check() };
      if (last.result === "error") return { tone: "error", title: "Não deu para verificar", detail: `${last.message} (às ${time(last.at)})`, bar: null, notesOf: null, action: check("Tentar de novo") };
      return { tone: "quiet", title: `A versão ${last.version} está disponível`, detail: `Verificado às ${time(last.at)}.`, bar: null, notesOf: null, action: check() };
    }
  }
}

/** A dica do "Salvar diagnóstico", no lugar da frase longa de antes. */
export const DIAG_HINT = "Versões, permissões e o log do app, sem texto nem áudio, para mandar quando algo der errado.";

/**
 * O software de terceiros que vai dentro do app e pede crédito (spec #7079): cada visualizador de arquivo das Notas
 * que usa uma biblioteca entra aqui, com a licença dela.
 */
export const CREDITS: readonly { name: string; by: string; license: string; use: string; /** O pacote npm, de onde vem o texto da licença (ou o repo, para o que vai copiado no app). */ pkg: string }[] = [
  { name: "PDF.js", by: "Mozilla", license: "Apache-2.0", use: "abrir pdf nas Notas e ler pdf para o agente", pkg: "pdfjs-dist" },
  { name: "Mammoth", by: "Michael Williamson", license: "BSD-2-Clause", use: "ler docx para o agente", pkg: "mammoth" },
  // O docx nas Notas, em páginas como no Word (T21151, spec #21080). O npm não diz o autor: é o repo eigenpal/docx-editor.
  { name: "docx-editor", by: "eigenpal", license: "Apache-2.0", use: "abrir docx nas Notas, em páginas como no Word", pkg: "@docx-editor.dev/core" },
  { name: "SheetJS Community Edition", by: "SheetJS LLC", license: "Apache-2.0", use: "abrir xlsx nas Notas, e ler e gerar xlsx com o agente", pkg: "xlsx" },
  // Não vem do npm: o viewer oficial vai no repo, com a licença (`scripts/drawio-viewer.ts`, T7112).
  { name: "draw.io", by: "JGraph Ltd", license: "Apache-2.0", use: "abrir diagramas .drawio nas Notas", pkg: "jgraph/drawio" },
  // Os arquivos que o agente gera (spec #11549): o pdf e o docx são montados no Mac por estas duas.
  { name: "pdf-lib", by: "Andrew Dillon", license: "MIT", use: "gerar pdf com o agente", pkg: "pdf-lib" },
  { name: "docx", by: "Dolan Miu", license: "MIT", use: "gerar docx com o agente", pkg: "docx" },
  // O host do agente (spec #4576): a biblioteca oficial do ACP, para o Kiwi conversar com o agente escolhido.
  { name: "Agent Client Protocol SDK", by: "Zed Industries", license: "Apache-2.0", use: "conversar com o agente", pkg: "@agentclientprotocol/sdk" },
];

/** O arquivo com o texto de cada licença, que vai no pack das Notas (`ui/notes/public/`, copiado para `dist/notes/`). */
export const NOTICES_FILE = "THIRD_PARTY_NOTICES.txt";

/** O texto do arquivo de avisos: cada biblioteca, com a versão e a licença inteira, como o pacote dela traz. */
export function noticesText(items: readonly { name: string; by: string; license: string; use: string; pkg: string; version: string; text: string }[]): string {
  const head = "Kiwi Notes: software de terceiros que vai dentro do app, com as licenças.\nGerado por `bun scripts/third-party-notices.ts`; não edite à mão.\n";
  return [head, ...items.map((i) => `${"=".repeat(78)}\n${i.name} ${i.version} (${i.pkg}), de ${i.by}: ${i.use}\nLicença: ${i.license}\n\n${i.text.trim()}\n`)].join("\n");
}

/** A linha de créditos do Sobre: "Com PDF.js, da Mozilla (Apache-2.0); Mammoth, …". */
export function creditsLine(credits = CREDITS): string {
  if (!credits.length) return "";
  return `Com ${credits.map((c) => `${c.name}, ${c.by.startsWith("Mozilla") ? "da" : "de"} ${c.by} (${c.license})`).join("; ")}.`;
}

/** O nome de cada janela na lista "Aparência" do Sobre (spec #25011). */
export const WINDOW_NAME: Record<UiWindow, string> = {
  hub: "Kiwi Notes",
  notes: "Notas",
  settings: "Ajustes",
  history: "Histórico",
  intro: "Abertura",
};

/** Uma linha da lista "Aparência": a janela e a UI dela, a de fábrica ou uma que chegou depois. */
export function appearanceLine(w: UiAppearance["windows"][number]): { name: string; version: string } {
  const version = w.builtIn ? `${w.uiVersion} (de fábrica)` : w.uiVersion;
  return { name: WINDOW_NAME[w.window], version: w.pending ? `${version} · nova pronta: ${w.pending}` : version };
}

export const REVERT_HINT = "Volta cada janela à aparência que ela tinha antes da última que chegou, sem fechar o app.";
