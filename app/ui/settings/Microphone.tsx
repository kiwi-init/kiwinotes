// O "Microfone" dos Ajustes (spec #3202, T3230): por qual entrada o ditado grava. A lista vem do helper (`audio.inputs`,
// que só lista e nunca abre o mic) e volta a ser lida quando um dispositivo entra ou sai, ou quando a lista abre.
import { useCallback, useEffect, useState } from "react";

import type { AudioInputs, MicrophoneChoice } from "../../src/shared/microphone.ts";
import { api, has } from "../src/api.ts";
import { Row, Select } from "../src/kit/index.tsx";
import { micHint, micOptions } from "./microphone.ts";

export function MicrophoneRow() {
  const [choice, setChoice] = useState<MicrophoneChoice | null>(null);
  const [inputs, setInputs] = useState<AudioInputs | null>(null);
  const [failed, setFailed] = useState(false);

  const list = useCallback(() => {
    if (!has("audio.inputs")) return;
    // Sem o helper (E_NO_HELPER), ficam as escolhas fixas.
    api.audio.inputs().then(setInputs, () => setInputs(null));
  }, []);

  useEffect(() => {
    if (!has("settings.get")) return;
    api.settings.get().then(
      // Um engine de antes do 1.18.0 não manda `microphone`: a linha não aparece.
      (s) => setChoice(typeof s.microphone === "string" ? s.microphone : null),
      () => setFailed(true),
    );
    list();
    const offInputs = api.audio.onInputsChanged(list);
    // Mudou em outra janela (o hub e a janela de Ajustes), ou pelo engine: a lista acompanha.
    const offSettings = api.settings.onChanged((s) => {
      if (typeof s.microphone === "string") setChoice(s.microphone);
    });
    return () => {
      offInputs();
      offSettings();
    };
  }, [list]);

  if (choice === null || !has("settings.set")) return null;

  const change = (next: MicrophoneChoice) => {
    const before = choice;
    setChoice(next);
    setFailed(false);
    api.settings.set({ microphone: next }).then(
      (s) => {
        setChoice(s.microphone);
        // A dica diz o mic que o helper usaria com a escolha nova (T3344): pergunta de novo.
        list();
      },
      () => {
        setChoice(before);
        setFailed(true);
      },
    );
  };

  return (
    <Row label="Microfone" hint={failed ? "Não deu para salvar. Tente de novo." : micHint(choice, inputs)}>
      <Select label="Microfone" value={choice} onChange={change} onOpen={list} options={micOptions(choice, inputs)} />
    </Row>
  );
}
