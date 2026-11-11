// Os textos da seção Sobre (T2386), fora do componente: assim os testes não carregam o CSS nem o ícone.

import type { AppChannel, UpdatesView } from "../../src/shared/ui-contract.ts";

export const CHANNEL: Record<AppChannel, string> = {
  rc: "versões de teste (rc)",
  stable: "estável",
  dev: "desenvolvimento",
};

const time = (iso: string) => new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

/** A linha do estado das atualizações, dita para a pessoa. */
export function statusLine(v: UpdatesView): string {
  switch (v.state) {
    case "off":
      return `As atualizações estão desligadas neste build (${v.reason}).`;
    case "checking":
      return "Verificando…";
    case "downloading":
      return `Baixando a ${v.version}…`;
    case "ready":
      // Pronta, mas a troca já falhou uma vez (o "Atualizar e reiniciar" voltou): diz o porquê, e o botão segue lá.
      return v.lastCheck?.result === "error" ? v.lastCheck.message : `A ${v.version} está pronta.`;
    case "applying":
      return "Atualizando: o Kiwi Notes vai fechar e abrir de novo.";
    case "idle": {
      const last = v.lastCheck;
      if (!last) return "Ainda não verificado.";
      if (last.result === "latest") return `Você está na última versão. Verificado às ${time(last.at)}.`;
      if (last.result === "error") return `${last.message} (às ${time(last.at)})`;
      return `A ${last.version} está disponível.`;
    }
  }
}


/**
 * O software de terceiros que vai dentro do app e pede crédito (spec #7079): cada visualizador de arquivo das Notas
 * que usa uma biblioteca entra aqui, com a licença dela.
 */
export const CREDITS: readonly { name: string; by: string; license: string; use: string; /** O pacote npm, de onde vem o texto da licença. */ pkg: string }[] = [
  { name: "PDF.js", by: "Mozilla", license: "Apache-2.0", use: "abrir pdf nas Notas", pkg: "pdfjs-dist" },
  { name: "Mammoth", by: "Michael Williamson", license: "BSD-2-Clause", use: "abrir docx nas Notas", pkg: "mammoth" },
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
