// Ditar pela CLI headless (T1740, do @lucid-puma; o gancho é do T1739, #1746, #1750). Stub até o T1740: o server
// do headless chama `dictate(session, msg)` no `cmd:"dictate"` e devolve o relatório, ou o erro com `code`.

import type { Session } from "./session.ts";

export class DictateError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export async function dictate(_session: Session, _msg: Record<string, unknown>): Promise<unknown> {
  throw new DictateError("E_NOT_IMPLEMENTED", "dictate comes with T1740");
}
