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

/** Só `https:`, sem usuário e senha no endereço. */
export function remoteImageUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new RemoteImageError("E_BAD_URL", "not a URL");
  }
  if (url.protocol !== "https:") throw new RemoteImageError("E_BAD_URL", "only https images load");
  if (url.username || url.password) throw new RemoteImageError("E_BAD_URL", "no credentials in the URL");
  return url;
}

type Fetcher = (url: string, init: RequestInit) => Promise<Response>;

/** Baixa a imagem e devolve como `data:`. Sem cookie, sem referrer; o redirecionamento também precisa ser https. */
export async function fetchRemoteImage(raw: string, fetcher: Fetcher = fetch, max = MAX_REMOTE_IMAGE_BYTES): Promise<AttachmentData> {
  const url = remoteImageUrl(raw);
  let res: Response;
  try {
    res = await fetcher(url.href, {
      redirect: "follow",
      credentials: "omit",
      referrerPolicy: "no-referrer",
      headers: { accept: [...IMAGE_TYPES].join(",") },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (e) {
    throw new RemoteImageError("E_FETCH", e instanceof Error ? e.message : String(e));
  }
  if (res.url && !res.url.startsWith("https:")) throw new RemoteImageError("E_BAD_URL", "redirected off https");
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
  return { path: url.href, mime, size, dataUrl: `data:${mime};base64,${bytes.toString("base64")}` };
}
