// Os textos do passo da primeira abertura (T20796, spec #20780): por que o Kiwi pede cada permissão, o botão de cada
// uma e a linha do modelo de voz baixando. TypeScript puro, testado no `bun test`.

import { SETUP_MODEL_MB, type SetupModel, type SetupPermission } from "../../../src/shared/first-run.ts";
import type { PermissionState } from "../../../src/shared/ipc.ts";

export const SETUP_TITLE = "Antes de ditar";
export const SETUP_HINT = "Duas permissões do macOS e o modelo de voz. Tudo fica aqui no seu Mac.";

export const PERMISSION_TEXT: Record<SetupPermission, { name: string; why: string }> = {
  inputMonitoring: {
    name: "Monitoramento de Entrada",
    why: "Para o Kiwi ouvir o atalho do ditado em qualquer app. Ele só olha o atalho, não o que você digita.",
  },
  accessibility: {
    name: "Acessibilidade",
    why: "Para colar o texto ditado onde o cursor está.",
  },
};

/** O botão de uma permissão: `null` quando já foi dada (a linha mostra "Permitido"). */
export function permissionButton(state: PermissionState | undefined): string | null {
  if (state === "granted") return null;
  return state === "undetermined" ? "Permitir" : "Abrir os Ajustes";
}

export const MODEL_TITLE = "O modelo de voz";
export const MODEL_WHY =
  `O ditado roda no seu Mac, sem internet. Para isso, o Kiwi baixa o modelo uma vez: cerca de ${SETUP_MODEL_MB.main} MB, ` +
  `e os ${SETUP_MODEL_MB.boosting} MB do vocabulário só quando você puser palavras no dicionário. Dá para continuar ` +
  "enquanto o modelo baixa.";

/** A linha do modelo agora, e a fração da barra (`null`: sem barra). */
export function modelLine(m: SetupModel): { text: string; fraction: number | null; done: boolean; failed: boolean } {
  if (m.state === "ready") {
    const text = m.boosting === "loading" ? `Pronto para ditar. O vocabulário (${SETUP_MODEL_MB.boosting} MB) ainda baixa.` : "Pronto para ditar.";
    return { text, fraction: 1, done: true, failed: false };
  }
  if (m.state === "unavailable")
    return { text: "Não deu para baixar agora. Confira a internet; o Kiwi tenta de novo na próxima abertura.", fraction: null, done: false, failed: true };
  if (m.state === "starting") return { text: "Começando…", fraction: null, done: false, failed: false };
  if (m.phase === "downloading" && m.fraction !== undefined) {
    const pct = Math.round(Math.min(Math.max(m.fraction, 0), 1) * 100);
    return { text: `Baixando: ${pct}% de ${SETUP_MODEL_MB.main} MB`, fraction: pct / 100, done: false, failed: false };
  }
  if (m.phase === "listing") return { text: "Procurando os arquivos do modelo…", fraction: null, done: false, failed: false };
  if (m.phase === "compiling") return { text: "Preparando o modelo para este Mac…", fraction: null, done: false, failed: false };
  return { text: "Carregando o modelo…", fraction: null, done: false, failed: false };
}

/** O botão do fim: segue sem as permissões (o app pede depois), mas diz que falta. */
export function continueLabel(missing: number): string {
  return missing === 0 ? "Continuar" : "Continuar sem permitir";
}
