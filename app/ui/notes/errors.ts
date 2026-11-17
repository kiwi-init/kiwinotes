// O código de um erro do engine (T7656). O AppEngine lança `Error("<cap>: <mensagem>")` com o código em `.code`, e não
// no texto; procurar o código na mensagem nunca achava no app de verdade. O texto fica só para um erro sem `.code`
// (um que a própria janela monte).

export function errorCode(e: unknown): string | undefined {
  const code = (e as { code?: unknown } | null)?.code;
  if (typeof code === "string" && code) return code;
  return /\bE_[A-Z0-9_]+\b/.exec(String((e as Error | null)?.message ?? e))?.[0];
}
