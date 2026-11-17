// A imagem de fora (https) de uma nota, baixada pelo engine só depois do clique da pessoa no cartão (T2984, decisão do
// jow no #3039, plano A do review do #109). A janela não carrega nada da internet: a CSP dela não tem `https:`, e a
// imagem chega como `data:`, como os anexos. Assim nenhum caminho de desenho (a lib, o mermaid, um CSS) consegue
// baixar algo sozinho.

import type { AttachmentData } from "./attachments.ts";

/** Os tipos que viram `data:` para o `<img>`. SVG fica de fora: é documento, não foto. */
const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp", "image/avif", "image/bmp"]);

export const MAX_REMOTE_IMAGE_BYTES = 10 * 1024 * 1024;
const TIMEOUT_MS = 15_000;

export class RemoteImageError extends Error {
  constructor(
    readonly code: "E_BAD_URL" | "E_FETCH" | "E_NOT_IMAGE" | "E_TOO_BIG",
    message: string,
  ) {
    super(message);
  }
}

const MAX_REDIRECTS = 5;

/** Um host da rede local (ou da própria máquina): o pedido sai do Mac da pessoa, e lá ele não tem o que buscar. */
export function localHost(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal") || !h.includes(".") && !h.includes(":")) return true;
  const v4 = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(h);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
  }
  if (h.includes(":")) return h === "::1" || h === "::" || /^(fc|fd|fe8|fe9|fea|feb)/.test(h) || h.startsWith("::ffff:");
  return false;
}

/** Só `https:`, sem usuário e senha no endereço, e fora da rede local. */
export function remoteImageUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new RemoteImageError("E_BAD_URL", "not a URL");
  }
  if (url.protocol !== "https:") throw new RemoteImageError("E_BAD_URL", "only https images load");
  if (url.username || url.password) throw new RemoteImageError("E_BAD_URL", "no credentials in the URL");
  if (localHost(url.hostname)) throw new RemoteImageError("E_BAD_URL", "no local network hosts");
  return url;
}

type Fetcher = (url: string, init: RequestInit) => Promise<Response>;

/**
 * Baixa a imagem e devolve como `data:`. Sem cookie, sem referrer. Cada redirecionamento (até 5) passa pela mesma
 * conferência do endereço: https e fora da rede local.
 */
export async function fetchRemoteImage(raw: string, fetcher: Fetcher = fetch, max = MAX_REMOTE_IMAGE_BYTES): Promise<AttachmentData> {
  let url = remoteImageUrl(raw);
  const signal = AbortSignal.timeout(TIMEOUT_MS);
  let res: Response;
  for (let hop = 0; ; hop++) {
    try {
      res = await fetcher(url.href, {
        redirect: "manual",
        credentials: "omit",
        referrerPolicy: "no-referrer",
        headers: { accept: [...IMAGE_TYPES].join(",") },
        signal,
      });
    } catch (e) {
      throw new RemoteImageError("E_FETCH", e instanceof Error ? e.message : String(e));
    }
    if (res.status < 300 || res.status >= 400) break;
    const next = res.headers.get("location");
    if (!next) break;
    if (hop >= MAX_REDIRECTS) throw new RemoteImageError("E_FETCH", "too many redirects");
    try {
      url = remoteImageUrl(new URL(next, url).href);
    } catch (e) {
      if (e instanceof RemoteImageError) throw new RemoteImageError("E_BAD_URL", `redirect refused: ${e.message}`);
      throw e;
    }
  }
  if (!res.ok) throw new RemoteImageError("E_FETCH", `HTTP ${res.status}`);
  const mime = (res.headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
  if (!IMAGE_TYPES.has(mime)) throw new RemoteImageError("E_NOT_IMAGE", `not an image (${mime || "no type"})`);
  const declared = Number(res.headers.get("content-length") ?? 0);
  if (declared > max) throw new RemoteImageError("E_TOO_BIG", `bigger than ${max} bytes`);
  const chunks: Uint8Array[] = [];
  let size = 0;
  const reader = res.body?.getReader();
  if (reader) {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > max) {
        await reader.cancel();
        throw new RemoteImageError("E_TOO_BIG", `bigger than ${max} bytes`);
      }
      chunks.push(value);
    }
  }
  const bytes = Buffer.concat(chunks);
  return { path: raw, mime, size, dataUrl: `data:${mime};base64,${bytes.toString("base64")}` };
}
