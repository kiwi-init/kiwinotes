// "O que você já respondeu" (spec #9873), em Ajustes › Agente: as respostas da pergunta na dúvida, com a máscara do
// trecho (nunca o trecho), e o Desfazer, que faz o Kiwi voltar a perguntar.

import { useCallback, useEffect, useState } from "react";

import type { AgentDoubtAnswer } from "../../src/shared/ui-contract.ts";
import { api, has } from "../src/api.ts";
import { Button, Row, Section } from "../src/kit/index.tsx";
import { whenOf } from "./activityText.ts";

export function DoubtAnswersSection() {
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
    <Section title="O que você já respondeu">
      {answers.length === 0 ? (
        <Row label="Nenhuma resposta ainda" hint="Quando o Kiwi ficar em dúvida se um trecho é senha ou token, ele pergunta, e a sua resposta aparece aqui." />
      ) : (
        answers.map((a) => (
          <Row
            key={a.fingerprint}
            label={a.answer === "send" ? "Pode mandar" : "É segredo"}
            hint={`${a.mask} · respondido ${whenOf(a.at)}`}
          >
            <Button onClick={() => void api.agent.forget(a.fingerprint).then(load, load)} aria-label={`Desfazer a resposta sobre ${a.mask}`}>
              Desfazer
            </Button>
          </Row>
        ))
      )}
    </Section>
  );
}
