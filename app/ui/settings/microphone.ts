// O seletor de microfone dos Ajustes (spec #3202, T3230): as opções e a dica, sem DOM. Quem grava é o helper; aqui só
// se escolhe por qual entrada.

import { type AudioInputs, type MicrophoneChoice, microphoneUid } from "../../src/shared/microphone.ts";

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
 * (T3344), diz o mic de verdade: com a tampa fechada o mic do Mac não grava, e o automático vai para outro.
 */
export function micHint(choice: MicrophoneChoice, inputs: AudioInputs | null): string {
  const live = inputs?.using ? liveHint(choice, inputs) : null;
  if (live) return live;
  const out = inputs?.output;
  if (choice === "auto") {
    return out?.transport === "bluetooth"
      ? `Com ${out.name || "o fone Bluetooth"} na saída, o ditado grava pelo mic do Mac e o som do fone não cai.`
      : "Com fone Bluetooth na saída, o ditado grava pelo mic do Mac e o som do fone não cai.";
  }
  if (choice === "builtin") return "O ditado grava sempre pelo mic do Mac.";
  if (choice === "system") return "O microfone padrão do macOS. Com AirPods, o som deles abaixa enquanto você dita.";
  const uid = microphoneUid(choice);
  const found = inputs?.inputs.find((i) => i.uid === uid);
  if (inputs && !found) return "Desconectado. Até ele voltar, o ditado usa o Automático.";
  if (found?.transport === "bluetooth") return "Um microfone Bluetooth: enquanto você dita, o som do fone abaixa.";
  return "O ditado grava sempre por este microfone. Se ele sair, volta para o Automático.";
}

/** O texto a partir do mic que o helper usaria agora; null quando o texto de sempre já diz certo. */
function liveHint(choice: MicrophoneChoice, inputs: AudioInputs): string | null {
  const using = inputs.using!;
  const bluetoothOut = inputs.output?.transport === "bluetooth";
  const transport = using.transport ?? inputs.inputs.find((i) => i.isDefault)?.transport ?? null;
  // O caso comum já tem o texto dele: o automático (ou o Mic do Mac) gravando pelo mic do Mac.
  if (!using.fellBack && transport === "builtin" && !using.systemDefault && (choice === "auto" || choice === "builtin")) return null;
  // O automático sem fone Bluetooth: o padrão do macOS, como sempre.
  if (choice === "auto" && !bluetoothOut && !using.fellBack) return null;
  if (choice === "system") return null;
  const name = using.name || "microfone padrão do macOS";
  const lid = using.reason.includes("lid closed") ? "Com a tampa fechada, o mic do Mac não grava. " : "";
  const gone = using.fellBack ? "Desconectado. Até ele voltar, " : "Agora ";
  const drop = transport === "bluetooth" && bluetoothOut ? ": enquanto você dita, o som do fone abaixa." : ".";
  return `${lid}${gone}o ditado grava pelo ${name}${drop}`;
}
