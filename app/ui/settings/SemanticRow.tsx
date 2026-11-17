// A busca pelo sentido (T6013, #4766): o modelo local (multilingual-e5-small), baixado uma vez. A linha mostra o que
// ele está fazendo (baixando, lendo as notas, pronto) e desligar apaga o modelo e os vetores.
import { useEffect, useState } from "react";

import type { SemanticStatus } from "../../src/shared/ui-contract.ts";
import { api, has } from "../src/api.ts";
import { Row, Switch } from "../src/kit/index.tsx";

const MB = (bytes: number) => Math.round(bytes / 1e6);

export function semanticHint(s: SemanticStatus | null, failed: boolean): string {
  if (failed) return "Não deu para salvar. Tente de novo.";
  if (!s || !s.enabled) return "Desligada. Ligar baixa o modelo (135 MB) uma vez, do huggingface.co.";
  if (s.phase === "downloading") {
    const pct = s.total ? Math.floor(((s.done ?? 0) / s.total) * 100) : 0;
    return `Baixando o modelo: ${pct}% de ${MB(s.total ?? 135e6)} MB, uma vez só. O texto das notas não sai daqui.`;
  }
  if (s.phase === "loading") return "Carregando o modelo…";
  if (s.phase === "error") return "Não deu para baixar o modelo agora. Tenta de novo em alguns minutos.";
  if (s.phase === "ready" && s.indexed < s.notes) return `Lendo as notas: ${s.indexed} de ${s.notes}. A busca já usa as que estão prontas.`;
  if (s.phase === "ready") return "Acha notas pelo assunto, mesmo sem as palavras. Roda neste Mac; nada sai daqui.";
  return "Esperando a pasta de notas abrir.";
}

const settled = (s: SemanticStatus | null) =>
  !s || !s.enabled || s.phase === "error" || (s.phase === "ready" && s.indexed >= s.notes);

export function SemanticRow() {
  const [status, setStatus] = useState<SemanticStatus | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!has("notes.semanticStatus")) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const poll = () =>
      api.notes.semanticStatus().then(
        (s) => {
          if (!alive) return;
          setStatus(s);
          if (!settled(s)) timer = setTimeout(poll, 1000);
        },
        () => {
          if (alive) timer = setTimeout(poll, 5000);
        },
      );
    void poll();
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
  }, [status?.enabled]);

  if (!status) return null;

  const change = (next: boolean) => {
    setFailed(false);
    setStatus({ ...status, enabled: next, phase: next ? "idle" : "off" });
    api.settings.set({ semanticSearch: next }).then(
      () => api.notes.semanticStatus().then(setStatus, () => {}),
      () => {
        setStatus({ ...status });
        setFailed(true);
      },
    );
  };

  return (
    <Row label="Buscar pelo sentido" hint={semanticHint(status, failed)}>
      <Switch label="Buscar pelo sentido" checked={status.enabled} onChange={change} />
    </Row>
  );
}
