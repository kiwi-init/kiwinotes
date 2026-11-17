// O esquema como vai ao agente (spec #13379): sem o que o código das ferramentas já confere e recusa com a mensagem
// certa (`additionalProperties: false`, `minItems`, `maxItems`). Cada esquema vai em toda chamada ao modelo (ou no
// cartão de instrução, T14563), então cada palavra conta; os tamanhos dos textos (`maxLength`) ficam, porque guiam o
// agente antes de errar.

export function servedSchemaOf(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(servedSchemaOf);
  if (!schema || typeof schema !== "object") return schema;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(schema)) {
    if (k === "minItems" || k === "maxItems" || (k === "additionalProperties" && v === false)) continue;
    out[k] = k === "properties" && v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([n, x]) => [n, servedSchemaOf(x)])) : servedSchemaOf(v);
  }
  return out;
}
