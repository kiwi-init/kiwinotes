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
  /** Desliga: a prévia para, o player se cala e solta o agente e o helper. A saída é de quem a criou. */
  stop(): void;
}

export function ligarVozDoGato<P extends PreviaDaVoz>(o: VozDoGatoOpts<P>): VozDoGato<P> {
  let previa: P | undefined;
  const player = new FalaPlayer({
    sintese: o.sintese,
    saida: o.saida,
    ...(o.midia ? { midia: o.midia } : {}),
    antesDeFalar: () => previa?.parar(),
    evento: falaNaTela((e) => o.naTela(e)),
    ...(o.log ? { log: o.log } : {}),
  });
  const off = ligarFalaPlayer(player, {
    agent: o.agent,
    ...(o.helper ? { helper: o.helper } : {}),
    ...(o.log ? { log: o.log } : {}),
  });
  previa = o.previa?.(() => player.falaAtual);
  return {
    player,
    previa,
    stop: () => {
      previa?.parar();
      off();
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
