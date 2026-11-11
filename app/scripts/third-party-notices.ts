// O arquivo de avisos de terceiros (spec #7079): as licenças Apache-2.0, BSD e MIT pedem o texto e o aviso de
// copyright junto do que é distribuído. O arquivo sai em `ui/notes/public/THIRD_PARTY_NOTICES.txt`, que o Vite copia
// para o pack das Notas (`dist/notes/`). Ele traz cada biblioteca do `CREDITS` do Sobre e, depois, as dependências
// dela que vão junto (revisão do T7110): as `dependencies` do package.json, de pacote em pacote, sem as opcionais,
// as de desenvolvimento e as `peer` (essas não entram no pack).
//
//   bun scripts/third-party-notices.ts            escreve o arquivo
//   bun scripts/third-party-notices.ts --check    só confere (exit 1 se estiver velho)

import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { CREDITS, NOTICES_FILE, noticesText } from "../ui/hub/aboutText.ts";

const APP = path.resolve(import.meta.dir, "..");
export const NOTICES_PATH = path.join(APP, "ui", "notes", "public", NOTICES_FILE);

interface Pkg {
  name: string;
  version: string;
  license: string;
  dir: string;
  dependencies: string[];
}

/** O pacote `name` como o Node acharia a partir de `from`: subindo pelas pastas `node_modules`. */
function resolvePkg(name: string, from: string): string | null {
  for (let dir = from; ; dir = path.dirname(dir)) {
    const candidate = path.join(dir, "node_modules", name);
    if (existsSync(path.join(candidate, "package.json"))) return candidate;
    if (dir === APP || dir === path.dirname(dir)) return null;
  }
}

function readPkg(dir: string): Pkg {
  const json = JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8")) as {
    name: string;
    version: string;
    license?: string | { type?: string };
    licenses?: { type?: string }[];
    dependencies?: Record<string, string>;
  };
  const license = typeof json.license === "string" ? json.license : (json.license?.type ?? json.licenses?.map((l) => l.type).join(" OR ") ?? "desconhecida");
  return { name: json.name, version: json.version, license, dir, dependencies: Object.keys(json.dependencies ?? {}) };
}

/** O texto da licença que o pacote traz (LICENSE, LICENCE, COPYING, com ou sem extensão). */
function licenseText(dir: string): string | null {
  const file = readdirSync(dir).find((f) => /^(licen[sc]e|copying)(\.(md|txt|markdown))?$/i.test(f));
  return file ? readFileSync(path.join(dir, file), "utf8") : null;
}

/** As dependências de cada biblioteca, sem repetir, na ordem em que aparecem. */
export function dependencyTree(roots: string[]): Pkg[] {
  const seen = new Set<string>();
  const out: Pkg[] = [];
  const visit = (dir: string) => {
    const pkg = readPkg(dir);
    const key = `${pkg.name}@${pkg.version}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(pkg);
    for (const dep of [...pkg.dependencies].sort()) {
      const found = resolvePkg(dep, dir);
      if (found) visit(found);
    }
  };
  for (const root of roots) {
    const dir = resolvePkg(root, APP);
    if (!dir) throw new Error(`${root} não está instalado: rode bun install`);
    visit(dir);
  }
  return out;
}

export function currentNotices(): string {
  const all = dependencyTree(CREDITS.map((c) => c.pkg));
  const roots = new Set(CREDITS.map((c) => c.pkg));
  const credited = CREDITS.map((c) => {
    const pkg = all.find((p) => p.name === c.pkg)!;
    return { ...c, version: pkg.version, text: licenseText(pkg.dir) ?? `(o pacote não traz o arquivo da licença; ela é ${pkg.license})` };
  });
  const deps = all
    .filter((p) => !roots.has(p.name))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((p) => ({
      name: p.name,
      by: "seus autores",
      license: p.license,
      use: "dependência de uma biblioteca acima",
      pkg: p.name,
      version: p.version,
      text: licenseText(p.dir) ?? `(o pacote não traz o arquivo da licença; ela é ${p.license})`,
    }));
  return noticesText([...credited, ...deps]);
}

if (import.meta.main) {
  const text = currentNotices();
  if (process.argv.includes("--check")) {
    const ok = readFileSync(NOTICES_PATH, "utf8") === text;
    console.log(ok ? "ok" : `${NOTICES_FILE} está velho: rode bun scripts/third-party-notices.ts`);
    process.exit(ok ? 0 : 1);
  }
  writeFileSync(NOTICES_PATH, text);
  console.log(NOTICES_PATH);
}
