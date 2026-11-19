// O aviso do Kiwi (T20869, spec #20843): "o Kiwi está escrevendo…" em cima da nota enquanto a escrita dele aparece, e
// "o Kiwi atualizou este arquivo" no cartão de um arquivo que não é nota. Com o rostinho dele, na cor dos Ajustes.

import { kiwiFaceUrl } from "./editor/kiwi-face.ts";

export function KiwiNotice({ cor, text, hint }: { cor: string | undefined; text: string; hint?: string }) {
  const face = kiwiFaceUrl(cor);
  return (
    <div className="kn-kiwi-notice" role="status" aria-live="polite">
      {face ? <img className="kn-kiwi-face" src={face} alt="" draggable={false} /> : <span className="kn-kiwi-face" />}
      <span>{text}</span>
      {hint ? <span className="kn-kiwi-notice-hint">· {hint}</span> : null}
    </div>
  );
}
