// O microfone do ditado (spec #3202): qual entrada o helper usa ao gravar. Com fone Bluetooth (AirPods), gravar pelo
// mic dele troca o fone para o modo "headset" e o som cai; o automático grava por outro mic e o som segue bom.
//
// O valor vai nas Configurações (`microphone`) e no `config.set` do helper, igual nos dois lados:
// - "auto" (padrão): com a saída em Bluetooth e outro mic disponível, grava pelo outro; senão, pelo padrão do macOS;
// - "builtin": o mic do Mac;
// - "system": o padrão do macOS (o comportamento de antes do #3202);
// - "uid:<UID>": um dispositivo de entrada pelo UID do CoreAudio. Se ele sumir, o helper volta para o automático.

export type MicrophoneChoice = "auto" | "builtin" | "system" | `uid:${string}`;

export const DEFAULT_MICROPHONE: MicrophoneChoice = "auto";

/** O UID do CoreAudio é texto do driver; um limite folgado evita lixo nas Configurações. */
const MAX_UID = 512;

export function isMicrophoneChoice(v: unknown): v is MicrophoneChoice {
  if (v === "auto" || v === "builtin" || v === "system") return true;
  return typeof v === "string" && v.startsWith("uid:") && v.length > 4 && v.length <= 4 + MAX_UID && !/[\u0000-\u001f]/.test(v);
}

/** O UID de um `uid:…`, ou null para as escolhas fixas. */
export function microphoneUid(choice: MicrophoneChoice): string | null {
  return choice.startsWith("uid:") ? choice.slice(4) : null;
}

/** Como o dispositivo se liga ao Mac (o transport type do CoreAudio, resumido). */
export type AudioTransport = "builtin" | "bluetooth" | "usb" | "virtual" | "other";

/** Um dispositivo de entrada, como o helper lista (`audio.inputs`). */
export interface AudioInput {
  uid: string;
  name: string;
  transport: AudioTransport;
  /** É a entrada padrão do macOS agora. */
  isDefault: boolean;
}

/** O que o `audio.inputs` devolve: as entradas e a saída padrão de agora (para dizer se o fone é Bluetooth). */
export interface AudioInputs {
  inputs: AudioInput[];
  output: { name: string; transport: AudioTransport } | null;
}

const TRANSPORTS: ReadonlySet<string> = new Set<AudioTransport>(["builtin", "bluetooth", "usb", "virtual", "other"]);
const MAX_INPUTS = 64;

/** O que veio do helper, só com o que vale (um helper de outra versão não quebra o seletor); null se não é uma lista. */
export function sanitizeAudioInputs(x: unknown): AudioInputs | null {
  const o = x && typeof x === "object" ? (x as Record<string, unknown>) : null;
  if (!o || !Array.isArray(o.inputs)) return null;
  const transport = (t: unknown): AudioTransport => (typeof t === "string" && TRANSPORTS.has(t) ? (t as AudioTransport) : "other");
  const text = (v: unknown, max: number) => (typeof v === "string" && v.length > 0 && v.length <= max ? v : null);
  const seen = new Set<string>();
  const inputs: AudioInput[] = [];
  for (const i of o.inputs.slice(0, MAX_INPUTS)) {
    const d = i && typeof i === "object" ? (i as Record<string, unknown>) : {};
    const uid = text(d.uid, MAX_UID);
    if (!uid || seen.has(uid) || !isMicrophoneChoice(`uid:${uid}`)) continue;
    seen.add(uid);
    inputs.push({ uid, name: text(d.name, 200) ?? uid, transport: transport(d.transport), isDefault: d.isDefault === true });
  }
  const out = o.output && typeof o.output === "object" ? (o.output as Record<string, unknown>) : null;
  return { inputs, output: out ? { name: text(out.name, 200) ?? "", transport: transport(out.transport) } : null };
}
