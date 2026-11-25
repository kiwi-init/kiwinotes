// O seletor de microfone dos Ajustes (spec #3202, T3230): as opções e a dica, sem DOM. Quem grava é o helper; aqui só
// se escolhe por qual entrada.

import { type AudioInputs, type MicInUse, type MicrophoneChoice, microphoneUid } from "../../src/shared/microphone.ts";
import { t } from "../src/i18n.ts";

export interface MicOption {
  value: MicrophoneChoice;
  label: string;
}

/**
 * As escolhas, nesta ordem: Automático, Mic do Mac, cada microfone que o helper vê (menos o do Mac, que já tem a linha
 * dele), um salvo que saiu (desconectado) e o Padrão do sistema. Sem a lista (helper fora do ar ou antigo), só as fixas.
 * "Mic do Mac" some num Mac sem microfone (um Mac mini), a não ser que seja a escolha salva.
 */
// Os textos na língua de agora (o `t()` de fora do React; a linha redesenha pelo `useT()`).
export function micOptions(choice: MicrophoneChoice, inputs: AudioInputs | null): MicOption[] {
  const out: MicOption[] = [{ value: "auto", label: t("mic.auto") }];
  const hasBuiltin = !inputs || inputs.inputs.some((i) => i.transport === "builtin");
  if (hasBuiltin || choice === "builtin") out.push({ value: "builtin", label: t("mic.builtin") });
  for (const i of inputs?.inputs ?? []) {
    if (i.transport === "builtin") continue;
    out.push({ value: `uid:${i.uid}`, label: i.name });
  }
  const uid = microphoneUid(choice);
  if (uid && !out.some((o) => o.value === choice)) {
    out.push({ value: choice, label: inputs ? t("mic.savedDisconnected") : t("mic.saved") });
  }
  out.push({ value: "system", label: t("mic.system") });
  return out;
}

/**
 * A linha de baixo do "Microfone": o que a escolha faz agora, com o fone que está na saída. Com o `using` do helper
 * (T3344), diz o mic de verdade quando ele não é o escolhido: com a tampa fechada o mic do Mac não grava, e o
 * automático vai para outro. Um `using` calculado para outra escolha (o helper ainda não recebeu a nova) não vale.
 */
export function micHint(choice: MicrophoneChoice, inputs: AudioInputs | null): string {
  const using = inputs?.using?.choice === choice ? inputs.using : undefined;
  const uid = microphoneUid(choice);
  const found = uid ? inputs?.inputs.find((i) => i.uid === uid) : undefined;
  // Um salvo fora da lista está desconectado, diga o `using` o que disser.
  if (uid && inputs && !found) {
    return using?.fellBack && using.name && !using.lidClosed
      ? t("mic.hint.disconnectedUsing", { name: using.name })
      : t("mic.hint.disconnected");
  }
  const live = using && inputs ? liveHint(choice, using, inputs) : null;
  if (live) return live;
  const out = inputs?.output;
  if (choice === "auto") {
    return out?.transport === "bluetooth"
      ? t("mic.hint.autoWith", { name: out.name || t("mic.hint.bluetoothHeadset") })
      : t("mic.hint.auto");
  }
  if (choice === "builtin") return t("mic.hint.builtin");
  if (choice === "system") return t("mic.hint.system");
  if (found?.transport === "bluetooth") return t("mic.hint.bluetooth");
  return t("mic.hint.fixed");
}

/**
 * Só quando o mic que o helper usaria não é o que o texto de sempre diz: a tampa fechada, ou o Automático e o Mic do
 * Mac indo para outro (o macOS com outra entrada padrão, um Mac sem microfone). Null nos outros casos.
 */
function liveHint(choice: MicrophoneChoice, using: MicInUse, inputs: AudioInputs): string | null {
  const bluetoothOut = inputs.output?.transport === "bluetooth";
  const transport = using.transport ?? inputs.inputs.find((i) => i.isDefault)?.transport ?? null;
  const notTheMac = transport !== "builtin";
  const applies = using.lidClosed || (choice === "builtin" && notTheMac) || (choice === "auto" && bluetoothOut && notTheMac);
  if (!applies) return null;
  const name = using.name || t("mic.hint.defaultName");
  const now = transport === "bluetooth" && bluetoothOut ? t("mic.hint.nowDucking", { name }) : t("mic.hint.now", { name });
  return using.lidClosed ? `${t("mic.hint.lidClosed")} ${now}` : now;
}
