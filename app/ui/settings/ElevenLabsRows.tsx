// A voz do Kiwi pelo ElevenLabs (spec #31616, T31628), em Ajustes › Agente, embaixo do "O Kiwi fala": a chave da API (vai
// ao Keychain pelo main e nunca volta; a UI só sabe `hasKey`), o modelo, o ID da voz (harry #31625: a pessoa cola o ID),
// o "Testar", o aviso de privacidade e a linha discreta de quando o Kiwi caiu na voz local.
//
// Abrir os Ajustes só lê o estado (`elevenLabs.status`): nada vai à rede. Só o "Testar" fala com o ElevenLabs.
import { type FormEvent, useEffect, useState } from "react";

import {
  DEFAULT_ELEVENLABS_MODEL,
  DEFAULT_ELEVENLABS_VOICE,
  ELEVENLABS_MODELS,
  type ElevenLabsModel,
  type ElevenLabsReason,
  isElevenLabsKeyShape,
  isElevenLabsVoiceId,
} from "../../src/shared/elevenlabs.ts";
import { formatTime, type Locale, type TextKey, translate } from "../../src/shared/i18n/index.ts";
import type { ElevenLabsStatus, ElevenLabsTestResult } from "../../src/shared/ui-contract.ts";
import { api, has } from "../src/api.ts";
import { useT } from "../src/i18n.ts";
import { Button, Row, Select } from "../src/kit/index.tsx";

const MODEL_NAME: Record<ElevenLabsModel, string> = {
  eleven_v4_turbo: "v4 Turbo",
  eleven_v4: "v4",
  eleven_v3: "v3",
  eleven_multilingual_v2: "Multilingual v2",
  eleven_flash_v2_5: "Flash v2.5",
};

/** O nome do modelo no seletor; o padrão leva "(padrão)". */
export function modelLabel(m: ElevenLabsModel, locale: Locale = "pt"): string {
  return m === DEFAULT_ELEVENLABS_MODEL ? translate(locale, "agent.voice.el.model.default", { name: MODEL_NAME[m] }) : MODEL_NAME[m];
}

export const reasonText = (r: ElevenLabsReason, locale: Locale = "pt") => translate(locale, `agent.voice.el.reason.${r}` as TextKey);

export type KeyProblem = "invalid" | "failed" | null;

/** O que a linha da chave diz. */
export function keyHint(hasKey: boolean, problem: KeyProblem, locale: Locale = "pt"): string {
  if (problem === "invalid") return translate(locale, "agent.voice.el.key.invalid");
  if (problem === "failed") return translate(locale, "agent.voice.el.key.failed");
  return translate(locale, hasKey ? "agent.voice.el.key.saved" : "agent.voice.el.key.none");
}

export type TestState = { phase: "idle" } | { phase: "running" } | { phase: "done"; result: ElevenLabsTestResult };

/** O que a linha do "Testar" diz. */
export function testHint(s: TestState, locale: Locale = "pt"): string {
  if (s.phase === "running") return translate(locale, "agent.voice.el.test.running");
  if (s.phase === "done")
    return s.result.ok ? translate(locale, "agent.voice.el.test.ok") : translate(locale, "agent.voice.el.test.failed", { reason: reasonText(s.result.reason, locale) });
  return translate(locale, "agent.voice.el.test.hint");
}

/** A linha discreta da última queda para a voz local, ou `null` (não caiu). */
export function fallbackHint(fb: ElevenLabsStatus["lastFallback"], locale: Locale = "pt"): string | null {
  if (!fb) return null;
  const at = new Date(fb.at);
  if (Number.isNaN(at.getTime())) return null;
  return translate(locale, "agent.voice.el.fallback.hint", { time: formatTime(locale, at), reason: reasonText(fb.reason, locale) });
}

export function ElevenLabsRows({ voiceId, model }: { voiceId: string; model: ElevenLabsModel }) {
  const { t, locale } = useT();
  const [status, setStatus] = useState<ElevenLabsStatus | null>(null);
  const [draftKey, setDraftKey] = useState("");
  const [keyProblem, setKeyProblem] = useState<KeyProblem>(null);
  const [draftVoice, setDraftVoice] = useState(voiceId);
  const [test, setTest] = useState<TestState>({ phase: "idle" });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!has("elevenLabs.status")) return;
    let alive = true;
    void api.elevenLabs.status().then((s) => alive && setStatus(s), () => {});
    return () => {
      alive = false;
    };
  }, []);
  // A voz mudou em outra janela: o campo segue, se a pessoa não está editando outra.
  useEffect(() => setDraftVoice(voiceId), [voiceId]);

  const hasKey = status?.hasKey === true;
  const saveKey = (e: FormEvent) => {
    e.preventDefault();
    const k = draftKey.trim();
    if (!isElevenLabsKeyShape(k)) return setKeyProblem("invalid");
    setBusy(true);
    void api.elevenLabs
      .setKey(k)
      .then(
        (s) => {
          setStatus(s);
          setKeyProblem(null);
          setTest({ phase: "idle" });
        },
        () => setKeyProblem("failed"),
      )
      // O campo se esvazia de todo jeito: a chave não fica na tela.
      .finally(() => {
        setDraftKey("");
        setBusy(false);
      });
  };
  const removeKey = () => {
    setBusy(true);
    void api.elevenLabs
      .deleteKey()
      .then((s) => {
        setStatus(s);
        setTest({ phase: "idle" });
      }, () => setKeyProblem("failed"))
      .finally(() => setBusy(false));
  };
  const voiceValid = isElevenLabsVoiceId(draftVoice.trim());
  const saveVoice = (id: string) => {
    const v = id.trim();
    if (!isElevenLabsVoiceId(v) || v === voiceId) return;
    setTest({ phase: "idle" });
    void api.settings.set({ elevenLabsVoiceId: v });
  };
  const chooseModel = (m: ElevenLabsModel) => {
    setTest({ phase: "idle" });
    void api.settings.set({ elevenLabsModel: m });
  };
  const runTest = () => {
    setTest({ phase: "running" });
    void api.elevenLabs.test().then(
      (result) => setTest({ phase: "done", result }),
      () => setTest({ phase: "done", result: { ok: false, reason: "unknown" } }),
    );
  };
  const fallback = fallbackHint(status?.lastFallback ?? null, locale);

  return (
    <>
      <Row label={t("agent.voice.el.key")} hint={keyHint(hasKey, keyProblem, locale)}>
        {hasKey ? (
          <Button disabled={busy} onClick={removeKey}>
            {t("agent.voice.el.key.remove")}
          </Button>
        ) : (
          <form className="kn-el-key" onSubmit={saveKey} style={{ display: "flex", gap: 8 }}>
            <input
              className="kn-input"
              type="password"
              autoComplete="off"
              spellCheck={false}
              aria-label={t("agent.voice.el.key")}
              placeholder={t("agent.voice.el.key.placeholder")}
              value={draftKey}
              maxLength={256}
              disabled={busy}
              onChange={(e) => {
                setDraftKey(e.target.value);
                setKeyProblem(null);
              }}
            />
            <Button variant="primary" type="submit" disabled={busy || !draftKey.trim()}>
              {t("agent.voice.el.key.save")}
            </Button>
          </form>
        )}
      </Row>
      <Row label={t("agent.voice.el.model")} hint={t("agent.voice.el.model.hint")}>
        <Select label={t("agent.voice.el.model")} value={model} options={ELEVENLABS_MODELS.map((m) => ({ value: m, label: modelLabel(m, locale) }))} onChange={chooseModel} />
      </Row>
      <Row label={t("agent.voice.el.voice")} hint={voiceValid ? t("agent.voice.el.voice.hint") : t("agent.voice.el.voice.invalid")}>
        <span className="kn-el-voice" style={{ display: "flex", gap: 8 }}>
          <input
            className="kn-input"
            spellCheck={false}
            autoComplete="off"
            aria-label={t("agent.voice.el.voice")}
            aria-invalid={!voiceValid}
            value={draftVoice}
            maxLength={64}
            onChange={(e) => setDraftVoice(e.target.value)}
            onBlur={() => saveVoice(draftVoice)}
            onKeyDown={(e) => {
              if (e.key === "Enter") saveVoice(draftVoice);
            }}
          />
          {voiceId !== DEFAULT_ELEVENLABS_VOICE ? (
            <Button
              onClick={() => {
                setDraftVoice(DEFAULT_ELEVENLABS_VOICE);
                saveVoice(DEFAULT_ELEVENLABS_VOICE);
              }}
            >
              {t("agent.voice.el.voice.reset")}
            </Button>
          ) : null}
        </span>
      </Row>
      <Row label={t("agent.voice.el.test.label")} hint={testHint(test, locale)}>
        <Button disabled={!hasKey || test.phase === "running"} onClick={runTest}>
          {t("agent.voice.el.test")}
        </Button>
      </Row>
      <Row label={t("agent.voice.el.privacy")} hint={t("agent.voice.el.privacy.hint")} />
      {fallback ? <Row label={t("agent.voice.el.fallback")} hint={fallback} /> : null}
    </>
  );
}
