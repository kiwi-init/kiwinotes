// T1827 (nota do review do T1739, #1819): o headless nunca grava nos dados do app de verdade. Um `--data` (ou um
// `KIWI_HEADLESS_DATA`) errado não pode cair no vault do harry: o caminho que é, ou fica dentro de, uma das pastas
// reais é recusado com E_REAL_DATA, antes de criar qualquer coisa.

import { existsSync, realpathSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { dataDir } from "../store/files.ts";

/** As pastas do app de verdade: os dados (as nossas e as do Electrobun) e o vault das notas. */
export function realDataRoots(home = os.homedir()): string[] {
  return [
    dataDir(home), // ~/Library/Application Support/KiwiNotes
    path.join(home, "Library", "Application Support", "app.kiwinotes.desktop"),
    path.join(home, "KiwiNotes"), // o vault (src/bun/stores.ts); não há outro vault configurável no app hoje
  ];
}

/**
 * O caminho de verdade, com os symlinks resolvidos, mesmo quando ele (ou o fim dele) ainda não existe: resolve o
 * maior pedaço que existe e junta o resto.
 */
export function resolveReal(p: string): string {
  let head = path.resolve(p);
  const tail: string[] = [];
  while (!existsSync(head)) {
    const parent = path.dirname(head);
    if (parent === head) break;
    tail.unshift(path.basename(head));
    head = parent;
  }
  let real = head;
  try {
    real = realpathSync.native(head);
  } catch {
    // sem permissão para ler: fica o caminho como veio
  }
  return path.join(real, ...tail);
}

/** `child` é `parent` ou fica dentro dele. O APFS do Mac ignora maiúsculas, então a comparação também. */
function within(child: string, parent: string): boolean {
  const c = child.toLowerCase();
  const p = parent.toLowerCase();
  return c === p || c.startsWith(p.endsWith(path.sep) ? p : p + path.sep);
}

export class RealDataError extends Error {
  readonly code = "E_REAL_DATA";
}

/**
 * Recusa a pasta do headless que é (ou fica dentro de) uma pasta real do app. Confere a pasta e o vault que o
 * headless vai usar (<data>/vault), cada um com os symlinks resolvidos: um `vault` que é link para ~/KiwiNotes também cai.
 */
export function assertNotRealData(data: string, home = os.homedir()): void {
  const roots = realDataRoots(home).flatMap((r) => [path.resolve(r), resolveReal(r)]);
  for (const candidate of [data, path.join(data, "vault")]) {
    const real = resolveReal(candidate);
    const hit = roots.find((r) => within(real, r) || within(path.resolve(candidate), r));
    if (hit) {
      throw new RealDataError(
        `refusing ${path.resolve(data)}: ${candidate === data ? "it" : "its vault"} is the real app's data (${hit}). Use a scratch folder.`,
      );
    }
  }
}
