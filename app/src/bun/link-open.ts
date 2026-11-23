// O `window.open` das janelas (T25095, spec #25011). A janela usa `newWindow: "deny"`: o WebKit não abre nada e só
// avisa o main (`new-window-open`), e é aqui que se decide se a URL vai ao navegador padrão. Antes, com o "external",
// uma UI baixada podia abrir o navegador com qualquer URL, e levar nela o que quisesse.
//
// A regra (lead, #25261 e #25265):
// - abre direto a lista fixa do app (as notas da versão no GitHub Releases), e a URL exata que já estava escrita num
//   arquivo da pasta de notas antes desta execução do app. Uma URL que entrou por um save desta sessão não vale: a
//   UI é o próprio editor e poderia gravar a URL com os dados e depois abri-la (#25262);
// - o resto não é recusado em silêncio: o main pergunta, com a URL na tela. A resposta "Abrir" vale até o app fechar;
// - só `http:`, `https:` e `mailto:`; outro esquema, nem pergunta.
// A conferência é a URL inteira, igual, num arquivo de texto; nada se monta a partir de pedaços.

import { lstat, readdir, readFile } from "node:fs/promises";
import path from "node:path";

/** Os esquemas que podem ir ao navegador padrão (os mesmos do `newWindow: "external"` do Electrobun). */
const SCHEMES = new Set(["http:", "https:", "mailto:"]);

/** A URL mais longa que se aceita: um link de nota, não um arquivo inteiro numa query. */
export const MAX_LINK_LENGTH = 4_096;

export type LinkDecision = "fixed" | "on-disk" | "allowed" | "confirmed" | "declined" | "refused";

export interface LinkOpenerOptions {
  /** As URLs do próprio app, lidas na hora do clique (a versão pode mudar com uma atualização). */
  fixed(): readonly string[];
  /** Se a URL exata já estava escrita num arquivo da pasta de notas antes desta execução. */
  onDiskBefore(url: string): Promise<boolean>;
  /** A pergunta à pessoa, com a URL na tela. `true` é "Abrir". */
  confirm(url: string): Promise<boolean>;
  /** Abre no navegador padrão. */
  open(url: string): void;
  log?(msg: string): void;
}

/** A URL normalizada que pode sair, ou null. */
export function linkUrl(raw: unknown): string | null {
  if (typeof raw !== "string" || !raw || raw.length > MAX_LINK_LENGTH) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (!SCHEMES.has(url.protocol)) return null;
  if (url.username || url.password) return null;
  return raw;
}

/** A URL do `new-window-open` do Electrobun: o `detail` vem como texto ou como `{ url, … }`. */
export function newWindowUrl(detail: unknown): unknown {
  if (typeof detail === "string") return detail;
  if (detail && typeof detail === "object" && "url" in detail) return (detail as { url: unknown }).url;
  return null;
}

/** Decide e abre (ou não) cada `window.open`. Uma por vez: dois cliques seguidos não abrem duas perguntas juntas. */
export function createLinkOpener(o: LinkOpenerOptions) {
  const allowed = new Set<string>();
  // A busca no disco varre a pasta inteira (uns 0,8 s com 10 mil notas, #25817), e a resposta não muda na sessão: só
  // contam arquivos de antes do início, um arquivo novo nunca entra e um que muda sai da conta. Fica guardada por URL,
  // o "sim" e o "não". Um erro na busca não fica: o próximo clique tenta de novo.
  const onDisk = new Map<string, boolean>();
  const onDiskBefore = async (url: string): Promise<boolean> => {
    const known = onDisk.get(url);
    if (known !== undefined) return known;
    const found = await o.onDiskBefore(url);
    onDisk.set(url, found);
    return found;
  };
  let queue: Promise<unknown> = Promise.resolve();

  const decide = async (raw: unknown): Promise<LinkDecision> => {
    const url = linkUrl(raw);
    if (!url) return "refused";
    if (o.fixed().includes(url)) return "fixed";
    if (allowed.has(url)) return "allowed";
    if (await onDiskBefore(url).catch(() => false)) return "on-disk";
    if (!(await o.confirm(url).catch(() => false))) return "declined";
    allowed.add(url);
    return "confirmed";
  };

  return {
    /** O `new-window-open` da janela. Devolve o que foi decidido (os testes conferem). */
    request(raw: unknown): Promise<LinkDecision> {
      const next = queue.then(() => decide(raw));
      queue = next.catch(() => {});
      return next.then((d) => {
        // O log leva só a decisão, nunca a URL: ela pode vir de uma nota (AGENTS.md, privacidade).
        o.log?.(`window.open: ${d}`);
        if (d !== "refused" && d !== "declined") o.open(linkUrl(raw)!);
        return d;
      });
    },
  };
}

// ---------------------------------------------------------------- a URL no disco

/** Os arquivos de texto onde um link pode estar escrito. Um docx guarda o link comprimido: cai na pergunta. */
const TEXT_FILES = /\.(md|markdown|txt|canvas|json|csv|tsv|html?|xml|ya?ml|toml|ini|org|rst|tex|log)$/i;
const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_FILES = 50_000;

/** O que pode vir colado numa URL sem fazer parte dela: o fim, um espaço, aspas, parênteses, colchetes, `<>` e crase. */
const URL_EDGE = /[\s"'`()<>\[\]]/;

/**
 * Se o texto tem a URL inteira, não só o começo dela: `https://exemplo.com/a` não vale num texto que só tem
 * `https://exemplo.com/abc`. Antes e depois dela, o início ou o fim do texto, ou um `URL_EDGE`.
 */
export function hasExactUrl(text: string, url: string): boolean {
  for (let i = text.indexOf(url); i >= 0; i = text.indexOf(url, i + 1)) {
    const prev = i === 0 ? "" : text[i - 1]!;
    const next = text[i + url.length] ?? "";
    if ((!prev || URL_EDGE.test(prev)) && (!next || URL_EDGE.test(next))) return true;
  }
  return false;
}

/**
 * Procura a URL exata nos arquivos de texto das pastas `roots`, só nos que não mudaram desde `since` (o início desta
 * execução do app). Um arquivo que mudou nesta sessão pode ter recebido a URL agora, por um save da UI: não conta.
 * Pula as pastas ocultas (`.git`, `.obsidian`, `.trash`) e o `node_modules`, e para nos limites de tamanho e de número.
 */
export async function urlOnDiskBefore(url: string, roots: readonly string[], since: number): Promise<boolean> {
  let seen = 0;
  const walk = async (dir: string): Promise<boolean> => {
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const e of entries) {
      if (e.name.startsWith(".") || e.name === "node_modules") continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (await walk(p)) return true;
        continue;
      }
      if (!e.isFile() || !TEXT_FILES.test(e.name) || ++seen > MAX_FILES) continue;
      const st = await lstat(p).catch(() => null);
      if (!st || st.size > MAX_FILE_BYTES || st.mtimeMs >= since) continue;
      const text = await readFile(p, "utf8").catch(() => "");
      if (hasExactUrl(text, url)) return true;
    }
    return false;
  };
  for (const root of roots) if (await walk(root)) return true;
  return false;
}
