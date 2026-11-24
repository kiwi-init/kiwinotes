// Os textos da seção Agente dos Ajustes (spec #8373, T8762), separados da tela para os testes lerem cada estado sem
// navegador. O nome do agente ("Claude Code") aparece só como texto, sem logo (ADR 0011).

import { AGENT_NAMES, EFFORT_ORDER } from "../../src/agent/kinds.ts";
import type { AgentClaudeStatus, AgentKind, AgentModelChoice, AgentNoticeState, AgentStatus, AgentTurnEvent } from "../../src/shared/ui-contract.ts";

/** O tamanho do adaptador, para o texto antes do download (a lista fixa do #8368 soma uns 4,4 MB). */
export const ADAPTER_SIZE_LABEL = "4,4 MB";

const MB = (bytes: number) => (bytes / 1e6).toLocaleString("pt-BR", { maximumFractionDigits: 1 });

export type { AgentKind };

/**
 * O que muda de um agente para o outro na tela: o nome, a empresa (para onde o texto vai), como instalar, atualizar e
 * entrar na conta. O nome é o do motor (`AGENT_NAMES`), o mesmo das mensagens. O login é sempre do próprio agente,
 * no Terminal: o Kiwi nunca pede, lê nem guarda senha ou chave.
 */
export const AGENTS: Record<AgentKind, { name: string; company: string; install: string; update: string; login: string; adapter: boolean }> = {
  claude: {
    name: AGENT_NAMES.claude,
    company: "Anthropic",
    install: "Instale pelo site da Anthropic (claude.com/claude-code)",
    update: "No Terminal, digite “claude update”",
    login: "No Terminal, digite “claude” e entre na sua conta por ele. O Kiwi nunca pede a sua senha.",
    adapter: true,
  },
  gemini: {
    name: AGENT_NAMES.gemini,
    company: "Google",
    // O programa é o Antigravity CLI, o `agy` (spec #25046); o login é dele, no Terminal, nunca uma chave no Kiwi.
    install: "Instale o Antigravity CLI (antigravity.google)",
    update: "Atualize o Antigravity CLI pelo mesmo jeito que você instalou",
    login: "Abra o Antigravity no Terminal e entre com a sua conta (digite “agy”). O Kiwi nunca pede a sua senha nem a sua chave.",
    adapter: false,
  },
};

/** O agente escolhido; um engine anterior ao Gemini não manda o `kind`, e é o Claude. */
export const kindOf = (s: { kind?: AgentKind } | null | undefined): AgentKind => (s?.kind === "gemini" ? "gemini" : "claude");

/** O comando que a pessoa roda no Terminal para entrar na conta: o login é do próprio Claude Code, nunca do Kiwi. */
export const LOGIN_HOW = AGENTS.claude.login;

/** A linha do Claude Code instalado (o onboarding usa esta): a de `agentLine` com o Claude. */
export function claudeLine(name: string, c: AgentClaudeStatus | null): { text: string; ok: boolean } {
  return agentLine("claude", name, c);
}

/** O login ainda não conferido (`loginKnown: false`, o Gemini antes de a sessão abrir). */
export const loginUnknown = (c: ProgramState): boolean => c.loginKnown === false;

/** O pedaço do estado do programa que as linhas leem (o `claude` ou o `gemini` do status). */
export type ProgramState = Pick<AgentClaudeStatus, "installed" | "loggedIn" | "versionOk"> & { loginKnown?: boolean };

/** A linha do agente instalado: o que a pessoa tem, e o que fazer quando falta algo. */
export function agentLine(kind: AgentKind, name: string, c: AgentClaudeStatus | null): { text: string; ok: boolean } {
  const a = AGENTS[kind];
  if (!c) return { text: `Conferindo o ${name}…`, ok: false };
  if (!c.installed) {
    return { text: `O ${name} não está instalado neste Mac. ${a.install} e toque em Tentar de novo.`, ok: false };
  }
  if (c.versionError === "E_AGENT_TOO_OLD") {
    return { text: `O ${name} ${c.version ?? ""} é mais antigo que o que o Kiwi precisa. ${a.update} e toque em Tentar de novo.`.replace("  ", " "), ok: false };
  }
  if (c.versionError === "E_AGENT_TOO_NEW") {
    return {
      text: `O ${name} ${c.version ?? ""} é de uma série nova, que este Kiwi ainda não conhece. O agente fica indisponível até sair uma atualização do Kiwi Notes.`.replace("  ", " "),
      ok: false,
    };
  }
  // O Gemini só diz o login quando a sessão abre (o `authRequired`): até lá, não se sabe, e o "Testar" fica liberado.
  if (loginUnknown(c)) return { text: `${name} ${c.version ?? ""} instalado. O login se confere no primeiro pedido; o Kiwi nunca vê a sua senha.`.replace("  ", " "), ok: true };
  if (!c.loggedIn) return { text: `O ${name} ${c.version ?? ""} está instalado, mas não está logado. ${a.login}`.replace("  ", " "), ok: false };
  // O Gemini não diz o jeito do login (o Kiwi só sabe pelo `authRequired`): nada além de "logado".
  const how = kind !== "claude" ? "" : c.method === "claude.ai" ? "com a sua conta do Claude" : c.method ? `com ${c.method}` : "";
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

/**
 * O que o Claude Code diz de cada modelo, em português (spec #16793). Ele manda em inglês ("Opus 5 · Legacy"): cada
 * pedaço entre "·" vira a tradução daqui, um nome de modelo fica como está, e o resto sai, para a linha não misturar
 * as duas línguas. As frases são as do Claude Code de hoje; uma nova cai fora até entrar aqui.
 */
const MODEL_ABOUT: Record<string, string> = {
  "most efficient for simpler tasks": "o mais econômico, para tarefas simples",
  "fastest for quick answers": "o mais rápido, para respostas curtas",
  "for complex work and everyday tasks": "para trabalho complexo e o dia a dia",
  "best for everyday, complex tasks": "o melhor para o dia a dia e tarefas complexas",
  "most capable for complex work": "o mais capaz, para trabalho complexo",
  "can think for more complex tasks": "pensa mais, para tarefas complexas",
  "previous opus version": "a versão anterior do Opus",
  legacy: "versão antiga",
  recommended: "recomendado",
  "1m context": "contexto de 1M",
  "1m context window": "contexto de 1M",
};
const MODEL_NAME = /^(claude\s+)?(opus|sonnet|haiku|fable)(\s+[\d.]+)?(\s*\[1m\])?$/i;

export function modelAbout(description: string | undefined): string {
  if (!description) return "";
  const parts: string[] = [];
  for (const piece of description.split(/\s+[·\u00b7]\s+|\s+[-–—]\s+/)) {
    const t = piece.trim().replace(/\.$/, "");
    const pt = MODEL_ABOUT[t.toLowerCase()];
    if (pt) parts.push(parts.length ? pt : pt[0]!.toUpperCase() + pt.slice(1));
    else if (MODEL_NAME.test(t)) parts.push(t);
  }
  return parts.join(" · ");
}

export function modelHint(s: Pick<AgentStatus, "model" | "models">): string {
  const base = "Um modelo maior gasta mais do seu plano.";
  if (!s.models.length) return `${base} A lista completa aparece depois do primeiro pedido.`;
  // O que o agente diz do escolhido (no "default", o modelo que ele usa de fato), antes do aviso, em português.
  const about = modelAbout(s.models.find((m) => m.value === s.model)?.description);
  return about ? `${about}. ${base}` : base;
}

/** Os nomes dos esforços em português (spec #16793); um que o Kiwi não conhece fica com o nome que o agente deu. */
export const EFFORT_NAMES: Record<string, string> = {
  default: "Padrão",
  low: "Baixo",
  medium: "Médio",
  high: "Alto",
  xhigh: "Muito alto",
  max: "Máximo",
};

/** O que o onboarding sabe da sessão aberta sem pedido: abrindo, aberta ou não deu. */
export type Prepare = "opening" | "ready" | "failed";

/**
 * A frase do Esforço antes de o agente dizer as opções do modelo: no onboarding, e em Ajustes (`settings`, T25729), onde
 * a pessoa já está no lugar de trocar.
 */
export function prepareHint(prepare: Prepare, name = "Claude Code", settings = false): string {
  if (prepare === "opening") return `Abrindo o ${name} para ver os níveis de esforço deste modelo…`;
  return settings
    ? `Não deu para abrir o ${name} agora, então fica no Padrão. Os níveis deste modelo aparecem depois do primeiro pedido com ele.`
    : `Não deu para abrir o ${name} agora, então fica no Padrão. Dá para trocar em Ajustes › Agente depois do primeiro pedido.`;
}

/**
 * As escolhas do Esforço para o modelo escolhido (spec #16793): as que o agente ofereceu nele, em português, e sempre o
 * "Padrão" (o host leva o `default` ao esforço que o próprio agente pôs no modelo, quando ele não oferece o valor).
 * `null` quando o Kiwi ainda não viu esse modelo numa sessão; `[]` quando ele não tem esforço. Um esforço salvo que o
 * modelo não tem não entra: ele não vale (revisão #17024), e o `effortValue` mostra o que vale.
 */
export function effortOptions(s: Pick<AgentStatus, "model" | "efforts">): { value: string; label: string }[] | null {
  // Um engine anterior ao 1.82.0 não manda os esforços (o `requiresContract` da UI é ^1.0.0): sem a lista, sem o seletor.
  const known = s.efforts?.[s.model];
  if (!known) return null;
  if (!known.length) return [];
  const out = known.map((m) => ({ value: m.value, label: EFFORT_NAMES[m.value] ?? m.name }));
  if (!out.some((o) => o.value === "default")) out.unshift({ value: "default", label: EFFORT_NAMES.default! });
  return out;
}

/**
 * O esforço que o seletor mostra: o salvo, se o modelo o tem; senão o que vale de fato, o da sessão aberta nesse modelo
 * ou o Padrão.
 */
export function effortValue(s: Pick<AgentStatus, "model" | "effort" | "efforts" | "session">): string {
  const options = effortOptions(s) ?? [];
  const offered = (v: string | undefined): v is string => !!v && options.some((o) => o.value === v);
  if (offered(s.effort)) return s.effort;
  const live = s.session?.model === s.model ? s.session.effort : undefined;
  return offered(live) ? live : "default";
}

const effortName = (v: string) => EFFORT_NAMES[v] ?? v;

export function effortHint(s: Pick<AgentStatus, "name" | "model" | "effort" | "efforts" | "economy" | "session">): string {
  const options = effortOptions(s);
  if (options === null) return "As opções de esforço deste modelo aparecem depois do primeiro pedido com ele.";
  if (!options.length) {
    // Nenhum modelo já visto deste agente tem esforço (T25553): é o agente que não deixa escolher, não só este modelo.
    if (Object.values(s.efforts ?? {}).every((e) => !e.length)) return `O ${s.name} não deixa escolher o esforço: ele decide sozinho quanto pensar.`;
    return "Este modelo não tem nível de esforço: ele responde sempre do mesmo jeito.";
  }
  const what = "Mais esforço pensa mais antes de responder e gasta mais do seu plano. Fica salvo para este modelo e vale a partir do próximo pedido.";
  const shown = effortValue(s);
  const missing = shown !== s.effort ? ` O nível salvo, ${effortName(s.effort)}, não existe neste modelo: vale o ${effortName(shown)}.` : "";
  // O Padrão pede o nível mais baixo do modelo (spec #19273, harry #19294), quando o modelo tem um dos níveis que o host
  // conhece (o `EFFORT_ORDER`). Sem nenhum, o host deixa o esforço com que o agente abriu: a frase não promete o mais
  // baixo (T25729, lead #25744).
  const known = options.some((o) => (EFFORT_ORDER as readonly string[]).includes(o.value));
  const lowest = shown !== "default" ? "" : known ? " No Padrão, vale o nível mais baixo do modelo, o que gasta menos." : ` No Padrão, vale o esforço que o ${s.name} escolhe.`;
  const economy = s.economy ? " Com o modo econômico ligado, vale o esforço salvo do modelo mais barato." : "";
  return `${what}${lowest}${missing}${economy}`;
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
    // Só a diferença (T14650): um trecho, ou a estrutura da nota.
    case "notes_edit":
      return target ? `Trocando um trecho em ${target}…` : "Trocando um trecho numa nota…";
    case "notes_section_move":
    case "notes_section_rename":
    case "notes_section_merge":
      return target ? `Arrumando as seções de ${target}…` : "Arrumando as seções de uma nota…";
    case "project_diary_add":
      return "Anotando no diário do projeto…";
    // A fala do gato (T26709): o agente escreveu o que a pessoa vai ouvir.
    case "cat_speak":
      return "Preparando a fala…";
    // A ferramenta única (T14563): quando ela começa, o host só sabe o nome `kiwi`; a ação de dentro (ler, escrever…)
    // chega logo depois pelo próprio servidor, com o alvo.
    case "kiwi":
      return "Mexendo nas notas…";
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
  const kind = kindOf(s);
  const c = programOf(s);
  return !!c?.installed && (c.loggedIn || loginUnknown(c)) && c.versionOk && s.enabled && (!AGENTS[kind].adapter || s.adapter.phase === "ready");
}

/** O estado do programa do agente escolhido: o `claude` ou o `gemini` do status. */
export function programOf<C extends ProgramState>(s: { claude: C | null; kind?: AgentKind; gemini?: C | null }): C | null {
  return kindOf(s) === "gemini" ? (s.gemini ?? null) : s.claude;
}

/** O texto da tela "Antes de ligar o …" (ADR 0011, a seção "O texto da tela"), com o nome e a empresa do agente. */
/** `adapter`: o agente precisa do adaptador baixado (o Claude Code); o Gemini fala ACP sozinho, sem download. */
export function consentText(name: string, company = "Anthropic", adapter = true): { title: string; goes: string[]; never: string[]; who: string[] } {
  return {
    title: `Antes de ligar o ${name}`,
    goes: [
      "O que você pedir a ele. A sua voz vira texto aqui no Mac, e o áudio não vai.",
      "Os trechos das suas notas, reuniões e arquivos que ele ler para atender o pedido, e o que o Kiwi achou nas suas notas sobre o pedido.",
      "A transcrição de uma reunião que você gravou, quando ela termina, para ele preparar o resumo. Você aprova antes de entrar na nota, e pode desligar só isso em Ajustes › Agente.",
    ],
    never: [
      "O áudio do ditado e das reuniões.",
      "Nada enquanto ele estiver desligado.",
      "Senhas, tokens, credenciais e dados pessoais sensíveis: o Kiwi troca cada um por um marcador antes de o texto sair, e na dúvida também segura. Nenhum detector pega 100%.",
    ],
    who: [
      `O Kiwi conversa com o ${name} aqui no seu Mac. Quem manda para a nuvem é o ${name}, com a sua conta, e vale a política de dados da ${company}. O Kiwi não tem servidor e nunca vê a sua senha.`,
      ...(adapter ? [`Para conversar com o ${name}, o Kiwi baixa um adaptador agora. Nada seu vai junto.`] : []),
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
  const effort = "O esforço é o que você salvou para o modelo barato.";
  return s.economy
    ? `Ligado. ${what} ${effort} Trocar de modelo começa um cache novo, então o primeiro pedido depois gasta um pouco mais.`
    : `${what} ${effort} Trocar de modelo começa um cache novo.`;
}

/** "Pesquisar na web" (spec #11908): o rótulo e o que muda, ligado por padrão (spec #19273). */
export const WEB_LABEL = "Pesquisar na web";
export function webHint(s: Pick<AgentStatus, "webSearch"> & { name?: string }): string {
  const what = `Com a permissão, o texto do pedido pode virar uma busca na web, feita pelo ${s.name ?? "Claude Code"}, com o login dele. O Kiwi não chama nenhum serviço.`;
  return s.webSearch ? `Ligado. ${what} O balão mostra quando ele está na web.` : `Desligado: o Kiwi recusa a busca e a leitura de páginas do agente. ${what}`;
}

/** Falar com o Kiwi Cat (spec #9876; o atalho escolhido, #12946), em Ajustes › Agente. */
export const CONTROL_LABEL = "Falar com o Kiwi Cat";

/** "Mostrar o que eu falei" (spec #26055): desligado por padrão, o balão só abre com a resposta. */
export const SPOKEN_TEXT_LABEL = "Mostrar o que eu falei";
export const SPOKEN_TEXT_HINT = "Quando você fala com o Kiwi Cat, o balão mostra o que ele entendeu antes da resposta. Desligado, ele só abre com a resposta.";

/**
 * A dica da linha. `hold`: como a frase chama o atalho ("o Control", "⌃⌥Espaço"). `blocked`: o ditado está nas mesmas
 * teclas, e o do Kiwi Cat fica desligado. Com um Control, o aviso do Ditado da Apple, que em alguns Macs usa "pressionar
 * Control duas vezes": o Kiwi não mexe nos ajustes do sistema.
 */
export function controlHint(blocked: boolean, hold = "o Control", controlAlone = true): string {
  if (blocked) return `O ditado já usa ${hold} (Ajustes › Atalhos). Escolha outro atalho embaixo, ou troque o do ditado.`;
  const base = `Segure ${hold} para falar com o Kiwi Cat e solte para mandar. O microfone só abre enquanto você segura; o Esc cancela.`;
  // O aviso só vale para o Control sozinho: o Ditado da Apple não usa uma combinação.
  return controlAlone
    ? `${base} O ditado da Apple pode usar "pressionar Control duas vezes": troque em Ajustes do Sistema › Teclado › Ditado › Atalho.`
    : base;
}

/** A escolha do agente (spec #24666): o rótulo, as opções e a dica, que diz para onde o texto vai. */
export const KIND_LABEL = "Qual agente";
export const KIND_OPTIONS: { value: AgentKind; label: string }[] = [
  { value: "claude", label: AGENTS.claude.name },
  { value: "gemini", label: AGENTS.gemini.name },
];

export function kindHint(kind: AgentKind, enabled: boolean): string {
  const a = AGENTS[kind];
  const where = `O que você pedir vai para o ${a.name}, com a sua conta, e vale a política de dados da ${a.company}.`;
  return enabled ? `${where} Um agente por vez; trocar fecha o que está aberto e não mistura as conversas.` : `Desligado: nada vai para o ${a.name}. ${where}`;
}

/**
 * Trocar de agente mostra antes a tela "o que vai" do novo (spec #24666: trocar pede o clique da pessoa), porque o texto
 * passa a ir para outra empresa. O título e o botão dizem a troca.
 */
export function switchText(to: AgentKind): { title: string; yes: string } {
  return { title: `Trocar para o ${AGENTS[to].name}`, yes: `Trocar para o ${AGENTS[to].name}` };
}
