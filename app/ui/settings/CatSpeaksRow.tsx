// "O gato fala" (spec #26687, T26736), em Ajustes › Agente: o interruptor, desligado por padrão, e embaixo a voz do gato
// (o Qwen3-TTS, T26729). Ligar não baixa nada: a linha da voz mostra o tamanho e o botão, e só o clique baixa. Abrir os
// Ajustes só lê o disco (`catVoice.status`): nada baixa, nada fala.
//
// As vozes (spec #27531, T27778): o idioma primeiro, e só as vozes dele, cada uma com o código, a descrição, o "Usar"
// (guarda em `kiwicat.voz`) e o Ouvir (o texto fixo daquela voz, sem mudar a escolhida e sem o agente). Trocar de voz
// não baixa nada: o clique da voz já baixou todas.
import { useEffect, useState } from "react";

import { formatNumber, type Locale, type TextKey, translate } from "../../src/shared/i18n/index.ts";
import { CAT_VOICE_IDS, CAT_VOICE_LANGUAGES, CAT_VOICES, type CatVoiceId, type CatVoiceLanguage } from "../../src/shared/cat-voices.ts";
import type { AgentStatus, CatVoiceItem, CatVoiceStatus } from "../../src/shared/ui-contract.ts";
import { api, has } from "../src/api.ts";
import { useT } from "../src/i18n.ts";
import { Button, Row, Segmented, Switch } from "../src/kit/index.tsx";

/** "2 GB", "1,5 GB", "250 MB" (em inglês, "1.5 GB"). */
export function voiceSize(bytes: number, locale: Locale = "pt"): string {
  if (bytes >= 1e9) return `${formatNumber(locale, bytes / 1e9, { maximumFractionDigits: 1 })} GB`;
  return `${Math.max(1, Math.round(bytes / 1e6))} MB`;
}

export function catSpeaksHint(on: boolean, failed: boolean, locale: Locale = "pt"): string {
  if (failed) return translate(locale, "agent.saveFailed");
  return translate(locale, on ? "agent.voice.hint.on" : "agent.voice.hint.off");
}

/** O que a linha da voz diz e o botão dela. `null`: a linha não aparece. */
export function catVoiceLine(
  on: boolean,
  v: CatVoiceStatus,
  locale: Locale = "pt",
): { hint: string; action: "download" | "retry" | "cancel" | "remove" | "complete" | null } | null {
  const tr = (key: TextKey, params?: Record<string, string | number>) => translate(locale, key, params);
  const size = voiceSize(v.size, locale);
  const here = v.phase === "ready" || v.phase === "noVoice" || (v.phase === "error" && v.error === "warmup");
  // Desligado, a linha aparece com a voz no disco, para poder apagar, e enquanto ela baixa ou se prepara (revisão do
  // T26736): o download que segue em segundo plano fica à vista, com o Cancelar.
  const off = on ? "" : ` ${tr("agent.voice.catOff")}`;
  if (!on && v.phase !== "downloading" && v.phase !== "warming")
    return here ? { hint: tr("agent.voice.downloaded", { size }), action: "remove" } : null;
  switch (v.phase) {
    case "off":
      return { hint: tr("agent.voice.needs", { size }), action: "download" };
    case "downloading": {
      const pct = v.total ? Math.floor(((v.done ?? 0) / v.total) * 100) : 0;
      return { hint: `${tr("agent.voice.downloading", { pct, size })}${off || ` ${tr("agent.voice.untilDone")}`}`, action: "cancel" };
    }
    case "warming":
      return { hint: `${tr("agent.voice.warming")}${off}`, action: null };
    case "ready":
      return { hint: tr("agent.voice.ready"), action: "remove" };
    case "noVoice": {
      const missing = v.voices.filter((x) => x.state === "missing" || x.state === "error");
      if (missing.length === 0) return { hint: tr("agent.voice.noneReady"), action: "remove" };
      const falta = voiceSize(missing.reduce((n, x) => n + (x.size ?? 0), 0), locale);
      const quais = tr("agent.voice.missing", { n: missing.length });
      return { hint: tr("agent.voice.missingLine", { missing: quais, size: falta }), action: "complete" };
    }
    case "error":
      if (v.error === "hash") return { hint: tr("agent.voice.error.hash"), action: "retry" };
      if (v.error === "warmup") return { hint: tr("agent.voice.error.warmup"), action: "retry" };
      return { hint: tr("agent.voice.error.download"), action: "retry" };
  }
}

const ACTION_LABEL = {
  download: "agent.voice.action.download",
  retry: "agent.retry",
  cancel: "agent.cancel",
  remove: "agent.voice.action.remove",
  complete: "agent.voice.action.complete",
} as const satisfies Record<string, TextKey>;

/** O idioma da voz escolhida: o seletor abre nele. */
export const languageOf = (id: CatVoiceId): CatVoiceLanguage => CAT_VOICES[id].language;

export interface VoiceRowView {
  id: CatVoiceId;
  code: string;
  hint: string;
  chosen: boolean;
  /** O "Usar": só numa voz que existe (a "em breve" não se escolhe). */
  canChoose: boolean;
  /** O botão da prévia: ouvir, parar a que toca, baixar (sem o modelo ou a voz), ou nada ("em breve", baixando). */
  listen: "listen" | "stop" | "download" | null;
}

const ROW_STATE: Record<CatVoiceItem["state"], TextKey | null> = { ready: null, missing: "agent.voice.row.missing", error: null, soon: "agent.voice.row.soon" };
const descKey = (id: CatVoiceId) => `agent.voice.desc.${id}` as TextKey;

/** As vozes de um idioma, como a lista mostra. */
export function voiceRows(v: CatVoiceStatus, language: CatVoiceLanguage, locale: Locale = "pt"): VoiceRowView[] {
  const busy = v.phase === "downloading" || v.phase === "warming";
  return CAT_VOICE_IDS.filter((id) => CAT_VOICES[id].language === language).map((id) => {
    const item = v.voices.find((x) => x.id === id) ?? { id, state: "soon" as const };
    const meta = CAT_VOICES[id];
    const state = ROW_STATE[item.state];
    const extra =
      item.state === "error"
        ? translate(locale, item.error === "hash" ? "agent.voice.row.hash" : "agent.voice.row.error")
        : state
          ? translate(locale, state)
          : "";
    const description = translate(locale, descKey(id));
    const hint = extra ? `${description}. ${extra}` : description;
    const listen: VoiceRowView["listen"] =
      item.state === "soon" || busy ? null : v.preview === id ? "stop" : v.model && item.state === "ready" ? "listen" : "download";
    return { id, code: meta.code, hint, chosen: v.selected === id, canChoose: item.state !== "soon", listen };
  });
}

const LISTEN_LABEL = { listen: "agent.voice.listen", stop: "agent.voice.stop", download: "agent.voice.get" } as const satisfies Record<string, TextKey>;

/** Enquanto baixa ou prepara, o estado é lido de novo a cada segundo; parado, não. */
const moving = (v: CatVoiceStatus | null) => v?.phase === "downloading" || v?.phase === "warming";

export function CatSpeaksRow({ status, onStatus }: { status: AgentStatus; onStatus(s: AgentStatus): void }) {
  const { t, locale } = useT();
  const [failed, setFailed] = useState(false);
  const [voice, setVoice] = useState<CatVoiceStatus | null>(null);
  /** Muda depois de um clique: a leitura recomeça, para uma resposta de antes não desfazer o clique. */
  const [round, setRound] = useState(0);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!has("catVoice.status")) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const poll = () =>
      api.catVoice.status().then(
        (v) => {
          if (!alive) return;
          setVoice(v);
          if (moving(v)) timer = setTimeout(poll, 1000);
        },
        () => {
          if (alive) timer = setTimeout(poll, 5000);
        },
      );
    void poll();
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
  }, [round]);

  const on = status.catSpeaks === true;
  const change = (next: boolean) => {
    setFailed(false);
    onStatus({ ...status, catSpeaks: next });
    void api.agent.configure({ catSpeaks: next }).then(onStatus, () => {
      onStatus({ ...status, catSpeaks: !next });
      setFailed(true);
    });
  };
  const act = (action: keyof typeof ACTION_LABEL) => {
    setBusy(true);
    // O "Completar" é o mesmo clique: com o modelo no disco, só as vozes que faltam descem.
    const call = action === "cancel" ? api.catVoice.cancel() : action === "remove" ? api.catVoice.remove() : api.catVoice.download();
    void call
      .then(setVoice, () => {})
      .finally(() => {
        setBusy(false);
        setRound((r) => r + 1);
      });
  };
  const line = voice ? catVoiceLine(on, voice, locale) : null;
  const [language, setLanguage] = useState<CatVoiceLanguage | null>(null);
  const shownLanguage = language ?? (voice ? languageOf(voice.selected) : "english");
  const rows = on && voice && voice.voices.length > 0 ? voiceRows(voice, shownLanguage, locale) : null;
  const choose = (id: CatVoiceId) => {
    if (!voice) return;
    setVoice({ ...voice, selected: id });
    void api.settings.set({ kiwicat: { voz: id } }).finally(() => setRound((r) => r + 1));
  };
  const listen = (id: CatVoiceId, what: keyof typeof LISTEN_LABEL) => {
    if (what === "download") return act(voice?.model ? "complete" : "download");
    void api.catVoice.preview(what === "stop" ? null : id).then(setVoice, () => setRound((r) => r + 1));
  };
  // Enquanto uma prévia toca, o estado é lido de novo, para o "Parar" voltar a "Ouvir" quando ela acaba.
  useEffect(() => {
    if (!voice?.preview) return;
    const timer = setTimeout(() => setRound((r) => r + 1), 1000);
    return () => clearTimeout(timer);
  }, [voice?.preview, round]);

  return (
    <>
      <Row label={t("agent.voice.speaks")} hint={catSpeaksHint(on, failed, locale)}>
        <Switch label={t("agent.voice.speaks")} checked={on} onChange={change} />
      </Row>
      {line ? (
        <Row label={t("agent.voice.label")} hint={line.hint}>
          {line.action ? (
            <Button variant={line.action === "download" || line.action === "retry" ? "primary" : undefined} disabled={busy} onClick={() => act(line.action!)}>
              {t(ACTION_LABEL[line.action])}
            </Button>
          ) : null}
        </Row>
      ) : null}
      {rows ? (
        <>
          <Row label={t("agent.voice.language")} hint={t("agent.voice.language.hint")}>
            <Segmented
              label={t("agent.voice.language")}
              value={shownLanguage}
              options={CAT_VOICE_LANGUAGES.map((l) => ({ value: l, label: t(`agent.voice.lang.${l}`) }))}
              onChange={setLanguage}
            />
          </Row>
          {rows.map((r) => (
            <Row key={r.id} label={r.code} hint={r.hint}>
              <span className="kn-voice-actions" data-voice={r.id} style={{ display: "flex", gap: 8 }}>
                {r.listen ? (
                  <Button disabled={busy} onClick={() => listen(r.id, r.listen!)}>
                    {t(LISTEN_LABEL[r.listen])}
                  </Button>
                ) : null}
                {r.canChoose ? (
                  <Button variant={r.chosen ? "primary" : undefined} aria-pressed={r.chosen} disabled={r.chosen} onClick={() => choose(r.id)}>
                    {r.chosen ? t("agent.voice.chosen") : t("agent.voice.use")}
                  </Button>
                ) : null}
              </span>
            </Row>
          ))}
        </>
      ) : null}
    </>
  );
}
