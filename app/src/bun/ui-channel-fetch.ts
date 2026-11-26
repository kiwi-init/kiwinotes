// O fetch do canal remoto de UI (spec #25011, T25029). O AppEngine segue qualquer `bundleUrl` http(s) do manifesto
// assinado; este fetch é a trava do Kiwi por cima dele, e o canal remoto só fala com a rede por aqui.
//
// - Só o release `ui-channel` do repo: `https://github.com/kiwi-init/kiwinotes/releases/download/ui-channel/…`, sem
//   query, sem `#`, sem usuário e sem porta. Outro host, outro release ou outro esquema é recusado antes de sair.
// - O redirect não é seguido pelo fetch: este código segue até 5, e só para o armazenamento de arquivos do GitHub.
// - Nada da pessoa vai junto: um GET sem corpo, sem cookie, sem referrer e sem cabeçalho além do `accept` (o do SSE).
//   Nem a URL leva nada: ela é fixa, e a query é recusada.

/** Onde o canal mora: o release `ui-channel`, sobrescrito a cada publicação (spec #25011). */
export const UI_CHANNEL_BASE = "https://github.com/kiwi-init/kiwinotes/releases/download/ui-channel/";

/** Para onde o GitHub manda o download de um arquivo de release. Se mudar, a mudança vem para cá. */
export const UI_CHANNEL_STORAGE_HOSTS: readonly string[] = ["objects.githubusercontent.com", "release-assets.githubusercontent.com"];

export const UI_CHANNEL_MAX_REDIRECTS = 5;

/** O único cabeçalho que passa: o `accept` (o AppEngine pede `text/event-stream` no SSE). */
const ALLOWED_HEADERS = new Set(["accept"]);

const REDIRECTS = new Set([301, 302, 303, 307, 308]);

/** Por que a URL inicial não pode sair, ou null se pode. */
export function channelUrlRefusal(url: URL): string | null {
  if (url.username || url.password) return "a URL do canal não leva usuário nem senha"; // i18n-ok: o motivo do erro, vai ao log
  if (url.search || url.hash) return "a URL do canal não leva query nem #"; // i18n-ok: o motivo do erro, vai ao log
  if (!url.href.startsWith(UI_CHANNEL_BASE)) return `fora do release ui-channel: ${url.origin}${url.pathname}`;
  if (url.pathname.length <= new URL(UI_CHANNEL_BASE).pathname.length) return "sem o nome do arquivo";
  return null;
}

/** Por que o destino de um redirect não pode ser seguido, ou null se pode. */
export function redirectRefusal(url: URL): string | null {
  if (url.protocol !== "https:") return `redirect sem https: ${url.protocol}`;
  if (url.username || url.password) return "redirect com usuário ou senha"; // i18n-ok: o motivo do erro, vai ao log
  if (url.port) return `redirect com porta: ${url.port}`;
  if (!UI_CHANNEL_STORAGE_HOSTS.includes(url.hostname)) return `redirect para outro host: ${url.hostname}`;
  return null;
}

function urlOf(input: string | URL | Request): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

/** Só o `accept`, e só com um valor de texto curto. */
function allowedHeaders(headers: HeadersInit | undefined): Headers {
  const out = new Headers();
  for (const [name, value] of new Headers(headers)) {
    if (!ALLOWED_HEADERS.has(name.toLowerCase())) throw new Error(`o canal não manda o cabeçalho ${name}`);
    out.set(name, value);
  }
  return out;
}

/**
 * O fetch guardado. `inner` é o fetch de verdade (os testes passam um falso, que responde pelas URLs do GitHub sem
 * rede). Uma recusa é um erro: o AppEngine a trata como canal offline (o manifesto) ou download recusado (o pack).
 */
export function uiChannelFetch(inner: typeof fetch = fetch): typeof fetch {
  const guarded = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    if (input instanceof Request) throw new Error("o canal só aceita uma URL, não um Request");
    const method = (init?.method ?? "GET").toUpperCase();
    if (method !== "GET") throw new Error(`o canal só faz GET, não ${method}`);
    if (init?.body != null) throw new Error("o canal não manda corpo");
    const headers = allowedHeaders(init?.headers);

    let url = new URL(urlOf(input));
    const refusal = channelUrlRefusal(url);
    if (refusal) throw new Error(refusal);

    for (let hop = 0; ; hop++) {
      const response = await inner(url.href, {
        method: "GET",
        headers,
        redirect: "manual",
        credentials: "omit",
        referrerPolicy: "no-referrer",
        cache: "no-store",
        signal: init?.signal,
      });
      if (!REDIRECTS.has(response.status)) return response;
      const location = response.headers.get("location");
      if (!location) throw new Error(`redirect ${response.status} sem Location`);
      if (hop >= UI_CHANNEL_MAX_REDIRECTS) throw new Error(`mais de ${UI_CHANNEL_MAX_REDIRECTS} redirects`);
      const next = new URL(location, url);
      const bad = redirectRefusal(next);
      if (bad) throw new Error(bad);
      void response.body?.cancel().catch(() => {});
      url = next;
    }
  };
  return guarded as typeof fetch;
}
