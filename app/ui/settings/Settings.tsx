// Configurações por assunto (spec #11966, T12115): à esquerda, a lista dos 8 assuntos; ao clicar num, o painel do centro
// mostra só as configurações dele. As seções são as de antes, só mudadas de lugar (`topics.ts` diz qual vai em qual).
// O app lembra o último assunto; um link de dentro do hub abre direto num assunto e rola até a linha. Abaixo de 720 px,
// a lista abre o assunto em tela cheia, com "‹ Voltar".
import "./topics.css";

import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";

import { About } from "../hub/About.tsx";
import { MeetingSettingsSection } from "../meetings/MeetingSettings.tsx";
import { NotesFolderRow } from "../notes/NotesFolder.tsx";
import "../notes/notes.css";
import type { SettingsRequest } from "../src/hubNav.ts";
import { Row, Section, Segmented, Switch, Window } from "../src/kit/index.tsx";
import { AgentSection } from "./Agent.tsx";
import { AgentActivitySection } from "./AgentActivity.tsx";
import { AgentMeetingsSection } from "./AgentMeetings.tsx";
import { PRIVACY_HINT, PRIVACY_RULE } from "./agentText.ts";
import { AppearanceSection } from "./Appearance.tsx";
import { CuesRow } from "./CuesRow.tsx";
import { DictionarySection } from "./Dictionary.tsx";
import { DoubtAnswersSection } from "./DoubtAnswers.tsx";
import { ExtensionsRow } from "./ExtensionsRow.tsx";
import { MicrophoneRow } from "./Microphone.tsx";
import { OcrRow } from "./OcrRow.tsx";
import { PreciseRow } from "./PreciseRow.tsx";
import { SemanticRow } from "./SemanticRow.tsx";
import { ShortcutsSection, SidebarKeysSection } from "./Shortcuts.tsx";
import { SnippetsSection } from "./Snippets.tsx";
import { TopicIcon } from "./topicIcons.tsx";
import { isSettingsTopic, NARROW_PX, readLastTopic, saveLastTopic, SETTINGS_TOPICS, type SettingsBlock, type SettingsTopic, stepTopic, TOPIC_BLOCKS, TOPIC_LABELS } from "./topics.ts";
import { UsageMeter } from "./UsageMeter.tsx";

/** A Transcrição de antes: o idioma e o "Guardar o áudio" ainda só guardam estado local. */
function TranscriptionSection() {
  const [lang, setLang] = useState<"auto" | "pt" | "en">("auto");
  const [keepAudio, setKeepAudio] = useState(false);
  return (
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
  );
}

/** Cada bloco de Ajustes, como era antes do spec. O `Record` obriga todo bloco de `topics.ts` a ter o seu. */
const BLOCKS: Record<SettingsBlock, () => ReactNode> = {
  appearance: () => <AppearanceSection />,
  // Todos os atalhos, configuráveis (T5349), cada grupo no assunto dele.
  "shortcuts:Ditado": () => <ShortcutsSection group="Ditado" />,
  transcription: () => <TranscriptionSection />,
  dictionary: () => <DictionarySection />,
  snippets: () => <SnippetsSection />,
  notes: () => (
    <Section title="Notas">
      <NotesFolderRow />
      <ExtensionsRow />
      <OcrRow />
      <SemanticRow />
    </Section>
  ),
  "shortcuts:Notas": () => <ShortcutsSection group="Notas" />,
  sidebarKeys: () => <SidebarKeysSection />,
  meetingSettings: () => <MeetingSettingsSection />,
  "shortcuts:Reuniões": () => <ShortcutsSection group="Reuniões" />,
  agentMeetings: () => <AgentMeetingsSection />,
  // O agente (spec #8373), o medidor (spec #11084) e o que a pessoa já respondeu na dúvida do guardrail (spec #9873).
  agent: () => <AgentSection />,
  usage: () => <UsageMeter />,
  doubtAnswers: () => <DoubtAnswersSection />,
  // A atividade do agente (spec #9480): também com o agente desligado (o desfazer não precisa dele).
  activity: () => <AgentActivitySection />,
  privacy: () => (
    <Section title="Privacidade">
      <Row label={PRIVACY_RULE} hint={PRIVACY_HINT} />
    </Section>
  ),
  // A antiga aba Sobre do topo (#11969).
  about: () => <About />,
};

/** O assunto ao abrir: `?topic=` (a CLI e o print), senão o último aberto. */
function initialTopic(): SettingsTopic {
  const q = new URLSearchParams(location.search).get("topic");
  if (isSettingsTopic(q)) return q;
  return readLastTopic(typeof localStorage === "undefined" ? null : localStorage);
}

const reducedMotion = () => document.documentElement.dataset.motion === "reduced" || matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Rola até a linha (ou a seção) com esse rótulo e a destaca um instante. A linha pode chegar depois (as que leem o app). */
function reveal(panel: HTMLElement, row: string): () => void {
  let tries = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const find = () => {
    const label = [...panel.querySelectorAll<HTMLElement>(".kn-row-label, .kn-section-title")].find((e) => e.textContent?.trim() === row);
    const target = label?.closest<HTMLElement>(".kn-row, .kn-section") ?? label;
    if (!target) {
      if (++tries < 30) timer = setTimeout(find, 100);
      return;
    }
    target.scrollIntoView({ block: "center", behavior: reducedMotion() ? "auto" : "smooth" });
    target.dataset.flash = "true";
    timer = setTimeout(() => delete target.dataset.flash, 1600);
  };
  find();
  return () => clearTimeout(timer);
}

export function Settings({ request = null }: { request?: SettingsRequest | null } = {}) {
  const [topic, setTopic] = useState<SettingsTopic>(() => request?.topic ?? initialTopic());
  /** Os assuntos já abertos ficam montados (só escondidos): a edição no Dicionário e nos Snippets não se perde. */
  const [visited, setVisited] = useState<Set<SettingsTopic>>(() => new Set([topic]));
  /** O assunto com o foco do teclado na lista (o único com `tabIndex` 0). */
  const [focusTopic, setFocusTopic] = useState<SettingsTopic>(topic);
  const [narrow, setNarrow] = useState(false);
  /** Na janela estreita: o assunto está aberto em tela cheia (senão, a lista). */
  const [narrowOpen, setNarrowOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLElement>(null);
  const panels = useRef<Partial<Record<SettingsTopic, HTMLDivElement | null>>>({});

  const open = (t: SettingsTopic) => {
    setTopic(t);
    setFocusTopic(t);
    setVisited((v) => (v.has(t) ? v : new Set(v).add(t)));
    setNarrowOpen(true);
    saveLastTopic(typeof localStorage === "undefined" ? null : localStorage, t);
  };

  // A largura de Ajustes (não a da tela): abaixo de 720 px, a lista e o assunto se revezam.
  useLayoutEffect(() => {
    const el = root.current;
    if (!el) return;
    const measure = () => setNarrow(el.getBoundingClientRect().width < NARROW_PX);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Um link de dentro do hub: abre o assunto e rola até a linha.
  useEffect(() => {
    if (!request) return;
    open(request.topic);
    if (!request.row) return;
    let stop: (() => void) | undefined;
    const frame = requestAnimationFrame(() => {
      const panel = panels.current[request.topic];
      if (panel) stop = reveal(panel, request.row!);
    });
    return () => {
      cancelAnimationFrame(frame);
      stop?.();
    };
    // Só um pedido novo (o `n`) abre de novo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request?.n]);

  // ↑ e ↓ andam pela lista; Enter (o botão) abre; Tab sai da lista para o painel.
  const onListKey = (e: React.KeyboardEvent) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const next = stepTopic(focusTopic, e.key === "ArrowDown" ? 1 : -1);
    setFocusTopic(next);
    list.current?.querySelector<HTMLElement>(`[data-topic="${next}"]`)?.focus();
  };

  const showList = !narrow || !narrowOpen;
  const showPanel = !narrow || narrowOpen;

  return (
    <Window title="Configurações">
      <div className="kn-prefs" ref={root} data-narrow={narrow || undefined}>
        {showList ? (
          <nav className="kn-prefs-side" aria-label="Assuntos de Ajustes" ref={list} onKeyDown={onListKey}>
            {SETTINGS_TOPICS.map((t) => (
              <button
                type="button"
                key={t}
                data-topic={t}
                className="kn-prefs-item"
                aria-current={t === topic && !narrow ? "page" : undefined}
                tabIndex={t === focusTopic ? 0 : -1}
                onFocus={() => setFocusTopic(t)}
                onClick={() => open(t)}
              >
                <TopicIcon topic={t} />
                <span>{TOPIC_LABELS[t]}</span>
                {narrow ? <span className="kn-prefs-chevron" aria-hidden="true">›</span> : null}
              </button>
            ))}
          </nav>
        ) : null}
        {showPanel ? (
          <div className="kn-prefs-panel">
            {SETTINGS_TOPICS.filter((t) => visited.has(t)).map((t) => (
              <div
                key={t}
                className="kn-prefs-topic"
                role="region"
                aria-label={TOPIC_LABELS[t]}
                data-topic={t}
                data-single={TOPIC_BLOCKS[t].length === 1 || undefined}
                hidden={t !== topic}
                ref={(el) => {
                  panels.current[t] = el;
                }}
              >
                {narrow ? (
                  <button
                    type="button"
                    className="kn-prefs-back"
                    onClick={() => {
                      setNarrowOpen(false);
                      requestAnimationFrame(() => list.current?.querySelector<HTMLElement>(`[data-topic="${t}"]`)?.focus());
                    }}
                  >
                    ‹ Voltar
                  </button>
                ) : null}
                <h1 className="kn-prefs-title">{TOPIC_LABELS[t]}</h1>
                {TOPIC_BLOCKS[t].map((b) => (
                  <div key={b} className="kn-prefs-block" data-block={b}>
                    {BLOCKS[b]()}
                  </div>
                ))}
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </Window>
  );
}
