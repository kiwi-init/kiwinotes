// Os textos da seção Agente dos Ajustes (spec #8373, T8762), separados da tela para os testes lerem cada estado sem
// navegador. O nome do agente ("Claude Code") aparece só como texto, sem logo (ADR 0011).

import type { AgentClaudeStatus, AgentModelChoice, AgentStatus, AgentTurnEvent } from "../../src/shared/ui-contract.ts";

/** O tamanho do adaptador, para o texto antes do download (a lista fixa do #8368 soma uns 4,4 MB). */
export const ADAPTER_SIZE_LABEL = "4,4 MB";

const MB = (bytes: number) => (bytes / 1e6).toLocaleString("pt-BR", { maximumFractionDigits: 1 });

/** O comando que a pessoa roda no Terminal para entrar na conta: o login é do próprio Claude Code, nunca do Kiwi. */
export const LOGIN_HOW = "No Terminal, digite “claude” e entre na sua conta por ele. O Kiwi nunca pede a sua senha.";

/** A linha do Claude Code instalado: o que a pessoa tem, e o que fazer quando falta algo. */
export function claudeLine(name: string, c: AgentClaudeStatus | null): { text: string; ok: boolean } {
  if (!c) return { text: `Conferindo o ${name}…`, ok: false };
  if (!c.installed) {
    return { text: `O ${name} não está instalado neste Mac. Instale pelo site da Anthropic (claude.com/claude-code) e toque em Tentar de novo.`, ok: false };
  }
  if (c.versionError === "E_AGENT_TOO_OLD") {
    return { text: `O ${name} ${c.version ?? ""} é mais antigo que o que o Kiwi precisa. No Terminal, digite “claude update” e toque em Tentar de novo.`.replace("  ", " "), ok: false };
  }
  if (c.versionError === "E_AGENT_TOO_NEW") {
    return {
      text: `O ${name} ${c.version ?? ""} é de uma série nova, que este Kiwi ainda não conhece. O agente fica indisponível até sair uma atualização do Kiwi Notes.`.replace("  ", " "),
      ok: false,
    };
  }
  if (!c.loggedIn) return { text: `O ${name} ${c.version ?? ""} está instalado, mas não está logado. ${LOGIN_HOW}`.replace("  ", " "), ok: false };
  const how = c.method === "claude.ai" ? "com a sua conta do Claude" : c.method ? `com ${c.method}` : "";
  return { text: `${name} ${c.version ?? ""} instalado e logado${how ? ` ${how}` : ""}. O login é dele: o Kiwi nunca vê a sua senha.`.replace("  ", " "), ok: true };
}

/** A linha do interruptor. */
export function switchHint(s: Pick<AgentStatus, "name" | "enabled" | "consented">, confirming = false): string {
  if (confirming) return `Leia abaixo o que vai para o ${s.name} e confirme para ligar.`;
  if (s.enabled) return `Ligado. Só o que você pedir vai para o ${s.name}, com a sua conta. Desligar para ele na hora.`;
  if (!s.consented) return `Desligado. Ligar mostra antes o que vai para o ${s.name} e o que nunca vai.`;
  return `Desligado. Nada vai para o ${s.name}.`;
}

/** A linha do adaptador: falta baixar, baixando (com a porcentagem), pronto ou o erro do download. */
export function adapterLine(s: Pick<AgentStatus, "name" | "adapter">): string {
  const a = s.adapter;
  if (a.phase === "downloading") {
    const total = a.total ?? 0;
    const pct = total ? Math.floor(((a.done ?? 0) / total) * 100) : 0;
    return `Baixando o adaptador: ${pct}% de ${total ? `${MB(total)} MB` : ADAPTER_SIZE_LABEL}.`;
  }
  if (a.phase === "ready") return `Adaptador ${a.version} baixado. Ele abre o ${s.name} que já está instalado neste Mac, sem outra cópia.`;
  if (a.phase === "error" && a.error) {
    if (a.error.code === "E_ADAPTER_CANCELLED") return "Download cancelado. Nada foi instalado.";
    return a.error.message;
  }
  return `Falta baixar o adaptador do ${s.name} (${ADAPTER_SIZE_LABEL}), uma vez só. Nada seu vai junto.`;
}

/** As escolhas do modelo: as que o agente ofereceu, ou só a atual enquanto ele não abriu nenhuma vez. */
export function modelOptions(s: Pick<AgentStatus, "name" | "model" | "models">): { value: string; label: string }[] {
  const label = (m: AgentModelChoice) => (m.value === "default" ? `Padrão do ${s.name}` : m.name);
  const out = s.models.map((m) => ({ value: m.value, label: label(m) }));
  if (!out.some((o) => o.value === s.model)) out.unshift({ value: s.model, label: s.model === "default" ? `Padrão do ${s.name}` : s.model });
  return out;
}

export function modelHint(s: Pick<AgentStatus, "model" | "models">): string {
  const base = "Um modelo maior gasta mais do seu plano.";
  if (!s.models.length) return `${base} A lista completa aparece depois do primeiro pedido.`;
  // O que o agente diz do escolhido (no "default", o modelo que ele usa de fato), antes do aviso.
  const about = s.models.find((m) => m.value === s.model)?.description;
  return about ? `${about}. ${base}` : base;
}

/**
 * O status de uma ferramenta em uso. As do Kiwi dizem o que foi lido ou procurado ("Lendo Projetos/Kiwi.md…", spec
 * #7496) e o que foi escrito ("Escrevendo em Projetos/Kiwi.md…", spec #8356); as outras, o nome.
 */
export function toolStatus(tool: string, target?: string): string {
  switch (tool) {
    case "notes_search":
      return target ? `Procurando ${target} nas notas…` : "Procurando nas notas…";
    case "notes_outline":
      return target ? `Vendo o sumário de ${target}…` : "Vendo o sumário de uma nota…";
    case "notes_read":
      return target ? `Lendo ${target}…` : "Lendo uma nota…";
    case "notes_list":
      return target ? `Olhando ${target}…` : "Olhando as pastas…";
    case "meetings_list":
      return "Vendo as reuniões…";
    case "meetings_get":
      return target ? `Lendo a reunião ${target}…` : "Lendo uma reunião…";
    case "notes_create":
      return target ? `Criando ${target}…` : "Criando uma nota…";
    case "notes_append":
      return target ? `Acrescentando em ${target}…` : "Acrescentando numa nota…";
    case "notes_write":
      return target ? `Escrevendo em ${target}…` : "Escrevendo numa nota…";
    default:
      return `Usando ${tool}…`;
  }
}

/** O que a área do "Testar" mostra enquanto o pedido anda. */
export interface TestState {
  id: string | null;
  phase: "idle" | "running" | "done" | "cancelled" | "error";
  status: string;
  text: string;
  error?: { code: string; message: string };
}

export const IDLE_TEST: TestState = { id: null, phase: "idle", status: "", text: "" };

/** Aplica um evento `agent.turn` ao estado do teste. Eventos de outro pedido ficam de fora. */
export function applyTurn(t: TestState, e: AgentTurnEvent, name: string): TestState {
  if (t.id && e.id !== t.id) return t;
  // Sem pedido próprio ainda, só o `started` entra (ele traz o id): um evento atrasado de um pedido antigo, de antes do
  // Desligar, não pode sujar o teste parado (revisão do T8762).
  if (!t.id && e.type !== "started") return t;
  switch (e.type) {
    case "started":
      return { id: e.id, phase: "running", status: "Mandando o pedido…", text: "" };
    case "status":
      if (e.status === "opening") return { ...t, status: `Abrindo o ${name}…` };
      if (e.status === "thinking") return { ...t, status: "Pensando…" };
      return { ...t, status: "tool" in e ? toolStatus(e.tool, e.target) : "Usando uma ferramenta…" };
    case "permission":
      return { ...t, status: `Recusei o ${e.tool}: o agente só usa as suas notas e reuniões, pelo Kiwi.` };
    case "text":
      return { ...t, status: "Respondendo…", text: t.text + e.text };
    case "done":
      if (e.stopReason === "cancelled") return { ...t, phase: "cancelled", status: "Cancelado." };
      return { ...t, phase: "done", status: "", text: e.text || t.text };
    case "error":
      return { ...t, phase: "error", status: "", error: { code: e.code, message: e.message } };
  }
}

/** Pode testar: o Claude Code serve, o agente está ligado e o adaptador baixado. */
export function canTest(s: AgentStatus): boolean {
  return !!s.claude?.installed && s.claude.loggedIn && s.claude.versionOk && s.enabled && s.adapter.phase === "ready";
}

/** O texto da tela "Antes de ligar o …" (ADR 0011, a seção "O texto da tela"), com o nome e a empresa do agente. */
export function consentText(name: string, company = "Anthropic"): { title: string; goes: string[]; never: string[]; who: string[] } {
  return {
    title: `Antes de ligar o ${name}`,
    goes: [
      "O que você pedir a ele. A sua voz vira texto aqui no Mac, e o áudio não vai.",
      "Os trechos das suas notas, reuniões e arquivos que ele ler para atender o pedido.",
      "A transcrição de uma reunião que você gravou, quando ela termina, para ele preparar o resumo. Você aprova antes de entrar na nota, e pode desligar só isso em Ajustes › Agente.",
    ],
    never: [
      "O áudio do ditado e das reuniões.",
      "Nada enquanto ele estiver desligado.",
      "Senhas, tokens, credenciais e dados pessoais sensíveis. Se o Kiwi ficar em dúvida sobre um trecho, ele pergunta a você antes.",
    ],
    who: [
      `O Kiwi conversa com o ${name} aqui no seu Mac. Quem manda para a nuvem é o ${name}, com a sua conta, e vale a política de dados da ${company}. O Kiwi não tem servidor e nunca vê a sua senha.`,
      `Para conversar com o ${name}, o Kiwi baixa um adaptador agora. Nada seu vai junto.`,
      "Você desliga quando quiser, em Ajustes › Agente.",
    ],
  };
}

/**
 * A dica do "Testar": o agente lê as notas e as reuniões (spec #7496) e pode mudar as notas (spec #8356), com o texto de
 * antes guardado nas Versões da nota. Até o guardrail de segredos entrar (outro spec), ela avisa que ele pode ler
 * qualquer nota que pedir.
 */
export const TEST_HINT =
  "Cada teste gasta um pedido do seu plano. O agente pode procurar, ler e mudar as suas notas, e ler as reuniões, mas não apaga nada nem mexe no Mac. O texto de antes de cada mudança fica nas Versões da nota. Por enquanto, ele pode ler qualquer nota que pedir.";

/** A regra de privacidade, nos Ajustes e no Sobre (ADR 0011). */
export const PRIVACY_RULE = "Tudo é local, menos o agente que você escolher";
export const PRIVACY_HINT = "Áudio, transcrição e notas ficam neste Mac. Só o agente que você ligar recebe o que você pedir a ele, e ele vem desligado.";
