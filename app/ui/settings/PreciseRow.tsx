// O modo preciso do ditado (T6602, decisão do harry no #6894): o Whisper small no lugar do Parakeet, com o dicionário
// como prompt. Desligado por padrão. A linha mostra o que o modelo está fazendo (baixando, carregando, pronto), e
// desligar apaga o modelo.
import { useEffect, useState } from "react";

import type { PreciseStatus } from "../../src/shared/ui-contract.ts";
import { api, has } from "../src/api.ts";
import { t, useT } from "../src/i18n.ts";
import { Row, Switch } from "../src/kit/index.tsx";

const MB = (bytes: number) => Math.round(bytes / 1e6);

/** A dica na língua de agora (o `t()` de fora do React; a linha redesenha pelo `useT()`). */
export function preciseHint(s: PreciseStatus, failed: boolean): string {
  if (failed) return t("common.saveFailed");
  const size = MB(s.size);
  if (!s.enabled) return t("precise.off", { size });
  if (s.phase === "downloading") {
    const pct = s.total ? Math.floor(((s.done ?? 0) / s.total) * 100) : 0;
    return t("precise.downloading", { pct, size });
  }
  if (s.phase === "loading") return t("common.loadingModel");
  if (s.phase === "waiting") return t("precise.waiting");
  if (s.phase === "error" && s.error === "download") return t("precise.downloadFailed");
  if (s.phase === "error") return t("precise.openFailed");
  if (s.phase === "ready") return t("precise.ready");
  return "";
}

const settled = (s: PreciseStatus | null) => !s || !s.enabled || s.phase === "ready" || s.phase === "error";

export function PreciseRow() {
  useT(); // redesenha quando a língua muda; o texto sai do `t()`, como na dica
  const [status, setStatus] = useState<PreciseStatus | null>(null);
  const [failed, setFailed] = useState(false);
  /** Muda depois que a configuração salvou: só aí a leitura recomeça, para uma resposta de antes não desfazer o clique. */
  const [round, setRound] = useState(0);

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
  }, [round]);

  if (!status) return null;

  const change = (next: boolean) => {
    setFailed(false);
    setStatus({ ...status, enabled: next, phase: next ? "downloading" : "off", done: 0, total: status.size });
    api.settings.set({ preciseDictation: next }).then(
      () => setRound((r) => r + 1),
      () => {
        setStatus({ ...status });
        setFailed(true);
      },
    );
  };

  return (
    <Row label={t("precise.label")} hint={preciseHint(status, failed)}>
      <Switch label={t("precise.label")} checked={status.enabled} onChange={change} />
    </Row>
  );
}
