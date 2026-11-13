import { useEffect, useState } from "react";
import { api } from "../src/api";
import { Row, Switch } from "../src/kit/index";
export function CatRow() {
  const [show, setShow] = useState<boolean | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true, changes = 0;
    const off = api.settings.onChanged(s => { changes++; if (alive) setShow(s.kiwicat?.show ?? null); });
    void api.settings.get().then(s => { if (alive && !changes) setShow(s.kiwicat?.show ?? null); }, () => {});
    return () => { alive = false; off(); };
  }, []);
  if (show === null) return null;
  return <Row label="Mostrar o Kiwi-cat" hint={failed ? "Não deu para salvar. Tente de novo." : "O gato mostra o que o agente está fazendo no canto da janela."}>
    <Switch label="Mostrar o Kiwi-cat" checked={show} onChange={next => {
      setFailed(false);
      void api.settings.set({ kiwicat: { show: next } }).then(s => setShow(s.kiwicat.show), () => setFailed(true));
    }} />
  </Row>;
}
