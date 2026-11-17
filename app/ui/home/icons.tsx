// Os ícones da tela de Início: traço de 1.6 px numa caixa de 16, como os do app.
import type { ReactNode } from "react";

const Svg = ({ children, size = 16 }: { children: ReactNode; size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {children}
  </svg>
);

export const HomeIcon = (p: { size?: number }) => <Svg {...p}><path d="M2.5 7.2 8 2.75l5.5 4.45V13a.5.5 0 0 1-.5.5H9.75V10h-3.5v3.5H3a.5.5 0 0 1-.5-.5z" /></Svg>;
export const NoteIcon = (p: { size?: number }) => <Svg {...p}><path d="M4 2.5h5.5L12 5v8.5H4z" /><path d="M9.5 2.5V5H12M6 8h4M6 10.5h4" /></Svg>;
export const MeetingIcon = (p: { size?: number }) => <Svg {...p}><rect x="2" y="4" width="8.5" height="8" rx="2" /><path d="m10.5 7 3.5-2v6l-3.5-2" /></Svg>;
export const MicIcon = (p: { size?: number }) => <Svg {...p}><rect x="5.75" y="2" width="4.5" height="7.5" rx="2.25" /><path d="M3.5 7.5a4.5 4.5 0 0 0 9 0M8 12v2" /></Svg>;
export const SearchIcon = (p: { size?: number }) => <Svg {...p}><circle cx="7" cy="7" r="4.5" /><path d="m10.5 10.5 3 3" /></Svg>;
export const ChevronIcon = (p: { size?: number }) => <Svg {...p}><path d="M6 3.5 10.5 8 6 12.5" /></Svg>;
