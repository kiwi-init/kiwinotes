// As trilhas (ADR 0013 decisão 4; T14682), em Ajustes › Agente: as palavras que já levaram o agente a uma nota, e que da
// próxima vez fazem a Bússola achá-la sozinha. Visíveis e apagáveis, uma a uma. Só no Mac.

import { useCallback, useEffect, useState } from "react";

import type { AgentTrailView } from "../../src/shared/ui-contract.ts";
import { api, has } from "../src/api.ts";
import { Button, Row, Section } from "../src/kit/index.tsx";
import { whenOf } from "./activityText.ts";
import { trilhaHint, trilhaLabel } from "./trailsText.ts";

export function TrailsSection() {
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
  return (
    <Section title="As trilhas">
      {trails.length === 0 ? (
        <Row
          label="Nenhuma trilha ainda"
          hint="Quando a Bússola não acha a nota e o agente chega a ela por outro caminho, o Kiwi guarda as palavras do pedido. Da próxima vez, a nota sobe sozinha. Fica só neste Mac."
        />
      ) : (
        trails.map((t) => (
          <Row key={t.id} label={trilhaLabel(t)} hint={`${trilhaHint(t)} · ${whenOf(new Date(t.em).toISOString())}`}>
            <Button onClick={() => void api.agent.trailDelete(t.id).then((r) => setTrails(r.trilhas), load)} aria-label={`Apagar a trilha ${trilhaLabel(t)}`}>
              Apagar
            </Button>
          </Row>
        ))
      )}
    </Section>
  );
}
