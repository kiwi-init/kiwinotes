// Os modelos de nota (T2619, spec #2457 ponto 3): uma nota na pasta de modelos (`Modelos/`, nas Configurações) vira o
// começo de uma nota nova, com `{{title}}`, `{{date}}`, `{{time}}` e `{{date:AAAA-MM-DD}}` trocados na criação, como
// no Obsidian. O formato aceita AAAA ou YYYY (ano), MM, DD, HH, mm e ss. A data é a local.

export const DEFAULT_TEMPLATES_FOLDER = "Modelos";

const pad = (n: number) => String(n).padStart(2, "0");

/** A data no formato dado: `AAAA-MM-DD`, `DD/MM/YYYY`, `HH:mm`… */
export function formatDate(d: Date, format: string): string {
  return format.replace(/AAAA|YYYY|MM|DD|HH|mm|ss/g, (tok) => {
    switch (tok) {
      case "AAAA":
      case "YYYY":
        return String(d.getFullYear());
      case "MM":
        return pad(d.getMonth() + 1);
      case "DD":
        return pad(d.getDate());
      case "HH":
        return pad(d.getHours());
      case "mm":
        return pad(d.getMinutes());
      default:
        return pad(d.getSeconds());
    }
  });
}

/** O texto do modelo com as variáveis trocadas. O que não é variável conhecida fica como está. */
export function fillTemplate(text: string, vars: { title: string; now: Date }): string {
  return text.replace(/\{\{\s*(title|date|time)\s*(?::\s*([^}]*?)\s*)?\}\}/g, (raw, name: string, format?: string) => {
    if (name === "title") return format ? raw : vars.title;
    if (name === "date") return formatDate(vars.now, format || "AAAA-MM-DD");
    return formatDate(vars.now, format || "HH:mm");
  });
}
