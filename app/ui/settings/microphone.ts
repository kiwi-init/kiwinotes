// O seletor de microfone dos Ajustes (spec #3202, T3230): as opções e a dica, sem DOM. Quem grava é o helper; aqui só
// se escolhe por qual entrada.

import { type AudioInputs, type MicInUse, type MicrophoneChoice, microphoneUid } from "../../src/shared/microphone.ts";

export interface MicOption {
  value: MicrophoneChoice;
  label: string;
}

/**
 * As escolhas, nesta ordem: Automático, Mic do Mac, cada microfone que o helper vê (menos o do Mac, que já tem a linha
 * dele), um salvo que saiu (desconectado) e o Padrão do sistema. Sem a lista (helper fora do ar ou antigo), só as fixas.
 * "Mic do Mac" some num Mac sem microfone (um Mac mini), a não ser que seja a escolha salva.
 */
export function micOptions(choice: MicrophoneChoice, inputs: AudioInputs | null): MicOption[] {
  const out: MicOption[] = [{ value: "auto", label: "Automático" }];
  const hasBuiltin = !inputs || inputs.inputs.some((i) => i.transport === "builtin");
  if (hasBuiltin || choice === "builtin") out.push({ value: "builtin", label: "Mic do Mac" });
  for (const i of inputs?.inputs ?? []) {
    if (i.transport === "builtin") continue;
    out.push({ value: `uid:${i.uid}`, label: i.name });
  }
  const uid = microphoneUid(choice);
  if (uid && !out.some((o) => o.value === choice)) {
    out.push({ value: choice, label: inputs ? "Microfone salvo (desconectado)" : "Microfone salvo" });
  }
  out.push({ value: "system", label: "Padrão do sistema" });
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
      ? `Desconectado. Até ele voltar, o ditado grava pelo ${using.name}.`
      : "Desconectado. Até ele voltar, o ditado usa o Automático.";
  }
  const live = using && inputs ? liveHint(choice, using, inputs) : null;
  if (live) return live;
  const out = inputs?.output;
  if (choice === "auto") {
    return out?.transport === "bluetooth"
      ? `Com ${out.name || "o fone Bluetooth"} na saída, o ditado grava pelo mic do Mac e o som do fone não cai.`
      : "Com fone Bluetooth na saída, o ditado grava pelo mic do Mac e o som do fone não cai.";
  }
  if (choice === "builtin") return "O ditado grava sempre pelo mic do Mac.";
  if (choice === "system") return "O microfone padrão do macOS. Com AirPods, o som deles abaixa enquanto você dita.";
  if (found?.transport === "bluetooth") return "Um microfone Bluetooth: enquanto você dita, o som do fone abaixa.";
  return "O ditado grava sempre por este microfone. Se ele sair, volta para o Automático.";
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
  const name = using.name || "microfone padrão do macOS";
  const lid = using.lidClosed ? "Com a tampa fechada, o mic do Mac não grava. " : "";
  const drop = transport === "bluetooth" && bluetoothOut ? ": enquanto você dita, o som do fone abaixa." : ".";
  return `${lid}Agora o ditado grava pelo ${name}${drop}`;
}
