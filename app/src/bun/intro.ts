// A intro da abertura do zero (spec #2078, T2308): a janela `intro` toca a animação e avisa no fim (`intro.done`),
// que vem do último frame, do clique para pular ou do "Reduzir movimento". O hub (`HubDeps.intro`) espera isso para
// aparecer. Sem Electrobun aqui: o index.ts liga as peças, e os testes usam peças falsas.

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
}

/**
 * A intro inteira leva ~12,5 s (os 6 tempos em 3,7 s e a abertura do gato em ~8,4 s, #2251). Com folga para a carga
 * da janela, 20 s: se a página travar ou nunca avisar, o hub abre igual. A intro é enfeite e nunca segura o app.
 */
export const INTRO_TIMEOUT_MS = 20_000;

/** A `HubDeps.intro`: abre a janela, espera o fim (ou o tempo máximo, ou a janela fechar) e fecha a janela. */
export function makeIntro(deps: IntroDeps): () => Promise<void> {
  return async () => {
    let finish = () => {};
    const ended = new Promise<void>((resolve) => (finish = resolve));
    const offDone = deps.onDone(() => finish());
    const offClosed = deps.onClosed(() => finish());
    const timer = setTimeout(() => finish(), deps.timeoutMs ?? INTRO_TIMEOUT_MS);
    try {
      await deps.show();
      await ended;
    } finally {
      clearTimeout(timer);
      offDone();
      offClosed();
      deps.close();
    }
  };
}
