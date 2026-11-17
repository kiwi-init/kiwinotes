// Ler o texto das imagens e dos PDFs anexados para a busca (T2709). Quem lê é o macOS (Vision e PDFKit), neste Mac.
import { useEffect, useState } from "react";

import { api, has } from "../src/api.ts";
import { Row, Switch } from "../src/kit/index.tsx";

export function OcrRow() {
  const [on, setOn] = useState<boolean | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!has("settings.get")) return;
    api.settings.get().then(
      // Um engine de antes do 1.12.0 não manda `ocr`: a linha não aparece.
      (s) => setOn(typeof s.ocr === "boolean" ? s.ocr : null),
      () => setFailed(true),
    );
  }, []);

  if (on === null) return null;

  const change = (next: boolean) => {
    setOn(next);
    setFailed(false);
    api.settings.set({ ocr: next }).then(
      (s) => setOn(s.ocr),
      () => {
        setOn(!next);
        setFailed(true);
      },
    );
  };

  return (
    <Row
      label="Buscar texto em imagens e PDFs"
      hint={failed ? "Não deu para salvar. Tente de novo." : "O macOS lê os anexos neste Mac, em segundo plano. Nada sai daqui."}
    >
      <Switch label="Buscar texto em imagens e PDFs" checked={on} onChange={change} />
    </Row>
  );
}
