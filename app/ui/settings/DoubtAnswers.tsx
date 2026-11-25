// "O que você já respondeu" (spec #9873), em Ajustes › Agente: as respostas da pergunta na dúvida, com a máscara do
// trecho (nunca o trecho), e o Desfazer, que faz o Kiwi voltar a perguntar.

import { useCallback, useEffect, useState } from "react";

import type { AgentDoubtAnswer } from "../../src/shared/ui-contract.ts";
import { api, has } from "../src/api.ts";
import { useT } from "../src/i18n.ts";
import { Button, Row, Section } from "../src/kit/index.tsx";
import { whenOf } from "./activityText.ts";

export function DoubtAnswersSection() {
  const { t } = useT();
  const [answers, setAnswers] = useState<AgentDoubtAnswer[] | null>(null);
  const load = useCallback(() => {
    void api.agent.answers().then(
      (r) => setAnswers(r.answers),
      () => setAnswers([]),
    );
  }, []);
  useEffect(() => {
    if (!has("agent.answers")) return;
    load();
    const offQ = api.agent.onQuestion(load);
    const offA = api.agent.onActivity(load);
    return () => {
      offQ();
      offA();
    };
  }, [load]);
  if (!has("agent.answers") || answers === null) return null;
  return (
    <Section title={t("answers.title")}>
      {answers.length === 0 ? (
        <Row label={t("answers.none")} hint={t("answers.noneHint")} />
      ) : (
        answers.map((a) => (
          <Row
            key={a.fingerprint}
            label={a.answer === "send" ? t("hub.doubt.send") : t("hub.doubt.secret")}
            hint={t("answers.when", { mask: a.mask, when: whenOf(a.at) })}
          >
            <Button onClick={() => void api.agent.forget(a.fingerprint).then(load, load)} aria-label={t("answers.undoAria", { mask: a.mask })}>
              {t("common.undo")}
            </Button>
          </Row>
        ))
      )}
    </Section>
  );
}
