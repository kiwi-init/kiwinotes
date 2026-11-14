// Abrir Ajustes num assunto, de dentro do hub (spec #11966, T12117): um texto "Ajustes › Agente › Memória" que vira link
// leva direto ao assunto e rola até a linha. Fora do hub (a janela de Ajustes sozinha), não há para onde ir: `null`.

import { createContext, useContext } from "react";

import type { SettingsTopic } from "../settings/topics.ts";

/** O pedido que o hub passa para Ajustes: `n` muda a cada pedido, mesmo para o mesmo assunto. */
export interface SettingsRequest {
  topic: SettingsTopic;
  /** O nome da linha ou da seção para rolar até ela (o texto do rótulo). */
  row?: string;
  n: number;
}

export interface HubNav {
  openSettings(topic: SettingsTopic, row?: string): void;
}

export const HubNavContext = createContext<HubNav | null>(null);
export const useHubNav = () => useContext(HubNavContext);
