// T6594: qual linha é um embed de nota (sem DOM): a usada pelo widget do embed e pelos blocos desenhados, que a deixam
// para ele.
import { embedLine } from "./attachments.ts";

/** Uma linha que é só um embed de nota (não de anexo): o link inteiro, como está escrito. */
export function noteEmbedLine(text: string): string | null {
  const m = /^\s*!\[\[([^\[\]\n]+)\]\]\s*$/.exec(text);
  if (!m || embedLine(text)) return null;
  const inner = m[1]!.trim();
  if (inner.startsWith("#")) return null;
  return inner;
}
