// Os textos da seção Agente dos Ajustes (spec #8373, T8762), separados da tela para os testes lerem cada estado sem
// navegador. O nome do agente ("Claude Code") aparece só como texto, sem logo (ADR 0011).

import type { AgentClaudeStatus, AgentModelChoice, AgentNoticeState, AgentStatus, AgentTurnEvent } from "../../src/shared/ui-contract.ts";

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
    case "projects_list":
      return "Vendo os projetos…";
    case "project_status":
      return target ? `Vendo o projeto ${target}…` : "Vendo um projeto…";
    case "notes_create":
      return target ? `Criando ${target}…` : "Criando uma nota…";
    case "notes_append":
      return target ? `Acrescentando em ${target}…` : "Acrescentando numa nota…";
    case "notes_write":
      return target ? `Escrevendo em ${target}…` : "Escrevendo numa nota…";
    case "project_diary_add":
      return "Anotando no diário do projeto…";
    // A web do agente (spec #11908): ele saiu do cofre para buscar ou ler uma página.
    case "web":
      return "Pesquisando na web…";
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
      // A pergunta na dúvida (spec #9873): o pedido espera a pessoa responder no cartão.
      if (e.status === "waiting") return { ...t, status: waitingStatus("target" in e ? e.target : undefined) };
      return { ...t, status: "tool" in e ? toolStatus(e.tool, e.target) : "Usando uma ferramenta…" };
    case "permission":
      return { ...t, status: `Recusei o ${e.tool}: o agente só usa as suas notas e reuniões, pelo Kiwi.` };
    case "limit":
      // O limite (spec #11084) aparece no balão e no medidor; o "Testar" mostra o erro, que vem logo depois.
      return t;
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
      "Senhas, tokens, credenciais e dados pessoais sensíveis: o Kiwi troca cada um por um marcador antes de o texto sair, e na dúvida também segura. Nenhum detector pega 100%.",
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
 * antes guardado nas Versões da nota. Com o guardrail (spec #9818), as senhas e os tokens ficam de fora.
 */
export const TEST_HINT =
  "Cada teste gasta um pedido do seu plano. O agente pode procurar, ler e mudar as suas notas, e ler as reuniões, mas não apaga nada nem mexe no Mac. O texto de antes de cada mudança fica nas Versões da nota. As senhas e os tokens que o Kiwi acha ficam de fora, trocados por um marcador; nenhum detector pega 100%.";

/** A regra de privacidade, nos Ajustes e no Sobre (ADR 0011). */
export const PRIVACY_RULE = "Tudo é local, menos o agente que você escolher";
export const PRIVACY_HINT = "Áudio, transcrição e notas ficam neste Mac. Só o agente que você ligar recebe o que você pedir a ele, e ele vem desligado.";

/** O status do pedido que espera a resposta da dúvida (spec #9873): "Esperando você: dúvida em Projetos/Kiwi". */
export function waitingStatus(target?: string): string {
  if (target === undefined || target === "") return "Esperando você: dúvida no seu pedido.";
  return `Esperando você: dúvida em ${target.replace(/\.md$/i, "")}.`;
}

/** A linha do aviso (spec #9839): o rótulo, e o que explica cada estado da permissão de notificar. */
export const NOTICE_LABEL = "Avisar quando o agente esperar uma resposta";
const NOTICE_WHAT = "Uma notificação do macOS quando o agente pergunta algo e o Kiwi não está na frente. Ela diz só de qual nota vem a dúvida, nunca o trecho.";

export function noticeHint(s: AgentNoticeState, asking: boolean): string {
  if (s.permission === "unavailable") return "As notificações do macOS não estão disponíveis neste build do Kiwi.";
  if (s.permission === "denied") {
    return "As notificações do Kiwi Notes estão desligadas no macOS. Para ligar: Ajustes do Sistema › Notificações › Kiwi Notes.";
  }
  if (s.permission === "notDetermined") {
    return asking ? "O macOS está perguntando se o Kiwi Notes pode mandar notificações." : `${NOTICE_WHAT} O macOS pergunta uma vez quando você liga.`;
  }
  return s.enabled ? NOTICE_WHAT : "Desligado: a pergunta do agente aparece só no cartão, na janela do Kiwi.";
}

/** O modo econômico (spec #11084): o rótulo e o que ele faz, com o aviso do cache. */
export const ECONOMY_LABEL = "Modo econômico";
export function economyHint(s: AgentStatus): string {
  const what = "Gasta menos do seu limite: o modelo mais barato que o agente oferece, as notas lidas por seção e respostas curtas.";
  return s.economy ? `Ligado. ${what} Trocar de modelo começa um cache novo, então o primeiro pedido depois gasta um pouco mais.` : `${what} Trocar de modelo começa um cache novo.`;
}

/** "Pesquisar na web" (spec #11908): o rótulo e o que muda, desligado por padrão. */
export const WEB_LABEL = "Pesquisar na web";
export function webHint(s: Pick<AgentStatus, "webSearch">): string {
  const what = "Com a permissão, o texto do pedido pode virar uma busca na web, feita pelo Claude Code, com o login dele. O Kiwi não chama nenhum serviço.";
  return s.webSearch ? `Ligado. ${what} O balão mostra quando ele está na web.` : `Desligado: o Kiwi recusa a busca e a leitura de páginas do agente. ${what}`;
}

/** O atalho Control (spec #9876), em Ajustes › Agente. */
export const CONTROL_LABEL = "Falar com o agente pelo Control";

/**
 * A dica da linha do Control. `blocked`: o ditado já está num Control, e o do agente fica desligado. Sempre o aviso do
 * Ditado da Apple, que em alguns Macs usa "pressionar Control duas vezes": o Kiwi não mexe nos ajustes do sistema.
 */
export function controlHint(blocked: boolean): string {
  if (blocked) return "O ditado já usa o Control (Ajustes › Atalhos). Troque a tecla do ditado para ligar este.";
  return (
    "Segure o Control para falar com o agente e solte para mandar; dois toques fixam a escuta, e o Esc cancela. " +
    "O ditado da Apple pode usar \"pressionar Control duas vezes\": troque em Ajustes do Sistema › Teclado › Ditado › Atalho."
  );
}
