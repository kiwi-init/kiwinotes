// "Mencionada sem link" (T2593, como no Obsidian): no painel da direita, abaixo do "Citada em", as notas que citam o
// título desta sem `[[ ]]`, com um "Linkar" que troca a menção pelo link naquela nota.

import { useEffect, useState } from "react";

import type { ExtrasApi, Mention } from "./types.ts";

export function UnlinkedMentions({
  extras,
  path,
  version,
  onOpen,
}: {
  extras: ExtrasApi;
  path: string;
  /** Muda quando o vault muda: a lista se refaz. */
  version: number;
  onOpen(path: string): void;
}) {
  const [mentions, setMentions] = useState<Mention[]>([]);
  useEffect(() => {
    let live = true;
    extras.unlinkedMentions(path).then(
      (m) => live && setMentions(m),
      () => live && setMentions([]),
    );
    return () => {
      live = false;
    };
  }, [extras, path, version]);
  if (!mentions.length) return null;
  return (
    <>
      <div className="kn-right-h kn-right-h2">Mencionada sem link</div>
      {mentions.map((m) => (
        <div className="kn-back kn-mention" key={m.path}>
          <button type="button" className="kn-mention-open" onClick={() => onOpen(m.path)}>
            <span className="kn-link">{m.title}</span>
            <span className="kn-back-ctx">{m.context}</span>
          </button>
          <button
            type="button"
            className="kn-bt kn-mention-link"
            onClick={() => void extras.linkMentions(m.path, path).then(() => setMentions((all) => all.filter((x) => x.path !== m.path)))}
          >
            Linkar
          </button>
        </div>
      ))}
    </>
  );
}
