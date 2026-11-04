// O subcomando `dictate` da CLI (T1740, do @lucid-puma; o gancho é do T1739, #1746, #1750). Stub até o T1740.

export type Send = (msg: Record<string, unknown>) => Promise<Record<string, unknown>>;

/** Devolve o exit code. */
export async function runDictate(_argv: string[], _send: Send): Promise<number> {
  console.log(JSON.stringify({ ok: false, code: "E_NOT_IMPLEMENTED", message: "dictate comes with T1740" }));
  return 1;
}
