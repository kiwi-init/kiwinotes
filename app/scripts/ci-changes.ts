// O que o CI roda num PR (spec #21331): cada run pegava 3 máquinas macOS, e o GitHub dá 5. Agora o `typecheck` vai
// para o Linux, e o `bun test` e o `swift test` só pegam um Mac quando o PR mexe no que eles testam. Quando não mexe,
// o job roda no Linux, com um passo "pulado: <motivo>", e sai verde: o check continua com o mesmo nome e com passos.
//
//   git diff --name-only <base>...<head> | bun scripts/ci-changes.ts pull_request   # escreve no $GITHUB_OUTPUT
//
// As saídas: `bun` e `swift` ("run" ou "skip"), e `bun_reason` e `swift_reason` (o motivo do pulo, ou vazio).
import fs from "node:fs";

export interface Plan {
  bun: "run" | "skip";
  bunReason: string;
  swift: "run" | "skip";
  swiftReason: string;
}

/** O workflow do CI: mexer nele roda tudo, para provar a mudança. */
const WORKFLOW = ".github/workflows/ci.yml";

/**
 * Só texto: todos os arquivos são `*.md` fora de `app/` e de `native/`. Qualquer outro arquivo de `docs/` roda tudo,
 * porque o app e os testes leem `docs/design/` (o ícone, as cores e o gato).
 */
export function textOnly(files: string[]): boolean {
  return files.length > 0 && files.every((f) => f.toLowerCase().endsWith(".md") && !f.startsWith("app/") && !f.startsWith("native/"));
}

/** O plano de um evento. Fora de um PR (o push na `main`), roda sempre tudo. Sem a lista de arquivos, também. */
export function plan(event: string, files: string[]): Plan {
  const all: Plan = { bun: "run", bunReason: "", swift: "run", swiftReason: "" };
  if (event !== "pull_request" || files.length === 0) return all;
  if (textOnly(files)) {
    const reason = "o PR só mexe em texto (*.md fora de app/ e native/)";
    return { bun: "skip", bunReason: reason, swift: "skip", swiftReason: reason };
  }
  if (files.some((f) => f.startsWith("native/") || f === WORKFLOW)) return all;
  return { ...all, swift: "skip", swiftReason: `o PR não mexe em native/ nem no ${WORKFLOW}` };
}

if (import.meta.main) {
  const event = process.argv[2] ?? "";
  const files = (await new Response(Bun.stdin.stream()).text()).split("\n").map((l) => l.trim()).filter(Boolean);
  const p = plan(event, files);
  const lines = [`bun=${p.bun}`, `bun_reason=${p.bunReason}`, `swift=${p.swift}`, `swift_reason=${p.swiftReason}`];
  console.log(`ci-changes: ${files.length} arquivos (${event})\n${lines.join("\n")}`);
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `${lines.join("\n")}\n`);
}

// ensaio T21438: um comentário no app (não entra)
