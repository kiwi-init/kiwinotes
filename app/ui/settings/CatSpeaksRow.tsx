// "O gato fala" (spec #26687, T26736), em Ajustes › Agente: o interruptor, desligado por padrão, e embaixo a voz do gato
// (o Qwen3-TTS, T26729). Ligar não baixa nada: a linha da voz mostra o tamanho e o botão, e só o clique baixa. Abrir os
// Ajustes só lê o disco (`catVoice.status`): nada baixa, nada fala.
import { useEffect, useState } from "react";

import type { AgentStatus, CatVoiceStatus } from "../../src/shared/ui-contract.ts";
import { api, has } from "../src/api.ts";
import { Button, Row, Switch } from "../src/kit/index.tsx";

export const CAT_SPEAKS_LABEL = "O gato fala";
export const CAT_VOICE_LABEL = "A voz do gato";

/** "2 GB", "1,5 GB", "250 MB". */
export function voiceSize(bytes: number): string {
  if (bytes >= 1e9) return `${(bytes / 1e9).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} GB`;
  return `${Math.max(1, Math.round(bytes / 1e6))} MB`;
}

export function catSpeaksHint(on: boolean, failed: boolean): string {
  if (failed) return "Não deu para salvar. Tente de novo.";
  return on
    ? "Quando você pede por voz, o Kiwi Cat responde em voz alta, em 1 ou 2 frases. A voz roda neste Mac: nada sai dele."
    : "Quando você pede por voz, o Kiwi Cat responde em voz alta. A voz roda neste Mac: nada sai dele.";
}

/** O que a linha da voz diz e o botão dela. `null`: a linha não aparece. */
export function catVoiceLine(on: boolean, v: CatVoiceStatus): { hint: string; action: "download" | "retry" | "cancel" | "remove" | null } | null {
  const size = voiceSize(v.size);
  const here = v.phase === "ready" || v.phase === "noVoice" || (v.phase === "error" && v.error === "warmup");
  // Desligado, a linha aparece com a voz no disco, para poder apagar, e enquanto ela baixa ou se prepara (revisão do
  // T26736): o download que segue em segundo plano fica à vista, com o Cancelar.
  const off = on ? "" : " O gato está desligado: ele não fala até você ligar.";
  if (!on && v.phase !== "downloading" && v.phase !== "warming")
    return here ? { hint: `Baixada (${size}). Desligado, o gato não fala.`, action: "remove" } : null;
  switch (v.phase) {
    case "off":
      return { hint: `Para falar, o gato precisa do modelo de voz (${size}), baixado uma vez, só com o seu clique.`, action: "download" };
    case "downloading": {
      const pct = v.total ? Math.floor(((v.done ?? 0) / v.total) * 100) : 0;
      return { hint: `Baixando a voz: ${pct}% de ${size}.${off || " Até terminar, o gato responde por escrito."}`, action: "cancel" };
    }
    case "warming":
      return { hint: `Preparando a voz neste Mac… Na primeira vez, leva uns 20 segundos.${off}`, action: null };
    case "ready":
      return { hint: "Pronta. A voz roda neste Mac: o texto e o áudio não saem daqui.", action: "remove" };
    case "noVoice":
      return { hint: "O modelo já está aqui, mas a voz do gato ainda está sendo escolhida. Até lá, ele responde por escrito.", action: "remove" };
    case "error":
      if (v.error === "hash") return { hint: "Um arquivo veio diferente do esperado e foi apagado. Tente de novo.", action: "retry" };
      if (v.error === "warmup") return { hint: "A voz baixou, mas não deu para prepará-la neste Mac. Tente de novo.", action: "retry" };
      return { hint: "Não deu para baixar a voz agora. Tente de novo.", action: "retry" };
  }
}

const ACTION_LABEL = { download: "Baixar a voz", retry: "Tentar de novo", cancel: "Cancelar", remove: "Remover a voz" } as const;

/** Enquanto baixa ou prepara, o estado é lido de novo a cada segundo; parado, não. */
const moving = (v: CatVoiceStatus | null) => v?.phase === "downloading" || v?.phase === "warming";

export function CatSpeaksRow({ status, onStatus }: { status: AgentStatus; onStatus(s: AgentStatus): void }) {
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
    const call = action === "cancel" ? api.catVoice.cancel() : action === "remove" ? api.catVoice.remove() : api.catVoice.download();
    void call
      .then(setVoice, () => {})
      .finally(() => {
        setBusy(false);
        setRound((r) => r + 1);
      });
  };
  const line = voice ? catVoiceLine(on, voice) : null;

  return (
    <>
      <Row label={CAT_SPEAKS_LABEL} hint={catSpeaksHint(on, failed)}>
        <Switch label={CAT_SPEAKS_LABEL} checked={on} onChange={change} />
      </Row>
      {line ? (
        <Row label={CAT_VOICE_LABEL} hint={line.hint}>
          {line.action ? (
            <Button variant={line.action === "download" || line.action === "retry" ? "primary" : undefined} disabled={busy} onClick={() => act(line.action!)}>
              {ACTION_LABEL[line.action]}
            </Button>
          ) : null}
        </Row>
      ) : null}
    </>
  );
}
