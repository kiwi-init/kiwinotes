// A busca pelo sentido (T6013, #4766): o modelo local (multilingual-e5-small), baixado uma vez. A linha mostra o que
// ele está fazendo (baixando, lendo as notas, pronto) e desligar apaga o modelo e os vetores.
import { useEffect, useState } from "react";

import type { SemanticStatus } from "../../src/shared/ui-contract.ts";
import { api, has } from "../src/api.ts";
import { t, useT } from "../src/i18n.ts";
import { Row, Switch } from "../src/kit/index.tsx";

const MB = (bytes: number) => Math.round(bytes / 1e6);

/** A dica na língua de agora (o `t()` de fora do React; a linha redesenha pelo `useT()`). */
export function semanticHint(s: SemanticStatus | null, failed: boolean): string {
  if (failed) return t("common.saveFailed");
  if (!s || !s.enabled) return t("semantic.off", { size: 135 });
  if (s.phase === "downloading") {
    const pct = s.total ? Math.floor(((s.done ?? 0) / s.total) * 100) : 0;
    return t("semantic.downloading", { pct, size: MB(s.total ?? 135e6) });
  }
  if (s.phase === "loading") return t("common.loadingModel");
  if (s.phase === "error") return t("semantic.failed");
  if (s.phase === "ready" && s.indexed < s.notes) return t("semantic.indexing", { done: s.indexed, total: s.notes });
  if (s.phase === "ready") return t("semantic.ready");
  return t("semantic.waiting");
}

const settled = (s: SemanticStatus | null) =>
  !s || !s.enabled || s.phase === "error" || (s.phase === "ready" && s.indexed >= s.notes);

export function SemanticRow() {
  useT(); // redesenha quando a língua muda; o texto sai do `t()`, como na dica
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
    <Row label={t("semantic.label")} hint={semanticHint(status, failed)}>
      <Switch label={t("semantic.label")} checked={status.enabled} onChange={change} />
    </Row>
  );
}
