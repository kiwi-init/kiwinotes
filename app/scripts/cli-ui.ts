// Os subcomandos `screenshot` e `ui` da CLI (T1742, do @friendly-koala; o gancho é do T1739, #1769). Stub até o T1742.

export interface UiContext {
  /** Um pedido ao headless e a resposta (o mesmo do dictate). */
  send(msg: Record<string, unknown>): Promise<Record<string, unknown>>;
  /** Assina eventos ou logs; devolve como parar. */
  subscribe(topics: ("events" | "logs")[], onMsg: (line: Record<string, unknown>) => void): Promise<() => void>;
  /** A pasta do headless: o vault fica em <data>/vault e o socket em <data>/control.sock. */
  data: string;
}

const notYet = (what: string) => {
  console.log(JSON.stringify({ ok: false, code: "E_NOT_IMPLEMENTED", message: `${what} comes with T1742` }));
  return 1;
};

/** Devolvem o exit code. */
export async function runScreenshot(_argv: string[], _ctx: UiContext): Promise<number> {
  return notYet("screenshot");
}

export async function runUi(_argv: string[], _ctx: UiContext): Promise<number> {
  return notYet("ui");
}
