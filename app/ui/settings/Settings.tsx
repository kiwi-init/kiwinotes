// Configurações por assunto (spec #11966, T12115): à esquerda, a lista dos 9 assuntos; ao clicar num, o painel do centro
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
import { AppearanceSection } from "./Appearance.tsx";
import { CuesRow } from "./CuesRow.tsx";
import { LanguageSection } from "./LanguageSection.tsx";
import { t as translateNow, useT } from "../src/i18n.ts";
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
import { TrailsSection } from "./Trails.tsx";
import { isSettingsTopic, NARROW_PX, readLastTopic, saveLastTopic, SHOWN_TOPICS, type SettingsBlock, type SettingsTopic, stepTopic, TOPIC_BLOCKS, TOPIC_LABEL_KEYS } from "./topics.ts";
import { UsageMeter } from "./UsageMeter.tsx";

/** A Transcrição de antes: o idioma e o "Guardar o áudio" ainda só guardam estado local. */
function TranscriptionSection() {
  const { t } = useT();
  const [lang, setLang] = useState<"auto" | "pt" | "en">("auto");
  const [keepAudio, setKeepAudio] = useState(false);
  return (
    <Section title={t("transcription.section")}>
      <MicrophoneRow />
      <CuesRow />
      <PreciseRow />
      <Row label={t("transcription.language")} hint={t("transcription.language.hint")}>
        <Segmented
          label={t("transcription.language")}
          value={lang}
          onChange={setLang}
          options={[
            { value: "auto", label: t("transcription.language.auto") },
            { value: "pt", label: t("transcription.language.pt") },
            { value: "en", label: t("transcription.language.en") },
          ]}
        />
      </Row>
      <Row label={t("transcription.keepAudio")} hint={t("transcription.keepAudio.hint")}>
        <Switch label={t("transcription.keepAudio")} checked={keepAudio} onChange={setKeepAudio} />
      </Row>
    </Section>
  );
}

/**
 * Cada bloco de Ajustes, como era antes do spec. O `Record` obriga todo bloco de `topics.ts` a ter o seu. Eles rodam no
 * render de `Settings`, que redesenha pelo `useT()` quando a língua muda: o `translateNow()` daqui já lê a nova.
 */
const BLOCKS: Record<SettingsBlock, () => ReactNode> = {
  // O idioma do app (T28190, spec #28171).
  language: () => <LanguageSection />,
  appearance: () => <AppearanceSection />,
  // Todos os atalhos, configuráveis (T5349), cada grupo no assunto dele.
  "shortcuts:Ditado": () => <ShortcutsSection group="Ditado" />,
  transcription: () => <TranscriptionSection />,
  dictionary: () => <DictionarySection />,
  snippets: () => <SnippetsSection />,
  notes: () => (
    <Section title={translateNow("notesSettings.section")}>
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
  // As trilhas da Bússola (T14682): visíveis e apagáveis, uma a uma.
  trails: () => <TrailsSection />,
  doubtAnswers: () => <DoubtAnswersSection />,
  // A atividade do agente (spec #9480): também com o agente desligado (o desfazer não precisa dele).
  activity: () => <AgentActivitySection />,
  privacy: () => (
    <Section title={translateNow("privacy.section")}>
      <Row label={translateNow("privacy.rule")} hint={translateNow("privacy.hint")} />
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
  const { t: tr } = useT();
  const label = (t: SettingsTopic) => tr(TOPIC_LABEL_KEYS[t]);
  // Um pedido para um assunto escondido (o Geral, T29319) abre o de sempre.
  const [topic, setTopic] = useState<SettingsTopic>(() => (request && isSettingsTopic(request.topic) ? request.topic : initialTopic()));
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
  const pendingRow = useRef<{ topic: SettingsTopic; row: string } | null>(null);
  const stopReveal = useRef<(() => void) | null>(null);
  useEffect(() => {
    if (!request || !isSettingsTopic(request.topic)) return;
    open(request.topic);
    stopReveal.current?.();
    stopReveal.current = null;
    pendingRow.current = request.row ? { topic: request.topic, row: request.row } : null;
    // Só um pedido novo (o `n`) abre de novo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request?.n]);
  // A rolagem espera o render em que o assunto já está montado e à vista (T17183). Antes ela ia um frame depois do
  // `open`, e com o React atrasado achava o painel ainda sem montar (sem rolar nem destacar) ou ainda escondido (o
  // scrollIntoView não faz nada, e a linha destacada ficava fora da vista).
  useEffect(() => {
    const want = pendingRow.current;
    if (!want || want.topic !== topic) return;
    const panel = panels.current[want.topic];
    if (!panel || panel.hidden) return;
    pendingRow.current = null;
    stopReveal.current = reveal(panel, want.row);
  });
  useEffect(() => () => stopReveal.current?.(), []);

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
    <Window title={tr("settings.window.title")}>
      <div className="kn-prefs" ref={root} data-narrow={narrow || undefined}>
        {showList ? (
          <nav className="kn-prefs-side" aria-label={tr("settings.topics.aria")} ref={list} onKeyDown={onListKey}>
            {SHOWN_TOPICS.map((t) => (
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
                <span>{label(t)}</span>
                {narrow ? <span className="kn-prefs-chevron" aria-hidden="true">›</span> : null}
              </button>
            ))}
          </nav>
        ) : null}
        {showPanel ? (
          <div className="kn-prefs-panel">
            {SHOWN_TOPICS.filter((t) => visited.has(t)).map((t) => (
              <div
                key={t}
                className="kn-prefs-topic"
                role="region"
                aria-label={label(t)}
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
                    {tr("settings.back")}
                  </button>
                ) : null}
                <h1 className="kn-prefs-title">{label(t)}</h1>
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
