// A voz do gato ligada ao app (T28675): o player da fala, a prévia dos Ajustes e a boca do gato, numa função só que o
// app (`startCatVoiceOutput`, windows.ts), o headless e os testes chamam. Assim, a ligação que os testes provam é a
// mesma que roda no app.
// - **A saída é uma só** (T27825, #28376): a fala do gato para a prévia antes do 1º pedaço (`antesDeFalar`), e a
//   prévia espera a fala do gato acabar (`falaDoGato`).
// - **A boca:** os eventos do player passam pelo `falaNaTela` (T26829): o nível enquanto a voz toca e `null` no fim,
//   no corte ou no erro. Quem recebe manda às janelas (`agent.speech`) e ao gato do overlay.
import {
  FalaPlayer,
  falaNaTela,
  ligarFalaPlayer,
  type FalaNaTela,
  type FalaPlayerWiring,
  type MidiaFala,
  type SaidaFala,
  type SinteseFala,
} from "../agent/fala-player.ts";
import { midiaHelper, type MidiaHelper, saidaHelper, type SpeechHelper } from "./speech-output.ts";

/** O mínimo que a ligação usa da prévia: o `parar`. */
export interface PreviaDaVoz {
  parar(): void;
}

export interface VozDoGatoOpts<P extends PreviaDaVoz> extends FalaPlayerWiring {
  sintese: SinteseFala;
  saida: SaidaFala;
  midia?: MidiaFala;
  /** A boca do gato: o nível da voz e o `null` do fim, de cada fala que chegou a tocar. */
  naTela(e: FalaNaTela): void;
  /**
   * A prévia dos Ajustes, na mesma saída, com a fala do gato em andamento para ela esperar. Sem ela (o headless), só
   * o player.
   */
  previa?(falaDoGato: () => Promise<unknown> | undefined): P;
}

export interface VozDoGato<P extends PreviaDaVoz> {
  player: FalaPlayer;
  previa: P | undefined;
  /**
   * Fala um texto uma vez numa síntese dada, na mesma saída: o "Testar" do ElevenLabs nos Ajustes (spec #31616). Cala o
   * gato e a prévia antes, e para se o gato voltar a falar. Rejeita com o erro da síntese (o `ElevenLabsError`, com o
   * motivo), sem cair para a voz local: o teste é da voz escolhida.
   */
  falarUmaVez(sintese: SinteseFala, texto: string): Promise<void>;
  /** Desliga: a prévia para, o player se cala e solta o agente e o helper. A saída é de quem a criou. */
  stop(): void;
}

export function ligarVozDoGato<P extends PreviaDaVoz>(o: VozDoGatoOpts<P>): VozDoGato<P> {
  let previa: P | undefined;
  let umaVez: AbortController | undefined;
  const pararUmaVez = () => {
    if (!umaVez) return;
    umaVez.abort();
    umaVez = undefined;
    o.saida.limpar();
  };
  const player = new FalaPlayer({
    sintese: o.sintese,
    saida: o.saida,
    ...(o.midia ? { midia: o.midia } : {}),
    antesDeFalar: () => {
      pararUmaVez();
      previa?.parar();
    },
    evento: falaNaTela((e) => o.naTela(e)),
    ...(o.log ? { log: o.log } : {}),
  });
  // O aviso falado (o Calendário, o "Testar") também cala quando o mic abre: senão cai na transcrição do pedido.
  const offUmaVez = [o.helper?.on("agent.record.started", pararUmaVez), o.helper?.on("meeting.started", pararUmaVez)];
  const off = ligarFalaPlayer(player, {
    agent: o.agent,
    ...(o.helper ? { helper: o.helper } : {}),
    ...(o.log ? { log: o.log } : {}),
  });
  previa = o.previa?.(() => player.falaAtual);
  return {
    player,
    previa,
    async falarUmaVez(sintese, texto) {
      player.cancelar();
      previa?.parar();
      pararUmaVez();
      const ac = (umaVez = new AbortController());
      // Mesmo quando a síntese lança (o motivo do ElevenLabs), o teste não fica guardado: senão a próxima fala do gato
      // limparia a saída à toa.
      try {
        for await (const pcm of sintese.sintetizar(texto, ac.signal)) {
          if (ac.signal.aborted) return;
          await o.saida.tocar(pcm, () => {});
        }
        if (!ac.signal.aborted) await o.saida.drenar?.();
      } finally {
        if (umaVez === ac) umaVez = undefined;
      }
    },
    stop: () => {
      pararUmaVez();
      previa?.parar();
      off();
      for (const f of offUmaVez) f?.();
    },
  };
}

/**
 * A ligação inteira do app (T29234): a saída pelo helper, a mídia dos outros apps (T26830) e a boca nas janelas e no
 * overlay (T28675). O `startCatVoiceOutput` (windows.ts) só passa o que é dele: o sidecar, as janelas abertas e o gato
 * do overlay. Assim os testes provam cada parte da ligação que roda no app.
 */
export interface VozDoGatoNoAppOpts<P extends PreviaDaVoz> {
  sintese: SinteseFala;
  agent: FalaPlayerWiring["agent"];
  helper: {
    /** A saída da voz (`speech.play`, `speech.stop`). */
    saida: SpeechHelper;
    /** A mídia dos outros apps (`speech.duck`, `speech.unduck`). */
    midia: MidiaHelper;
    /** O atalho, o gato fechado e a reunião, que cortam a fala. */
    eventos: NonNullable<FalaPlayerWiring["helper"]>;
  };
  /** As janelas abertas agora: cada uma recebe o `agent.speech`. */
  janelas(): Iterable<{ send: { event(e: { name: "agent.speech"; payload: FalaNaTela }): void } }>;
  /** O gato do overlay, se já subiu. Lido a cada evento: um overlay que sobe depois também recebe. */
  overlay(): { speech(e: FalaNaTela): void } | undefined;
  previa?(saida: SaidaFala, falaDoGato: () => Promise<unknown> | undefined): P;
  log?(m: string): void;
}

export function ligarVozDoGatoNoApp<P extends PreviaDaVoz>(o: VozDoGatoNoAppOpts<P>): VozDoGato<P> {
  const log = o.log;
  const saida = saidaHelper(o.helper.saida, log ? { log } : {});
  const previa = o.previa;
  const voz = ligarVozDoGato<P>({
    sintese: o.sintese,
    saida,
    // T26830 (#28538): enquanto o gato fala, os outros apps descem à metade e a voz dele sobe ×2 no helper.
    midia: midiaHelper(o.helper.midia, log),
    agent: o.agent,
    helper: o.helper.eventos,
    naTela: (e) => {
      for (const janela of o.janelas()) janela.send.event({ name: "agent.speech", payload: e });
      o.overlay()?.speech(e);
    },
    ...(previa ? { previa: (falaDoGato: () => Promise<unknown> | undefined) => previa(saida, falaDoGato) } : {}),
    ...(log ? { log } : {}),
  });
  return {
    ...voz,
    stop: () => {
      voz.stop();
      saida.dispose();
    },
  };
}
