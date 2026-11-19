// O aviso do Kiwi (T20869, spec #20843): "o Kiwi está escrevendo…" em cima da nota enquanto a escrita dele aparece, e
// "o Kiwi atualizou este arquivo" no cartão de um arquivo que não é nota. Com o rostinho dele, na cor dos Ajustes.

import { useEffect, useState } from "react";

import { kiwiFace, kiwiFaceUrl } from "./editor/kiwi-face.ts";

export function KiwiNotice({ cor, text, hint }: { cor: string | undefined; text: string; hint?: string }) {
  // O rosto é o gato do app desenhado uma vez por paleta: na primeira vez, o ponto fica até ele sair.
  const [face, setFace] = useState(() => kiwiFaceUrl(cor));
  useEffect(() => {
    let live = true;
    void kiwiFace(cor).then((url) => live && setFace(url));
    return () => {
      live = false;
    };
  }, [cor]);
  return (
    <div className="kn-kiwi-notice" role="status" aria-live="polite">
      {face ? <img className="kn-kiwi-face" src={face} alt="" draggable={false} /> : <span className="kn-kiwi-face" />}
      <span>{text}</span>
      {hint ? <span className="kn-kiwi-notice-hint">· {hint}</span> : null}
    </div>
  );
}
