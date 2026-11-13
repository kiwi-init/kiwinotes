// `bun run cli guardrail scan <arquivo>` (spec #9690, T9701): o que o detector de segredos seguraria num texto, para
// conferir a lista antes de ela valer. Roda aqui mesmo, sem o headless: o detector ainda não é ligado ao agente.
//
//   bun run cli guardrail scan nota.md        um arquivo
//   pbpaste | bun run cli guardrail scan -    o que vier pela entrada (o texto copiado, por exemplo)
//
// A saída mostra cada trecho com a linha, o veredito (segredo ou dúvida), o tipo e o trecho **mascarado**: o prefixo
// público do formato, quando há, e o tamanho. O segredo em si nunca é impresso, nem vai para lugar nenhum.
//
// Saída: JSON. Exit 0 lido (com ou sem segredos), 1 o arquivo não abre, 2 uso errado.

import { readFileSync } from "node:fs";

import { KIND_LABELS, mask, scan } from "../src/guardrail/detector.ts";

const USAGE = `usage: bun run cli guardrail scan <arquivo | ->
  scan <arquivo>   mostra o que o detector de segredos seguraria no texto, com o trecho mascarado
  scan -           o mesmo, com o texto da entrada (pbpaste | bun run cli guardrail scan -)`;

const print = (x: unknown) => console.log(JSON.stringify(x, null, 2));

/** Os argumentos sem o `--data DIR` que a CLI põe em todo comando. */
function positional(argv: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--data") i++;
    else out.push(argv[i]!);
  }
  return out;
}

export async function runGuardrail(argv: string[]): Promise<number> {
  const [sub, file, ...extra] = positional(argv);
  if (sub !== "scan" || !file || extra.length) {
    console.error(USAGE);
    return 2;
  }
  let text: string;
  try {
    text = file === "-" ? await new Response(Bun.stdin.stream()).text() : readFileSync(file, "utf8");
  } catch (e) {
    print({ ok: false, code: "E_NOT_FOUND", message: `não deu para ler ${file}: ${String((e as Error)?.message ?? e)}` });
    return 1;
  }
  const t0 = performance.now();
  const r = scan(text);
  const ms = performance.now() - t0;
  print({
    ok: true,
    value: {
      file: file === "-" ? "(entrada)" : file,
      characters: text.length,
      ms: Math.round(ms * 10) / 10,
      verdict: r.verdict === "secret" ? "segredo" : r.verdict === "doubt" ? "dúvida" : "limpo",
      secrets: r.secrets,
      doubts: r.doubts,
      findings: r.findings.map((f) => ({
        line: f.line,
        verdict: f.verdict === "secret" ? "segredo" : "dúvida",
        kind: KIND_LABELS[f.kind],
        masked: mask(text, f),
      })),
    },
  });
  return 0;
}
