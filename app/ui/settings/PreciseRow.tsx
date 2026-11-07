// O modo preciso do ditado (T6602, decisão do harry no #6894): o Whisper small no lugar do Parakeet, com o dicionário
// como prompt. Desligado por padrão. A linha mostra o que o modelo está fazendo (baixando, carregando, pronto), e
// desligar apaga o modelo.
import { useEffect, useState } from "react";

import type { PreciseStatus } from "../../src/shared/ui-contract.ts";
import { api, has } from "../src/api.ts";
import { Row, Switch } from "../src/kit/index.tsx";

const MB = (bytes: number) => Math.round(bytes / 1e6);

export function preciseHint(s: PreciseStatus, failed: boolean): string {
  if (failed) return "Não deu para salvar. Tente de novo.";
  const size = MB(s.size);
  if (!s.enabled) return `Erra menos termos técnicos, com o seu dicionário. Leva ~0,3 s a mais por ditado. Ligar baixa o modelo (${size} MB) uma vez.`;
  if (s.phase === "downloading") {
    const pct = s.total ? Math.floor(((s.done ?? 0) / s.total) * 100) : 0;
    return `Baixando o modelo: ${pct}% de ${size} MB, uma vez só. Até terminar, o ditado sai como sempre.`;
  }
  if (s.phase === "loading") return "Carregando o modelo…";
  if (s.phase === "waiting") return "O modelo já está aqui. Ele entra quando o ditado estiver pronto.";
  if (s.phase === "error" && s.error === "download") return "Não deu para baixar o modelo agora. Desligue e ligue para tentar de novo.";
  if (s.phase === "error") return "Não deu para abrir o modelo. O ditado continua como sempre.";
  if (s.phase === "ready") return "Ligado. Roda neste Mac: o áudio e o texto não saem daqui.";
  return "";
}

const settled = (s: PreciseStatus | null) => !s || !s.enabled || s.phase === "ready" || s.phase === "error";

export function PreciseRow() {
  const [status, setStatus] = useState<PreciseStatus | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!has("dictation.preciseStatus")) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const poll = () =>
      api.dictation.preciseStatus().then(
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
    setStatus({ ...status, enabled: next, phase: next ? "downloading" : "off", done: 0, total: status.size });
    api.settings.set({ preciseDictation: next }).then(
      () => api.dictation.preciseStatus().then(setStatus, () => {}),
      () => {
        setStatus({ ...status });
        setFailed(true);
      },
    );
  };

  return (
    <Row label="Modo preciso" hint={preciseHint(status, failed)}>
      <Switch label="Modo preciso" checked={status.enabled} onChange={change} />
    </Row>
  );
}
