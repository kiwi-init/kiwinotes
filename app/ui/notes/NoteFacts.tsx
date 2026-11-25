// A linha de fatos da nota aberta (T29245, spec #28171): "editada hoje" e as palavras, na língua da tela. Fica num
// componente à parte para o teste ver o que a tela mostra em inglês, e não só a função.

import { useT } from "../src/i18n.ts";
import { editedLabel } from "./tree.ts";
import type { NoteMeta } from "./types.ts";

export function NoteFacts({ note, words, now }: { note: Pick<NoteMeta, "mtime">; words: number; now?: Date }) {
  const { t, locale } = useT();
  return (
    <>
      {[editedLabel(note, now, locale), t("notes.words", { n: words })].map((text) => (
        <span key={text}>{text}</span>
      ))}
    </>
  );
}
