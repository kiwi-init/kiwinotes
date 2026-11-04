// Configurações. Por enquanto só a casca: os controles guardam estado local e
// ganham efeito quando o sidecar (T50) e o ditado entrarem.
import { useState } from "react";

import { Kbd, Row, Section, Segmented, Switch, Window } from "../src/kit/index.tsx";
import { AppearanceSection } from "./Appearance.tsx";
import { DictionarySection } from "./Dictionary.tsx";
import { NotesShortcutRow } from "./NotesShortcut.tsx";
import { SnippetsSection } from "./Snippets.tsx";

export function Settings() {
  const [key, setKey] = useState<"fn" | "rightOption">("fn");
  const [toggle, setToggle] = useState(true);
  const [lang, setLang] = useState<"auto" | "pt" | "en">("auto");
  const [keepAudio, setKeepAudio] = useState(false);

  return (
    <Window title="Configurações">
      <AppearanceSection />

      <Section title="Atalho">
        <Row label="Segurar para ditar" hint="Segure, fale e solte: o texto entra onde está o cursor.">
          <Segmented
            label="Tecla do atalho"
            value={key}
            onChange={setKey}
            options={[
              { value: "fn", label: "Fn 🌐" },
              { value: "rightOption", label: "⌥ direito" },
            ]}
          />
        </Row>
        <Row label="Duas batidas travam a gravação" hint="Para ditados longos, sem segurar a tecla.">
          <Switch label="Duas batidas travam a gravação" checked={toggle} onChange={setToggle} />
        </Row>
        <NotesShortcutRow />
      </Section>

      <Section title="Transcrição">
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

      <Section title="Privacidade">
        <Row label="Tudo roda neste Mac" hint="Áudio, transcrição e texto nunca saem daqui.">
          <Kbd>100% local</Kbd>
        </Row>
      </Section>
    </Window>
  );
}

