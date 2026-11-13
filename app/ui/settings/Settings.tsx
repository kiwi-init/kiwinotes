// Configurações. Por enquanto só a casca: os controles guardam estado local e
// ganham efeito quando o sidecar (T50) e o ditado entrarem.
import { useState } from "react";

import { Row, Section, Segmented, Switch, Window } from "../src/kit/index.tsx";
import { AgentSection } from "./Agent.tsx";
import { AgentActivitySection } from "./AgentActivity.tsx";
import { DoubtAnswersSection } from "./DoubtAnswers.tsx";
import { UsageMeter } from "./UsageMeter.tsx";
import { PRIVACY_HINT, PRIVACY_RULE } from "./agentText.ts";
import { AppearanceSection } from "./Appearance.tsx";
import { DictionarySection } from "./Dictionary.tsx";
import { ExtensionsRow } from "./ExtensionsRow.tsx";
import { MicrophoneRow } from "./Microphone.tsx";
import { NotesFolderRow } from "../notes/NotesFolder.tsx";
import "../notes/notes.css";
import { OcrRow } from "./OcrRow.tsx";
import { SemanticRow } from "./SemanticRow.tsx";
import { CuesRow } from "./CuesRow.tsx";
import { PreciseRow } from "./PreciseRow.tsx";
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
        <PreciseRow />
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
        <SemanticRow />
      </Section>

      {/* O agente (spec #8373): a seção antes da Privacidade, que diz a regra dele (ADR 0011). */}
      <AgentSection />
      {/* O medidor do agente (spec #11084): o gasto que o agente informa, e o `/usage` só ao abrir ou em Atualizar. */}
      <UsageMeter />
      {/* A atividade do agente (spec #9480): logo abaixo, e também com o agente desligado (o desfazer não precisa dele). */}
      <AgentActivitySection />
      {/* O que a pessoa já respondeu na dúvida do guardrail (spec #9873). */}
      <DoubtAnswersSection />

      <Section title="Privacidade">
        <Row label={PRIVACY_RULE} hint={PRIVACY_HINT} />
      </Section>
    </Window>
  );
}

