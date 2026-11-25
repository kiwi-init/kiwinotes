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
