// As trilhas (ADR 0013 decisão 4; T14682), em Ajustes › Agente: as palavras que já levaram o agente a uma nota, e que da
// próxima vez fazem a Bússola achá-la sozinha. Visíveis e apagáveis, uma a uma. Só no Mac. As que ainda esperam a
// segunda vez (T21325) ficam à parte, em "Aprendendo".

import { useCallback, useEffect, useState } from "react";

import type { AgentTrailView } from "../../src/shared/ui-contract.ts";
import { api, has } from "../src/api.ts";
import { Button, Row, Section } from "../src/kit/index.tsx";
import { whenOf } from "./activityText.ts";
import { useT } from "../src/i18n.ts";
import { aprendendoHint, trilhaHint, trilhaLabel } from "./trailsText.ts";

export function TrailsSection() {
  const { t: tr } = useT();
  const [trails, setTrails] = useState<AgentTrailView[] | null>(null);
  const load = useCallback(() => {
    void api.agent.trails().then(
      (r) => setTrails(r.trilhas),
      () => setTrails([]),
    );
  }, []);
  useEffect(() => {
    if (!has("agent.trails")) return;
    load();
    // Uma trilha nasce no fim de um pedido: a atividade avisa.
    return api.agent.onActivity(load);
  }, [load]);
  if (!has("agent.trails") || trails === null) return null;
  const row = (t: AgentTrailView) => (
    <Row key={t.id} label={trilhaLabel(t)} hint={`${trilhaHint(t)} · ${whenOf(new Date(t.em).toISOString())}`}>
      <Button onClick={() => void api.agent.trailDelete(t.id).then((r) => setTrails(r.trilhas), load)} aria-label={tr("trails.deleteAria", { name: trilhaLabel(t) })}>
        {tr("common.delete")}
      </Button>
    </Row>
  );
  const valem = trails.filter((t) => !t.aprendendo);
  const aprendendo = trails.filter((t) => t.aprendendo);
  return (
    <>
      <Section title={tr("trails.title")}>
        {valem.length === 0 ? (
          <Row
            label={tr("trails.none")}
            hint={tr("trails.noneHint")}
          />
        ) : (
          valem.map(row)
        )}
      </Section>
      {aprendendo.length > 0 && (
        <Section title={tr("trails.learning")}>
          <Row label={tr("trails.waiting")} hint={aprendendoHint()} />
          {aprendendo.map(row)}
        </Section>
      )}
    </>
  );
}
