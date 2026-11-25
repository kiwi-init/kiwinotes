// T25029 (spec #25011): a varredura do contrato. Toda capacidade de `UI_CAPABILITIES` passa por aqui, e as que podem
// ir à rede ficam presas numa lista fixa, com o motivo e o que leva. Uma capacidade nova que vá à rede quebra este
// teste até entrar na lista, e uma que saia da lista sem deixar de ir à rede também.
//
// Como se sabe se uma capacidade vai à rede: pela leitura do código dela (o corpo do handler em
// `ui-capabilities.ts`), sem rodar nada. Ir à rede é chegar a uma das RAÍZES abaixo, direto ou por um ajudante do
// `uiCapabilities`. Rodar cada handler não serviria: a maioria recusa o argumento antes de chegar ao que importa.
// - As raízes são as portas para a rede que o main tem: o `fetch`, o Updater, a imagem de fora, os modelos baixados
//   e o agente. Uma porta nova (um `fetch` num handler, um método do agente que abre o programa) já cai aqui.
// - Os métodos do agente que vão à rede saem do próprio `src/agent/service.ts`: os que chegam, por qualquer caminho
//   dentro da classe, a abrir o programa do agente (`this.d.openHost`) ou a baixar o adaptador (`downloadAdapter`).
// - Os caminhos POR EVENTO do main: a capacidade pede algo ao main, e um ouvinte dele (fora deste arquivo) vai à rede ou
//   ao agente. A varredura só os vê pela porta que a capacidade toca, então cada um tem uma raiz própria aqui:
//   - salvar o ajuste do ditado preciso: o `settingsChanged` baixa o Whisper (`session.ts`);
//   - parar a reunião: com a transcrição pronta, o `session.ts` chama `stores.agent.meetingReady`, e com o agente ligado
//     e "propor sozinho" ele abre a sessão e lê a transcrição pelas ferramentas (spec #8360; revisão #25294).
//   Quem acrescentar outro ouvinte do main que vá à rede ou ao agente põe a porta dele aqui.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

import { UI_CAPABILITIES } from "../shared/ui-contract.ts";

const SRC = readFileSync(path.join(import.meta.dir, "ui-capabilities.ts"), "utf8");
const SERVICE = readFileSync(path.join(import.meta.dir, "..", "agent", "service.ts"), "utf8");

/** As capacidades que podem ir à rede: o motivo e o que sai do Mac. A lista fixa que o teste prende. */
/** As portas (`roots`) também ficam presas: uma capacidade da lista que passe a falar com o agente quebra o teste. */
const NETWORK_CAPABILITIES: Record<string, { roots: string[]; why: string; carries: string }> = {
  "updates.check": { roots: ["updater"], why: "busca a versão nova no GitHub Releases (ADR 0008), só com o Updater ligado", carries: "um GET do feed do release; nada da pessoa" },
  "updates.apply": { roots: ["updater"], why: "baixa a versão nova do GitHub Releases (ADR 0008)", carries: "um GET do arquivo do release; nada da pessoa" },
  "images.remote": { roots: ["imagem de fora"], why: "a imagem de fora que a nota mostra (`![](https://…)`), no clique da pessoa", carries: "a URL da imagem, que está na nota" },
  "notes.semanticStatus": { roots: ["modelo da busca"], why: "com a busca pelo sentido ligada, começa o download do modelo (E5 small)", carries: "um GET da URL fixa do modelo; nada da pessoa" },
  "settings.set": { roots: ["modelo da busca", "modelo do ditado"], why: "ligar a busca pelo sentido ou o ditado preciso baixa o modelo (E5 small, Whisper small)", carries: "um GET da URL fixa do modelo; nada da pessoa" },
  "meetings.stop": { roots: ["reunião ao agente"], why: "ao fim da reunião, com o agente ligado e \"propor sozinho\", o agente monta a proposta (spec #8360)", carries: "o caminho da nota da reunião; o agente lê a transcrição pelas ferramentas, e o áudio nunca vai" },
  "catVoice.download": { roots: ["modelo da voz do gato"], why: "o clique da pessoa baixa o Qwen3-TTS e a voz do gato, na revisão fixa e com o SHA-256 conferido (T26729, ADR 0014)", carries: "um GET da URL fixa de cada arquivo; nada da pessoa" },
  "agent.download": { roots: ["agente"], why: "baixa o adaptador ACP do agente, na versão fixa e conferida (#8368)", carries: "um GET do pacote fixo; nada da pessoa" },
  "agent.ask": { roots: ["agente"], why: "o pedido vai ao agente que a pessoa ligou (ADR 0011)", carries: "o texto do pedido e os trechos que o agente lê pelas ferramentas do Kiwi" },
  "agent.prepare": { roots: ["agente"], why: "abre o programa do agente antes do pedido, para responder mais rápido (ADR 0011)", carries: "a abertura da sessão no agente; nenhum texto da pessoa" },
  "agent.proposalPrepare": { roots: ["agente"], why: "o agente monta a proposta da pessoa (ADR 0011)", carries: "o texto da proposta e os trechos que o agente lê" },
  "agent.routineRun": { roots: ["agente"], why: "roda uma rotina da pessoa no agente (ADR 0011)", carries: "o texto da rotina e os trechos que o agente lê" },
  "agent.usageRefresh": { roots: ["agente"], why: "pergunta ao agente o limite de uso de agora (ADR 0011)", carries: "a abertura da sessão no agente; nenhum texto da pessoa" },
};

/**
 * Os ajudantes do `uiCapabilities` que podem ir à rede, com o motivo. As capacidades que os chamam herdam o motivo
 * daqui, em vez de entrar uma a uma na lista (o `vault` é chamado por quase toda capacidade das notas).
 */
const NETWORK_HELPERS: Record<string, { roots: string[]; why: string }> = {
  vault: { roots: ["modelo da busca"], why: "ao abrir as notas, o índice da busca pelo sentido acompanha as notas; com ela ligada e sem o modelo, ele baixa o modelo (um GET da URL fixa; nada da pessoa)" },
};

/** O que o `ui-capabilities.ts` importa de um módulo que usa `fetch`: só constantes e contas, nunca o download. */
const IMPORTS_FROM_FETCH_MODULES: Record<string, string[]> = {
  "../notes/semantic/model.ts": ["modelBytes"],
  "./precise-dictation.ts": ["WHISPER_SMALL"],
};

// ---------------------------------------------------------------- a leitura do código

/** Os métodos do `AgentService` e o corpo de cada um. */
function serviceMethods(): Map<string, string> {
  const start = SERVICE.indexOf("export class AgentService {");
  expect(start).toBeGreaterThan(-1);
  const lines = SERVICE.slice(start).split("\n").slice(1);
  const methods = new Map<string, string>();
  let name: string | null = null;
  let body: string[] = [];
  const flush = () => {
    if (name) methods.set(name, (methods.get(name) ?? "") + body.join("\n"));
  };
  for (const line of lines) {
    if (/^}/.test(line)) break;
    const m = /^  (?:(?:private|public|static|readonly|protected) )*(?:async )?(?:get |set )?(\w+)\s*(?:<[^>]*>)?\(/.exec(line);
    if (m) {
      flush();
      name = m[1]!;
      body = [line];
    } else body.push(line);
  }
  flush();
  return methods;
}

/** Os métodos do agente que chegam à rede: abrir o programa do agente ou baixar o adaptador, por qualquer caminho. */
function agentNetworkMethods(): Set<string> {
  const methods = serviceMethods();
  const net = new Set<string>();
  for (const [k, b] of methods) if (/this\.d\.openHost\b|\bdownloadAdapter\(/.test(b)) net.add(k);
  for (let changed = true; changed; ) {
    changed = false;
    for (const [k, b] of methods) {
      if (net.has(k)) continue;
      if ([...net].some((n) => new RegExp(`this\\.${n}\\b`).test(b))) {
        net.add(k);
        changed = true;
      }
    }
  }
  return net;
}

/** As portas para a rede no corpo de um handler ou ajudante: o nome de cada uma que aparece. */
function roots(body: string, agentNet: Set<string>): string[] {
  const agent = [...agentNet].join("|");
  const found: string[] = [];
  const check = (name: string, re: RegExp) => {
    if (re.test(body)) found.push(name);
  };
  check("fetch", /\bfetch\s*\(/);
  check("updater", /deps\.about\??\.(check|apply)\b/);
  check("imagem de fora", /deps\.remoteImage\b/);
  check("modelo da voz do gato", /deps\.catVoice!?\??\.download\b/);
  check("modelo da busca", /semanticEngine\??\.start\b|\bsemantic\??\.sync\b/);
  // Ligar o ditado preciso é salvar o ajuste: o main ouve o `settingsChanged` e baixa o Whisper (session.ts).
  if (/\bpreciseDictation\b/.test(body) && /settings\??\.save\b|settingsChanged\b/.test(body)) found.push("modelo do ditado");
  // Parar a gravação: o fim da reunião pode ir ao agente (o `meetingReady` no `session.ts`, veja o topo).
  check("reunião ao agente", /\bmeetingCall\([^;]*\.stop\s*\(|deps\.meetings\??\.stop\b/);
    check("agente", new RegExp(`\\bagent\\??\\.(${agent})\\s*\\(|deps\\.agent\\??\\.(${agent})\\b`));
  return found;
}

/** O corpo do `uiCapabilities`: os ajudantes (antes do objeto) e cada handler (dentro dele). */
function capabilitySources(): { helpers: Map<string, string>; handlers: Map<string, string> } {
  const fnStart = SRC.indexOf("export function uiCapabilities(");
  const objStart = SRC.indexOf("  const handlers: {", fnStart);
  const objEnd = SRC.indexOf("  for (const cap of UI_CAPABILITIES)", objStart);
  expect(fnStart).toBeGreaterThan(-1);
  expect(objStart).toBeGreaterThan(fnStart);
  expect(objEnd).toBeGreaterThan(objStart);

  const split = (text: string, head: RegExp) => {
    const out = new Map<string, string>();
    let name: string | null = null;
    let body: string[] = [];
    for (const line of text.split("\n")) {
      const m = head.exec(line);
      if (m) {
        if (name) out.set(name, body.join("\n"));
        name = m[1]!;
        body = [line];
      } else body.push(line);
    }
    if (name) out.set(name, body.join("\n"));
    return out;
  };
  return {
    helpers: split(SRC.slice(fnStart, objStart), /^  (?:const|let) (\w+)\s*(?::[^=]*)?=/),
    handlers: split(SRC.slice(objStart, objEnd), /^    "([a-zA-Z][\w.]*)":/),
  };
}

/** As funções do arquivo fora do `uiCapabilities`, que um handler pode chamar. */
function moduleFunctions(): Map<string, string> {
  const out = new Map<string, string>();
  const re = /^(?:export )?(?:async )?function (\w+)/gm;
  const starts = [...SRC.matchAll(re)].map((m) => ({ name: m[1]!, at: m.index! }));
  starts.forEach((s, i) => out.set(s.name, SRC.slice(s.at, starts[i + 1]?.at ?? SRC.length)));
  out.delete("uiCapabilities");
  return out;
}

/**
 * Quem vai à rede. Um ajudante (ou função do arquivo) é "da lista" se está em `NETWORK_HELPERS`; fora dela, vai à
 * rede se tem uma porta ou chama um que vai, menos pelos da lista (esses já dizem o motivo). Uma capacidade vai à
 * rede, para a lista fixa, se tem uma porta ou chama um ajudante fora da lista que vai.
 */
function sweep() {
  const agentNet = agentNetworkMethods();
  const { helpers, handlers } = capabilitySources();
  const callable = new Map([...helpers, ...moduleFunctions()]);
  const calls = (body: string, names: Iterable<string>) => [...names].filter((n) => new RegExp(`\\b${n}\\s*\\(`).test(body));

  // As portas de cada ajudante da lista, para o teste prender também o que eles fazem.
  const listedRoots = new Map(Object.keys(NETWORK_HELPERS).map((h) => [h, roots(callable.get(h) ?? "", agentNet)]));
  // Os ajudantes fora da lista que vão à rede, um chamando o outro.
  const unlisted = new Map<string, string[]>();
  for (const [k, b] of callable) {
    if (k in NETWORK_HELPERS) continue;
    const r = roots(b, agentNet);
    if (r.length) unlisted.set(k, r);
  }
  for (let changed = true; changed; ) {
    changed = false;
    for (const [k, b] of callable) {
      if (k in NETWORK_HELPERS || unlisted.has(k)) continue;
      const via = calls(b, unlisted.keys());
      if (via.length) {
        unlisted.set(k, via.map((v) => `por ${v}`));
        changed = true;
      }
    }
  }

  const direct = new Map<string, string[]>();
  for (const [cap, body] of handlers) {
    const r = [...roots(body, agentNet), ...calls(body, unlisted.keys()).map((h) => `por ${h}`)];
    if (r.length) direct.set(cap, r);
  }
  return { agentNet, handlers, listedRoots, unlisted, direct };
}

// ---------------------------------------------------------------- os testes

describe("nenhuma capacidade vai à rede fora da lista (T25029, spec #25011)", () => {
  const s = sweep();

  test("a varredura passa por todas as capacidades do contrato, e só por elas", () => {
    expect([...s.handlers.keys()].sort()).toEqual([...UI_CAPABILITIES].sort());
    expect(s.handlers.size).toBeGreaterThan(100);
  });

  test("as capacidades que vão à rede são exatamente as da lista, cada uma com o motivo e o que leva", () => {
    expect(Object.fromEntries([...s.direct].sort())).toEqual(
      Object.fromEntries(Object.entries(NETWORK_CAPABILITIES).sort(([a], [b]) => (a < b ? -1 : 1)).map(([c, e]) => [c, e.roots])),
    );
    for (const [cap, { why, carries }] of Object.entries(NETWORK_CAPABILITIES)) {
      expect(UI_CAPABILITIES as readonly string[]).toContain(cap);
      expect(why.length).toBeGreaterThan(10);
      expect(carries.length).toBeGreaterThan(5);
    }
  });

  test("os ajudantes da lista vão à rede só pelas portas que a lista diz, e cada um tem o motivo", () => {
    for (const [h, { roots: want, why }] of Object.entries(NETWORK_HELPERS)) {
      expect({ h, roots: s.listedRoots.get(h) }).toEqual({ h, roots: want });
      expect(why.length).toBeGreaterThan(10);
    }
  });

  test("o agente: os métodos que vão à rede saem do serviço, e o ask e o download estão entre eles", () => {
    for (const m of ["ask", "startDownload", "prepare"]) expect(s.agentNet).toContain(m);
    for (const m of ["memoryView", "trails", "noticeState", "undo"]) expect(s.agentNet).not.toContain(m);
  });

  test("dos módulos que usam fetch, só constantes e contas entram, nunca o download", () => {
    for (const m of SRC.matchAll(/^import (?:type )?\{([^}]*)\} from "(\.[^"]+)";/gm)) {
      const [, names, from] = m;
      const file = path.join(import.meta.dir, from!);
      if (!/\bfetch\s*\(/.test(readFileSync(file, "utf8"))) continue;
      const imported = names!.split(",").map((n) => n.trim().replace(/^type /, "")).filter(Boolean).sort();
      expect({ from, imported }).toEqual({ from, imported: [...(IMPORTS_FROM_FETCH_MODULES[from!] ?? ["(módulo com fetch fora da lista)"])].sort() });
    }
  });
});
