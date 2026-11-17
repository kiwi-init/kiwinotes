// A saudação e a frase da tela de Início (spec #15728, harry #15805): pela hora, e uma frase de uma lista local que
// muda a cada abertura do hub. Nada aqui chama o agente nem a rede.

export const PHRASES = [
  "Vamos continuar de onde paramos.",
  "O que vamos guardar hoje?",
  "Tudo o que você escreveu está aqui.",
  "Uma ideia de cada vez.",
  "Um bom lugar para começar.",
  "O que ficou para hoje?",
] as const;

/** Bom dia das 5h ao meio-dia, boa tarde até as 18h, boa noite no resto (a madrugada também). */
export function greeting(date: Date): string {
  const h = date.getHours();
  if (h >= 5 && h < 12) return "Bom dia";
  if (h >= 12 && h < 18) return "Boa tarde";
  return "Boa noite";
}

const KEY = "kiwi.home.phrase";

/**
 * A frase desta abertura: a seguinte à da abertura anterior, guardada no `localStorage` da janela. Sem ele (ou com um
 * valor estranho), a primeira.
 */
export function nextPhrase(storage: Pick<Storage, "getItem" | "setItem"> | null): string {
  let last = -1;
  try {
    const text = storage?.getItem(KEY);
    const raw = text ? Number(text) : NaN;
    if (Number.isInteger(raw) && raw >= 0) last = raw;
  } catch {}
  const i = (last + 1) % PHRASES.length;
  try {
    storage?.setItem(KEY, String(i));
  } catch {}
  return PHRASES[i]!;
}
