// Os textos da seção Agente (spec #8373, T8762), estado por estado. A tela inteira roda no roteiro
// `scripts/ui-scripts/ajustes-agente.json`, com o agente falso.

import { describe, expect, test } from "bun:test";

import type { AgentStatus, AgentTurnEvent } from "../../src/shared/ui-contract.ts";
import {
  adapterLine,
  applyTurn,
  canTest,
  claudeLine,
  consentText,
  IDLE_TEST,
  modelHint,
  modelOptions,
  noticeHint,
  PRIVACY_RULE,
  switchHint,
  TEST_HINT,
  type TestState,
} from "./agentText.ts";

const base: AgentStatus = {
  name: "Claude Code",
  enabled: false,
  consented: false,
  claude: { installed: true, version: "2.1.322", loggedIn: true, method: "claude.ai", versionOk: true },
  adapter: { version: "0.106.0", phase: "missing" },
  program: "closed",
  busy: false,
  model: "default",
  effort: "default",
  session: null,
  models: [],
};

describe("o Claude Code instalado", () => {
  test("conferindo, antes da primeira leitura", () => {
    expect(claudeLine("Claude Code", null)).toEqual({ text: "Conferindo o Claude Code…", ok: false });
  });

  test("pronto: a versão e o login, e o Kiwi nunca vê a senha", () => {
    const l = claudeLine("Claude Code", base.claude);
    expect(l.ok).toBe(true);
    expect(l.text).toBe("Claude Code 2.1.322 instalado e logado com a sua conta do Claude. O login é dele: o Kiwi nunca vê a sua senha.");
  });

  test("não instalado: o que fazer", () => {
    const l = claudeLine("Claude Code", { installed: false, loggedIn: false, versionOk: false });
    expect(l.ok).toBe(false);
    expect(l.text).toContain("não está instalado neste Mac");
    expect(l.text).toContain("Tentar de novo");
  });

  test("não logado: diz como entrar pelo próprio Claude Code, sem o Kiwi pedir senha", () => {
    const l = claudeLine("Claude Code", { installed: true, version: "2.1.322", loggedIn: false, versionOk: true });
    expect(l.ok).toBe(false);
    expect(l.text).toContain("não está logado");
    expect(l.text).toContain("digite “claude”");
    expect(l.text).toContain("O Kiwi nunca pede a sua senha.");
  });

  test("o aviso de versão: antigo (atualize) e de série nova (espere o Kiwi)", () => {
    const old = claudeLine("Claude Code", { installed: true, version: "2.0.9", loggedIn: true, versionOk: false, versionError: "E_AGENT_TOO_OLD" });
    expect(old.text).toBe("O Claude Code 2.0.9 é mais antigo que o que o Kiwi precisa. No Terminal, digite “claude update” e toque em Tentar de novo.");
    const newer = claudeLine("Claude Code", { installed: true, version: "3.0.0", loggedIn: true, versionOk: false, versionError: "E_AGENT_TOO_NEW" });
    expect(newer.text).toContain("série nova");
    expect(newer.text).toContain("atualização do Kiwi Notes");
    expect(old.ok || newer.ok).toBe(false);
  });

  test("a versão vem antes do login: um Claude Code antigo e deslogado pede para atualizar primeiro", () => {
    expect(claudeLine("Claude Code", { installed: true, version: "2.0.9", loggedIn: false, versionOk: false, versionError: "E_AGENT_TOO_OLD" }).text).toContain(
      "claude update",
    );
  });
});

describe("o interruptor e o adaptador", () => {
  test("desligado de fábrica: ligar mostra o aviso antes", () => {
    expect(switchHint(base)).toBe("Desligado. Ligar mostra antes o que vai para o Claude Code e o que nunca vai.");
    expect(switchHint({ ...base, consented: true })).toBe("Desligado. Nada vai para o Claude Code.");
    expect(switchHint({ ...base, enabled: true, consented: true })).toContain("Ligado.");
    expect(switchHint(base, true)).toBe("Leia abaixo o que vai para o Claude Code e confirme para ligar.");
  });

  test("falta baixar, baixando com a porcentagem, pronto, cancelado e o erro do engine", () => {
    expect(adapterLine(base)).toBe("Falta baixar o adaptador do Claude Code (4,4 MB), uma vez só. Nada seu vai junto.");
    expect(adapterLine({ ...base, adapter: { version: "0.106.0", phase: "downloading", done: 1_117_000, total: 4_468_000 } })).toBe(
      "Baixando o adaptador: 25% de 4,5 MB.",
    );
    expect(adapterLine({ ...base, adapter: { version: "0.106.0", phase: "ready" } })).toContain("sem outra cópia");
    expect(adapterLine({ ...base, adapter: { version: "0.106.0", phase: "error", error: { code: "E_ADAPTER_CANCELLED", message: "x" } } })).toBe(
      "Download cancelado. Nada foi instalado.",
    );
    const offline = "Sem conexão com a internet. O Kiwi precisa de rede para baixar o adaptador do Claude Code.";
    expect(adapterLine({ ...base, adapter: { version: "0.106.0", phase: "error", error: { code: "E_ADAPTER_OFFLINE", message: offline } } })).toBe(offline);
  });
});

describe("o modelo", () => {
  const models = [
    { value: "default", name: "Default (recommended)", description: "Sonnet · o padrão da sua conta" },
    { value: "opus", name: "Opus" },
  ];

  test("antes do primeiro pedido: só o padrão, e diz que a lista vem depois", () => {
    expect(modelOptions(base)).toEqual([{ value: "default", label: "Padrão do Claude Code" }]);
    expect(modelHint(base)).toBe("Um modelo maior gasta mais do seu plano. A lista completa aparece depois do primeiro pedido.");
  });

  test("com a lista do agente: o padrão com o nome do Kiwi, e a descrição do escolhido na dica", () => {
    expect(modelOptions({ ...base, models })).toEqual([
      { value: "default", label: "Padrão do Claude Code" },
      { value: "opus", label: "Opus" },
    ]);
    expect(modelHint({ ...base, models })).toBe("Sonnet · o padrão da sua conta. Um modelo maior gasta mais do seu plano.");
    expect(modelHint({ ...base, model: "opus", models })).toBe("Um modelo maior gasta mais do seu plano.");
  });

  test("um modelo guardado que o agente não oferece mais continua na lista, para não sumir da tela", () => {
    expect(modelOptions({ ...base, model: "antigo", models }).map((o) => o.value)).toEqual(["antigo", "default", "opus"]);
  });
});

describe("o Testar", () => {
  const ev = (e: Record<string, unknown>) => ({ id: "t1", ...e }) as AgentTurnEvent;
  const run = (events: AgentTurnEvent[], from: TestState = IDLE_TEST) => events.reduce((t, e) => applyTurn(t, e, "Claude Code"), from);

  test("o status ao vivo e a resposta", () => {
    const mid = run([ev({ type: "started" }), ev({ type: "status", status: "opening" })]);
    expect(mid).toMatchObject({ id: "t1", phase: "running", status: "Abrindo o Claude Code…" });
    expect(run([ev({ type: "status", status: "thinking" })], mid).status).toBe("Pensando…");
    expect(run([ev({ type: "status", status: "running", tool: "Read" })], mid).status).toBe("Usando Read…");
    const done = run([ev({ type: "text", text: "Oi" }), ev({ type: "text", text: "!" }), ev({ type: "done", stopReason: "end_turn", text: "Oi!" })], mid);
    expect(done).toMatchObject({ phase: "done", status: "", text: "Oi!" });
  });

  test("cancelado e erro, com a mensagem do engine", () => {
    const mid = run([ev({ type: "started" }), ev({ type: "text", text: "meio" })]);
    expect(run([ev({ type: "done", stopReason: "cancelled", text: "" })], mid)).toMatchObject({ phase: "cancelled", status: "Cancelado.", text: "meio" });
    const err = run([ev({ type: "error", code: "E_AGENT_LIMIT", message: "O Claude Code atingiu o limite de uso da sua conta." })], mid);
    expect(err).toMatchObject({ phase: "error", error: { code: "E_AGENT_LIMIT" } });
  });

  test("a permissão recusada aparece no status: o agente só lê as notas e as reuniões", () => {
    expect(run([ev({ type: "started" }), ev({ type: "permission", tool: "Bash", decision: "denied" })]).status).toBe(
      "Recusei o Bash: o agente só usa as suas notas e reuniões, pelo Kiwi.",
    );
  });

  test("as ferramentas do Kiwi dizem o que foi lido ou procurado (spec #7496)", () => {
    const mid = run([ev({ type: "started" })]);
    const st = (tool: string, target?: string) => run([ev({ type: "status", status: "running", tool, ...(target ? { target } : {}) })], mid).status;
    expect(st("notes_read", "Projetos/Kiwi.md")).toBe("Lendo Projetos/Kiwi.md…");
    expect(st("notes_read", "Projetos/Kiwi.md › Prazo")).toBe("Lendo Projetos/Kiwi.md › Prazo…");
    expect(st("notes_search", '"prazo"')).toBe('Procurando "prazo" nas notas…');
    expect(st("notes_outline", "Projetos/Kiwi.md")).toBe("Vendo o sumário de Projetos/Kiwi.md…");
    expect(st("notes_list", "Projetos")).toBe("Olhando Projetos…");
    expect(st("meetings_list")).toBe("Vendo as reuniões…");
    expect(st("meetings_get", "Reuniões/Orçamento.md")).toBe("Lendo a reunião Reuniões/Orçamento.md…");
    expect(st("projects_list")).toBe("Vendo os projetos…");
    expect(st("project_status", "Kiwi")).toBe("Vendo o projeto Kiwi…");
    expect(st("project_status")).toBe("Vendo um projeto…");
    expect(st("Read")).toBe("Usando Read…");
  });

  test("as ferramentas de escrita dizem o que estão mudando (spec #8356)", () => {
    const mid = run([ev({ type: "started" })]);
    const st = (tool: string, target?: string) => run([ev({ type: "status", status: "running", tool, ...(target ? { target } : {}) })], mid).status;
    expect(st("notes_create", "Projetos/Novo.md")).toBe("Criando Projetos/Novo.md…");
    expect(st("notes_append", "Projetos/Kiwi.md › Prazo")).toBe("Acrescentando em Projetos/Kiwi.md › Prazo…");
    expect(st("notes_write", "Projetos/Kiwi.md")).toBe("Escrevendo em Projetos/Kiwi.md…");
    expect(st("notes_write")).toBe("Escrevendo numa nota…");
  });

  test("a dica do Testar diz que o agente lê e muda as notas, onde fica o texto de antes, e que as senhas e os tokens ficam de fora (spec #9818)", () => {
    expect(TEST_HINT).toContain("ler e mudar as suas notas");
    expect(TEST_HINT).toContain("ler as reuniões");
    expect(TEST_HINT).toContain("não apaga nada");
    expect(TEST_HINT).toContain("Versões da nota");
    expect(TEST_HINT).toContain("ficam de fora, trocados por um marcador");
    expect(TEST_HINT).not.toContain("não muda nada");
  });

  test("sem pedido próprio, um evento atrasado de um pedido antigo não entra; só o started abre um teste (revisão)", () => {
    expect(applyTurn(IDLE_TEST, { id: "antigo", type: "done", stopReason: "cancelled", text: "" }, "Claude Code")).toBe(IDLE_TEST);
    expect(applyTurn(IDLE_TEST, { id: "antigo", type: "text", text: "velho" }, "Claude Code")).toBe(IDLE_TEST);
    const sending: TestState = { ...IDLE_TEST, phase: "running", status: "Mandando o pedido…" };
    expect(applyTurn(sending, { id: "novo", type: "started" }, "Claude Code")).toMatchObject({ id: "novo", phase: "running" });
  });

  test("os eventos de outro pedido ficam de fora", () => {
    const mid = run([ev({ type: "started" })]);
    expect(applyTurn(mid, { id: "outro", type: "text", text: "x" }, "Claude Code")).toBe(mid);
  });

  test("só dá para testar com o Claude Code pronto, ligado e com o adaptador baixado", () => {
    const ready: AgentStatus = { ...base, enabled: true, consented: true, adapter: { version: "0.106.0", phase: "ready" } };
    expect(canTest(ready)).toBe(true);
    expect(canTest({ ...ready, enabled: false })).toBe(false);
    expect(canTest({ ...ready, adapter: { version: "0.106.0", phase: "missing" } })).toBe(false);
    expect(canTest({ ...ready, claude: { ...ready.claude!, loggedIn: false } })).toBe(false);
    expect(canTest({ ...ready, claude: { ...ready.claude!, versionOk: false } })).toBe(false);
    expect(canTest({ ...ready, claude: null })).toBe(false);
  });
});

describe("a tela de aviso e a regra de privacidade (ADR 0011)", () => {
  test("o texto da tela é o do ADR 0011, com o nome e a empresa do agente", async () => {
    const adr = await Bun.file(new URL("../../../docs/adr/0011-agente-e-privacidade.md", import.meta.url)).text();
    const t = consentText("Claude Code");
    expect(t.title).toBe("Antes de ligar o Claude Code");
    const fromAdr = (line: string) => line.replaceAll("Claude Code", "{agente}").replaceAll("Anthropic", "{empresa}");
    for (const line of [...t.goes, ...t.never, ...t.who]) expect(adr).toContain(fromAdr(line));
  });

  test("a regra nova nos Ajustes e no Sobre", async () => {
    expect(PRIVACY_RULE).toBe("Tudo é local, menos o agente que você escolher");
    const settings = await Bun.file(new URL("./Settings.tsx", import.meta.url)).text();
    const about = await Bun.file(new URL("../hub/About.tsx", import.meta.url)).text();
    expect(settings).not.toContain("100% local");
    expect(settings).toContain("PRIVACY_RULE");
    expect(about).toContain("PRIVACY_RULE");
  });
});

test("a linha do aviso (spec #9839): o botão antes de pedir, o liga/desliga com a permissão, e onde mudar quando negada", () => {
  expect(noticeHint({ permission: "notDetermined", enabled: true }, false)).toContain("O macOS pergunta uma vez quando você liga.");
  expect(noticeHint({ permission: "notDetermined", enabled: true }, true)).toBe("O macOS está perguntando se o Kiwi Notes pode mandar notificações.");
  expect(noticeHint({ permission: "allowed", enabled: true }, false)).toContain("nunca o trecho");
  expect(noticeHint({ permission: "allowed", enabled: false }, false)).toContain("Desligado");
  expect(noticeHint({ permission: "denied", enabled: true }, false)).toContain("Ajustes do Sistema › Notificações › Kiwi Notes");
  expect(noticeHint({ permission: "unavailable", enabled: true }, false)).toContain("não estão disponíveis");
});
