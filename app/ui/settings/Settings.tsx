// Configurações. Por enquanto só a casca: os controles guardam estado local e
// ganham efeito quando o sidecar (T50) e o ditado entrarem.
import { useState } from "react";

import { Kbd, Row, Section, Segmented, Switch, Window } from "../src/kit/index.tsx";
import { AppearanceSection } from "./Appearance.tsx";
import { DictionarySection } from "./Dictionary.tsx";
import { ExtensionsRow } from "./ExtensionsRow.tsx";
import { MicrophoneRow } from "./Microphone.tsx";
import { NotesFolderRow } from "../notes/NotesFolder.tsx";
import "../notes/notes.css";
import { OcrRow } from "./OcrRow.tsx";
import { CuesRow } from "./CuesRow.tsx";
import { ShortcutsSection } from "./Shortcuts.tsx";
import { SnippetsSection } from "./Snippets.tsx";

export function Settings() {
  const [lang, setLang] = useState<"auto" | "pt" | "en">("auto");
  const [keepAudio, setKeepAudio] = useState(false);

  return (
    <Window title="Configurações">
      <AppearanceSection />

      {/* Todos os atalhos, configuráveis (T5349). Antes, a tecla do ditado aqui só mudava a tela: nunca era salva. */}
      <ShortcutsSection />

      <Section title="Transcrição">
        <MicrophoneRow />
        <CuesRow />
        <Row label="Idioma" hint="Automático aceita português e inglês na mesma frase.">
          <Segmented
            label="Idioma"
            value={lang}
            onChange={setLang}
            options={[
              { value: "auto", label: "Automático" },
              { value: "pt", label: "Português" },
              { value: "en", label: "Inglês" },
            ]}
          />
        </Row>
        <Row label="Guardar o áudio no histórico" hint="Fica só neste Mac.">
          <Switch label="Guardar o áudio no histórico" checked={keepAudio} onChange={setKeepAudio} />
        </Row>
      </Section>

      <DictionarySection />
      <SnippetsSection />

      <Section title="Notas">
        <NotesFolderRow />
        <ExtensionsRow />
        <OcrRow />
      </Section>

      <Section title="Privacidade">
        <Row label="Tudo roda neste Mac" hint="Áudio, transcrição e texto nunca saem daqui.">
          <Kbd>100% local</Kbd>
        </Row>
      </Section>
    </Window>
  );
}

