// A intro da abertura do zero (spec #2078, T2308): a janela `intro` toca a animação e avisa no fim (`intro.done`),
// que vem do último frame, do clique para pular ou do "Reduzir movimento". O hub (`HubDeps.intro`) espera isso para
// aparecer. Sem Electrobun aqui: o index.ts liga as peças, e os testes usam peças falsas.
//
// O fim vira o hub (T16769, spec #16759): enquanto o gato toca, o hub abre escondido no lugar dele, e a moldura cresce
// até esse retângulo. No fim, o hub aparece por cima da intro, já pintado, e só depois a intro fecha, atrás dele: a
// troca não tem um quadro vazio no meio.

export interface IntroDeps {
  /** Abre a janela da intro. Nunca rejeita (o `showWindow`). */
  show(): Promise<void>;
  /** Fecha a janela da intro, se ela ainda estiver aberta. */
  close(): void;
  /** Chama `fn` quando a página da intro avisa que terminou (`intro.done`); devolve como parar. */
  onDone(fn: () => void): () => void;
  /** Chama `fn` quando a janela da intro fecha por outro caminho; devolve como parar. */
  onClosed(fn: () => void): () => void;
  /** Quanto esperar, no máximo, antes de seguir para o hub. */
  timeoutMs?: number;
  /** Abre o hub escondido, no lugar em que ele vai aparecer; diz se ele ficou pronto. Nunca rejeita. */
  prepare?(): Promise<boolean>;
  /** Mostra o hub escondido, por cima da intro; diz se mostrou. Nunca rejeita. */
  reveal?(): Promise<boolean>;
  /** Quanto o hub fica por cima da intro antes de ela fechar (o tempo de ele pintar na tela). */
  settleMs?: number;
}

/** O hub já está na tela, por cima: a intro fecha depois disso, sem deixar um quadro vazio. */
export const INTRO_SETTLE_MS = 150;
/** No fim da intro, quanto ainda se espera o hub escondido ficar pronto; depois disso ele abre do jeito de antes. */
export const PREPARE_GRACE_MS = 3_000;

/**
 * A intro inteira leva 5,35 s (as 6 fases do KiwiCat, T14851). Com folga para a carga da janela, 20 s: se a página
 * travar ou nunca avisar, o hub abre igual. A intro é enfeite e nunca segura o app.
 */
export const INTRO_TIMEOUT_MS = 20_000;

/**
 * A `HubDeps.intro`: prepara o hub escondido, abre a janela, espera o fim (ou o tempo máximo, ou a janela fechar),
 * mostra o hub por cima e fecha a janela. Devolve se o hub já apareceu (senão, quem chamou o abre).
 */
export function makeIntro(deps: IntroDeps): () => Promise<boolean> {
  return async () => {
    let finish = () => {};
    const ended = new Promise<void>((resolve) => (finish = resolve));
    const offDone = deps.onDone(() => finish());
    const offClosed = deps.onClosed(() => finish());
    const timer = setTimeout(() => finish(), deps.timeoutMs ?? INTRO_TIMEOUT_MS);
    // O hub abre escondido junto com a intro: no fim, ele já está pintado.
    const prepared = deps.prepare ? deps.prepare().catch(() => false) : Promise.resolve(false);
    let revealed = false;
    try {
      await deps.show();
      await ended;
      if (deps.reveal && (await within(prepared, PREPARE_GRACE_MS))) {
        revealed = await deps.reveal().catch(() => false);
        if (revealed) await Bun.sleep(deps.settleMs ?? INTRO_SETTLE_MS);
      }
    } finally {
      clearTimeout(timer);
      offDone();
      offClosed();
      deps.close();
    }
    return revealed;
  };
}

/** O valor de `p`, ou `false` se ele não chega em `ms`. */
async function within(p: Promise<boolean>, ms: number): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<false>((resolve) => (timer = setTimeout(() => resolve(false), ms)));
  try {
    return await Promise.race([p, late]);
  } finally {
    clearTimeout(timer);
  }
}
