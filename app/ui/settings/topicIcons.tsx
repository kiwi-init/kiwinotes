// Os ícones da barra lateral de Ajustes (spec #11966): SVG local, 16 px, traço de 1,3 na cor do texto, como os da árvore
// das Notas (`treeIcons.tsx`). Sem lib nem CDN.

import type { ReactElement } from "react";

import type { SettingsTopic } from "./topics.ts";

const PATHS: Record<SettingsTopic, ReactElement> = {
  // A paleta de pintor (pedido do harry, #12472): o contorno com o furo do polegar e quatro pontos de tinta.
  appearance: (
    <>
      <path d="M8 2.4c-3.2 0-5.6 2.4-5.6 5.5 0 3.1 2.4 5.7 5.3 5.7.9 0 1.4-.7 1-1.5-.4-.8.1-1.7 1-1.7h1.4c1.6 0 2.5-1.1 2.5-2.6 0-3.1-2.5-5.4-5.6-5.4z" />
      <circle cx="5.2" cy="8.3" r=".8" fill="currentColor" stroke="none" />
      <circle cx="5.9" cy="5.5" r=".8" fill="currentColor" stroke="none" />
      <circle cx="8.6" cy="4.4" r=".8" fill="currentColor" stroke="none" />
      <circle cx="11" cy="6" r=".8" fill="currentColor" stroke="none" />
    </>
  ),
  // O microfone.
  dictation: (
    <>
      <rect x="6" y="2" width="4" height="7.5" rx="2" />
      <path d="M3.8 7.8a4.2 4.2 0 0 0 8.4 0M8 12v2" />
    </>
  ),
  // A nota.
  notes: (
    <>
      <path d="M4 2h5.5L12.5 5v8.5c0 .3-.2.5-.5.5H4c-.3 0-.5-.2-.5-.5v-11c0-.3.2-.5.5-.5z" />
      <path d="M9.5 2v3h3M5.8 8h4.4M5.8 10.5h4.4" />
    </>
  ),
  // As pessoas da reunião.
  meetings: (
    <>
      <circle cx="6" cy="5.5" r="2" />
      <path d="M2.5 13c0-2 1.6-3.5 3.5-3.5S9.5 11 9.5 13" />
      <circle cx="11" cy="6" r="1.6" />
      <path d="M10.6 9.6c1.6 0 2.9 1.3 2.9 3" />
    </>
  ),
  // O brilho do agente.
  agent: <path d="M8 2.2c.4 2.6 1.2 3.4 3.8 3.8-2.6.4-3.4 1.2-3.8 3.8-.4-2.6-1.2-3.4-3.8-3.8 2.6-.4 3.4-1.2 3.8-3.8zM12 10c.2 1.1.6 1.5 1.7 1.7-1.1.2-1.5.6-1.7 1.7-.2-1.1-.6-1.5-1.7-1.7 1.1-.2 1.5-.6 1.7-1.7z" />,
  // A lista do que o agente fez.
  activity: (
    <>
      <path d="M6 4.5h7M6 8h7M6 11.5h7" />
      <circle cx="3.4" cy="4.5" r=".7" fill="currentColor" />
      <circle cx="3.4" cy="8" r=".7" fill="currentColor" />
      <circle cx="3.4" cy="11.5" r=".7" fill="currentColor" />
    </>
  ),
  // O cadeado.
  privacy: (
    <>
      <rect x="3.5" y="7" width="9" height="6.5" rx="1.5" />
      <path d="M5.5 7V5.2a2.5 2.5 0 0 1 5 0V7" />
    </>
  ),
  // O "i".
  about: (
    <>
      <circle cx="8" cy="8" r="5.5" />
      <path d="M8 7.2v3.8" />
      <circle cx="8" cy="5.1" r=".6" fill="currentColor" stroke="none" />
    </>
  ),
};

export function TopicIcon({ topic }: { topic: SettingsTopic }) {
  return (
    <svg className="kn-prefs-icon" viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {PATHS[topic]}
    </svg>
  );
}
