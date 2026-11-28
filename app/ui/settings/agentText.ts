// Os textos da seção Agente dos Ajustes (spec #8373, T8762), separados da tela para os testes lerem cada estado sem
// navegador. O nome do agente ("Claude Code") aparece só como texto, sem logo (ADR 0011).

import { AGENT_NAMES, EFFORT_ORDER } from "../../src/agent/kinds.ts";
import { formatNumber, type Locale, type TextKey, translate } from "../../src/shared/i18n/index.ts";
import type { AgentClaudeStatus, AgentKind, AgentModelChoice, AgentNoticeState, AgentStatus, AgentTurnEvent } from "../../src/shared/ui-contract.ts";

/** O tamanho do adaptador, para o texto antes do download (a lista fixa do #8368 soma uns 4,4 MB). */
export const ADAPTER_SIZE_LABEL = "4,4 MB";

const MB = (bytes: number, locale: Locale) => formatNumber(locale, bytes / 1e6, { maximumFractionDigits: 1 });
/** "4,4 MB" em português, "4.4 MB" em inglês. */
const sizeLabel = (locale: Locale) => translate(locale, "agent.adapter.mb", { mb: formatNumber(locale, 4.4) });
/** Tira o espaço duplo de uma versão que falta ("O Claude Code  é…"). */
const tidy = (s: string) => s.replace("  ", " ");

export type { AgentKind };

/**
 * O que muda de um agente para o outro na tela: o nome, a empresa (para onde o texto vai), como instalar, atualizar e
 * entrar na conta. O nome é o do motor (`AGENT_NAMES`), o mesmo das mensagens. O login é sempre do próprio agente,
 * no Terminal: o Kiwi nunca pede, lê nem guarda senha ou chave.
 */
export const AGENTS: Record<AgentKind, { name: string; company: string; install: TextKey; update: TextKey; login: TextKey; adapter: boolean }> = {
  claude: {
    name: AGENT_NAMES.claude,
    company: "Anthropic",
    install: "agent.claude.install",
    update: "agent.claude.update",
    login: "agent.claude.login",
    adapter: true,
  },
  gemini: {
    name: AGENT_NAMES.gemini,
    company: "Google",
    // O programa é o Antigravity CLI, o `agy` (spec #25046); o login é dele, no Terminal, nunca uma chave no Kiwi.
    install: "agent.gemini.install",
    update: "agent.gemini.update",
    login: "agent.gemini.login",
    adapter: false,
  },
};

/** O agente escolhido; um engine anterior ao Gemini não manda o `kind`, e é o Claude. */
export const kindOf = (s: { kind?: AgentKind } | null | undefined): AgentKind => (s?.kind === "gemini" ? "gemini" : "claude");

/** O comando que a pessoa roda no Terminal para entrar na conta: o login é do próprio Claude Code, nunca do Kiwi. */
export const LOGIN_HOW = translate("pt", AGENTS.claude.login);

/** A linha do Claude Code instalado (o onboarding usa esta): a de `agentLine` com o Claude. */
export function claudeLine(name: string, c: AgentClaudeStatus | null, locale: Locale = "pt"): { text: string; ok: boolean } {
  return agentLine("claude", name, c, locale);
}

/** O login ainda não conferido (`loginKnown: false`, o Gemini antes de a sessão abrir). */
export const loginUnknown = (c: ProgramState): boolean => c.loginKnown === false;

/** O pedaço do estado do programa que as linhas leem (o `claude` ou o `gemini` do status). */
export type ProgramState = Pick<AgentClaudeStatus, "installed" | "loggedIn" | "versionOk"> & { loginKnown?: boolean };

/** A linha do agente instalado: o que a pessoa tem, e o que fazer quando falta algo. */
export function agentLine(kind: AgentKind, name: string, c: AgentClaudeStatus | null, locale: Locale = "pt"): { text: string; ok: boolean } {
  const a = AGENTS[kind];
  const t = (key: TextKey, params?: Record<string, string>) => tidy(translate(locale, key, { name, version: c?.version ?? "", ...params }));
  if (!c) return { text: t("agent.line.checking"), ok: false };
  if (!c.installed) return { text: t("agent.line.missing", { install: translate(locale, a.install) }), ok: false };
  if (c.versionError === "E_AGENT_TOO_OLD") return { text: t("agent.line.tooOld", { update: translate(locale, a.update) }), ok: false };
  if (c.versionError === "E_AGENT_TOO_NEW") return { text: t("agent.line.tooNew"), ok: false };
  // O Gemini só diz o login quando a sessão abre (o `authRequired`): até lá, não se sabe, e o "Testar" fica liberado.
  if (loginUnknown(c)) return { text: t("agent.line.loginUnknown"), ok: true };
  if (!c.loggedIn) return { text: t("agent.line.loggedOut", { login: translate(locale, a.login) }), ok: false };
  // O Gemini não diz o jeito do login (o Kiwi só sabe pelo `authRequired`): nada além de "logado".
  const how = kind !== "claude" ? "" : c.method === "claude.ai" ? translate(locale, "agent.line.howClaude") : c.method ? translate(locale, "agent.line.howOther", { method: c.method }) : "";
  return { text: how ? t("agent.line.okHow", { how }) : t("agent.line.ok"), ok: true };
}

/** A linha do interruptor. */
export function switchHint(s: Pick<AgentStatus, "name" | "enabled" | "consented">, confirming = false, locale: Locale = "pt"): string {
  const key: TextKey = confirming ? "agent.switch.confirming" : s.enabled ? "agent.switch.on" : !s.consented ? "agent.switch.offFirst" : "agent.switch.off";
  return translate(locale, key, { name: s.name });
}

/** A linha do adaptador: falta baixar, baixando (com a porcentagem), pronto ou o erro do download. */
export function adapterLine(s: Pick<AgentStatus, "name" | "adapter">, locale: Locale = "pt"): string {
  const a = s.adapter;
  if (a.phase === "downloading") {
    const total = a.total ?? 0;
    const pct = total ? Math.floor(((a.done ?? 0) / total) * 100) : 0;
    const size = total ? translate(locale, "agent.adapter.mb", { mb: MB(total, locale) }) : sizeLabel(locale);
    return translate(locale, "agent.adapter.downloading", { pct: String(pct), size });
  }
  if (a.phase === "ready") return translate(locale, "agent.adapter.ready", { version: a.version ?? "", name: s.name });
  if (a.phase === "error" && a.error) {
    if (a.error.code === "E_ADAPTER_CANCELLED") return translate(locale, "agent.adapter.cancelled");
    return a.error.message;
  }
  return translate(locale, "agent.adapter.missing", { name: s.name, size: sizeLabel(locale) });
}

/** As escolhas do modelo: as que o agente ofereceu, ou só a atual enquanto ele não abriu nenhuma vez. */
export function modelOptions(s: Pick<AgentStatus, "name" | "model" | "models">, locale: Locale = "pt"): { value: string; label: string }[] {
  const byDefault = translate(locale, "agent.model.default", { name: s.name });
  const label = (m: AgentModelChoice) => (m.value === "default" ? byDefault : m.name);
  const out = s.models.map((m) => ({ value: m.value, label: label(m) }));
  if (!out.some((o) => o.value === s.model)) out.unshift({ value: s.model, label: s.model === "default" ? byDefault : s.model });
  return out;
}

/**
 * O que o Claude Code diz de cada modelo, em português (spec #16793). Em inglês (T29271), a frase dele fica como veio. Ele manda em inglês ("Opus 5 · Legacy"): cada
 * pedaço entre "·" vira a tradução daqui, um nome de modelo fica como está, e o resto sai, para a linha não misturar
 * as duas línguas. As frases são as do Claude Code de hoje; uma nova cai fora até entrar aqui.
 */
const MODEL_ABOUT: Record<string, string> = {
  "most efficient for simpler tasks": "o mais econômico, para tarefas simples", // i18n-ok: a tradução para o português, usada só com o app em pt
  "fastest for quick answers": "o mais rápido, para respostas curtas", // i18n-ok: a tradução para o português, usada só com o app em pt
  "for complex work and everyday tasks": "para trabalho complexo e o dia a dia",
  "best for everyday, complex tasks": "o melhor para o dia a dia e tarefas complexas",
  "most capable for complex work": "o mais capaz, para trabalho complexo",
  "can think for more complex tasks": "pensa mais, para tarefas complexas",
  "previous opus version": "a versão anterior do Opus", // i18n-ok: a tradução para o português, usada só com o app em pt
  legacy: "versão antiga", // i18n-ok: a tradução para o português, usada só com o app em pt
  recommended: "recomendado",
  "1m context": "contexto de 1M",
  "1m context window": "contexto de 1M",
};
const MODEL_NAME = /^(claude\s+)?(opus|sonnet|haiku|fable)(\s+[\d.]+)?(\s*\[1m\])?$/i;

export function modelAbout(description: string | undefined, locale: Locale = "pt"): string {
  if (!description) return "";
  const parts: string[] = [];
  for (const piece of description.split(/\s+[·\u00b7]\s+|\s+[-–—]\s+/)) {
    const t = piece.trim().replace(/\.$/, "");
    const known = MODEL_ABOUT[t.toLowerCase()] !== undefined;
    const pt = known ? (locale === "pt" ? MODEL_ABOUT[t.toLowerCase()] : t) : undefined;
    if (pt) parts.push(parts.length ? pt : pt[0]!.toUpperCase() + pt.slice(1));
    else if (MODEL_NAME.test(t)) parts.push(t);
  }
  return parts.join(" · ");
}

export function modelHint(s: Pick<AgentStatus, "model" | "models">, locale: Locale = "pt"): string {
  const base = translate(locale, "agent.model.costs");
  if (!s.models.length) return `${base} ${translate(locale, "agent.model.listLater")}`;
  // O que o agente diz do escolhido (no "default", o modelo que ele usa de fato), antes do aviso, na língua do app.
  const about = modelAbout(s.models.find((m) => m.value === s.model)?.description, locale);
  return about ? `${about}. ${base}` : base;
}

/** Os nomes dos esforços (spec #16793); um que o Kiwi não conhece fica com o nome que o agente deu. */
const EFFORT_KEYS: Record<string, TextKey> = {
  default: "agent.effort.default",
  low: "agent.effort.low",
  medium: "agent.effort.medium",
  high: "agent.effort.high",
  xhigh: "agent.effort.xhigh",
  max: "agent.effort.max",
};
/** O nome do esforço na língua, ou `undefined` quando o Kiwi não o conhece. */
export const effortLabel = (value: string, locale: Locale = "pt"): string | undefined => {
  const key = EFFORT_KEYS[value];
  return key ? translate(locale, key) : undefined;
};
/** Os nomes em português (os testes e quem ainda lê a tabela). */
export const EFFORT_NAMES: Record<string, string> = Object.fromEntries(Object.keys(EFFORT_KEYS).map((v) => [v, effortLabel(v)!]));

/** O que o onboarding sabe da sessão aberta sem pedido: abrindo, aberta ou não deu. */
export type Prepare = "opening" | "ready" | "failed";

/**
 * A frase do Esforço antes de o agente dizer as opções do modelo: no onboarding, e em Ajustes (`settings`, T25729), onde
 * a pessoa já está no lugar de trocar.
 */
export function prepareHint(prepare: Prepare, name = "Claude Code", settings = false, locale: Locale = "pt"): string {
  const key: TextKey = prepare === "opening" ? "agent.prepare.opening" : settings ? "agent.prepare.failedSettings" : "agent.prepare.failed";
  return translate(locale, key, { name });
}

/**
 * As escolhas do Esforço para o modelo escolhido (spec #16793): as que o agente ofereceu nele, em português, e sempre o
 * "Padrão" (o host leva o `default` ao esforço que o próprio agente pôs no modelo, quando ele não oferece o valor).
 * `null` quando o Kiwi ainda não viu esse modelo numa sessão; `[]` quando ele não tem esforço. Um esforço salvo que o
 * modelo não tem não entra: ele não vale (revisão #17024), e o `effortValue` mostra o que vale.
 */
export function effortOptions(s: Pick<AgentStatus, "model" | "efforts">, locale: Locale = "pt"): { value: string; label: string }[] | null {
  // Um engine anterior ao 1.82.0 não manda os esforços (o `requiresContract` da UI é ^1.0.0): sem a lista, sem o seletor.
  const known = s.efforts?.[s.model];
  if (!known) return null;
  if (!known.length) return [];
  const out = known.map((m) => ({ value: m.value, label: effortLabel(m.value, locale) ?? m.name }));
  if (!out.some((o) => o.value === "default")) out.unshift({ value: "default", label: effortLabel("default", locale)! });
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

export function effortHint(s: Pick<AgentStatus, "name" | "model" | "effort" | "efforts" | "economy" | "session">, locale: Locale = "pt"): string {
  const t = (key: TextKey, params?: Record<string, string>) => translate(locale, key, params);
  const effortName = (v: string) => effortLabel(v, locale) ?? v;
  const options = effortOptions(s, locale);
  if (options === null) return t("agent.effort.later");
  if (!options.length) {
    // Nenhum modelo já visto deste agente tem esforço (T25553): é o agente que não deixa escolher, não só este modelo.
    if (Object.values(s.efforts ?? {}).every((e) => !e.length)) return t("agent.effort.agentDecides", { name: s.name });
    return t("agent.effort.none");
  }
  const what = t("agent.effort.what");
  const shown = effortValue(s);
  const missing = shown !== s.effort ? ` ${t("agent.effort.missing", { saved: effortName(s.effort), shown: effortName(shown) })}` : "";
  // O Padrão pede o nível mais baixo do modelo (spec #19273, harry #19294), quando o modelo tem um dos níveis que o host
  // conhece (o `EFFORT_ORDER`). Sem nenhum, o host deixa o esforço com que o agente abriu: a frase não promete o mais
  // baixo (T25729, lead #25744).
  const known = options.some((o) => (EFFORT_ORDER as readonly string[]).includes(o.value));
  const lowest = shown !== "default" ? "" : known ? ` ${t("agent.effort.lowest")}` : ` ${t("agent.effort.agentPicks", { name: s.name })}`;
  const economy = s.economy ? ` ${t("agent.effort.economy")}` : "";
  return `${what}${lowest}${missing}${economy}`;
}

/**
 * O status de uma ferramenta em uso. As do Kiwi dizem o que foi lido ou procurado ("Lendo Projetos/Kiwi.md…", spec
 * #7496) e o que foi escrito ("Escrevendo em Projetos/Kiwi.md…", spec #8356); as outras, o nome.
 */
/** As chaves de cada ferramenta: com o alvo e sem ele. */
const TOOL_KEYS: Record<string, [TextKey, TextKey]> = {
  notes_search: ["agent.tool.search", "agent.tool.searchAny"],
  notes_outline: ["agent.tool.outline", "agent.tool.outlineAny"],
  notes_read: ["agent.tool.read", "agent.tool.readAny"],
  notes_list: ["agent.tool.list", "agent.tool.listAny"],
  meetings_list: ["agent.tool.meetings", "agent.tool.meetings"],
  meetings_get: ["agent.tool.meeting", "agent.tool.meetingAny"],
  projects_list: ["agent.tool.projects", "agent.tool.projects"],
  project_status: ["agent.tool.project", "agent.tool.projectAny"],
  notes_create: ["agent.tool.create", "agent.tool.createAny"],
  notes_append: ["agent.tool.append", "agent.tool.appendAny"],
  notes_write: ["agent.tool.write", "agent.tool.writeAny"],
  // Só a diferença (T14650): um trecho, ou a estrutura da nota.
  notes_edit: ["agent.tool.edit", "agent.tool.editAny"],
  notes_section_move: ["agent.tool.sections", "agent.tool.sectionsAny"],
  notes_section_rename: ["agent.tool.sections", "agent.tool.sectionsAny"],
  notes_section_merge: ["agent.tool.sections", "agent.tool.sectionsAny"],
  project_diary_add: ["agent.tool.diary", "agent.tool.diary"],
  // A fala do gato (T26709): o agente escreveu o que a pessoa vai ouvir.
  cat_speak: ["agent.tool.speak", "agent.tool.speak"],
  // A ferramenta única (T14563): quando ela começa, o host só sabe o nome `kiwi`; a ação de dentro (ler, escrever…)
  // chega logo depois pelo próprio servidor, com o alvo.
  kiwi: ["agent.tool.kiwi", "agent.tool.kiwi"],
  // A web do agente (spec #11908): ele saiu do cofre para buscar ou ler uma página.
  web: ["agent.tool.web", "agent.tool.web"],
};

export function toolStatus(tool: string, target?: string, locale: Locale = "pt"): string {
  const keys = TOOL_KEYS[tool];
  if (!keys) return translate(locale, "agent.tool.other", { tool });
  return target ? translate(locale, keys[0], { target }) : translate(locale, keys[1]);
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
export function applyTurn(t: TestState, e: AgentTurnEvent, name: string, locale: Locale = "pt"): TestState {
  const tr = (key: TextKey, params?: Record<string, string>) => translate(locale, key, params);
  if (t.id && e.id !== t.id) return t;
  // Sem pedido próprio ainda, só o `started` entra (ele traz o id): um evento atrasado de um pedido antigo, de antes do
  // Desligar, não pode sujar o teste parado (revisão do T8762).
  if (!t.id && e.type !== "started") return t;
  switch (e.type) {
    case "started":
      return { id: e.id, phase: "running", status: tr("agent.turn.sending"), text: "" };
    case "status":
      if (e.status === "opening") return { ...t, status: tr("agent.turn.opening", { name }) };
      if (e.status === "thinking") return { ...t, status: tr("agent.turn.thinking") };
      // A pergunta na dúvida (spec #9873): o pedido espera a pessoa responder no cartão.
      if (e.status === "waiting") return { ...t, status: waitingStatus("target" in e ? e.target : undefined, locale) };
      return { ...t, status: "tool" in e ? toolStatus(e.tool, e.target, locale) : tr("agent.tool.any") };
    case "permission":
      return { ...t, status: tr("agent.turn.refused", { tool: e.tool }) };
    // A fala do `cat_speak` (spec #27881) é o resumo do balão; o "Testar" mostra a resposta inteira.
    case "speech":
      return t;
    case "limit":
      // O limite (spec #11084) aparece no balão e no medidor; o "Testar" mostra o erro, que vem logo depois.
      return t;
    case "text":
      return { ...t, status: tr("agent.turn.answering"), text: t.text + e.text };
    case "done":
      if (e.stopReason === "cancelled") return { ...t, phase: "cancelled", status: tr("agent.turn.cancelled") };
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
export function consentText(name: string, company = "Anthropic", adapter = true, locale: Locale = "pt"): { title: string; goes: string[]; never: string[]; who: string[] } {
  const t = (key: TextKey) => translate(locale, key, { name, company });
  return {
    title: t("agent.consent.title"),
    goes: [t("agent.consent.goes1"), t("agent.consent.goes2"), t("agent.consent.goes3")],
    never: [t("agent.consent.never1"), t("agent.consent.never2"), t("agent.consent.never3")],
    who: [t("agent.consent.who1"), ...(adapter ? [t("agent.consent.who2")] : []), t("agent.consent.who3")],
  };
}

/**
 * A dica do "Testar": o agente lê as notas e as reuniões (spec #7496) e pode mudar as notas (spec #8356), com o texto de
 * antes guardado nas Versões da nota. Com o guardrail (spec #9818), as senhas e os tokens ficam de fora.
 */
export const TEST_HINT = translate("pt", "agent.test.hint");

/** O status do pedido que espera a resposta da dúvida (spec #9873): "Esperando você: dúvida em Projetos/Kiwi". */
export function waitingStatus(target?: string, locale: Locale = "pt"): string {
  if (target === undefined || target === "") return translate(locale, "agent.waiting.any");
  return translate(locale, "agent.waiting.in", { target: target.replace(/\.md$/i, "") });
}

/** A linha do aviso (spec #9839): o rótulo, e o que explica cada estado da permissão de notificar. */
export const NOTICE_LABEL = translate("pt", "agent.notice.label");

export function noticeHint(s: AgentNoticeState, asking: boolean, locale: Locale = "pt"): string {
  const t = (key: TextKey) => translate(locale, key);
  if (s.permission === "unavailable") return t("agent.notice.unavailable");
  if (s.permission === "denied") return t("agent.notice.denied");
  if (s.permission === "notDetermined") return asking ? t("agent.notice.asking") : `${t("agent.notice.what")} ${t("agent.notice.askOnce")}`;
  return s.enabled ? t("agent.notice.what") : t("agent.notice.off");
}

/** O modo econômico (spec #11084): o rótulo e o que ele faz, com o aviso do cache. */
export const ECONOMY_LABEL = translate("pt", "agent.economy.label");
export function economyHint(s: Pick<AgentStatus, "economy">, locale: Locale = "pt"): string {
  const t = (key: TextKey) => translate(locale, key);
  const body = `${t("agent.economy.what")} ${t("agent.economy.effort")}`;
  return s.economy ? `${t("agent.on")} ${body} ${t("agent.economy.cacheOn")}` : `${body} ${t("agent.economy.cache")}`;
}

/** "Pesquisar na web" (spec #11908): o rótulo e o que muda, ligado por padrão (spec #19273). */
export const WEB_LABEL = translate("pt", "agent.web.label");
export function webHint(s: Pick<AgentStatus, "webSearch"> & { name?: string }, locale: Locale = "pt"): string {
  const t = (key: TextKey) => translate(locale, key, { name: s.name ?? "Claude Code" });
  return s.webSearch ? `${t("agent.on")} ${t("agent.web.what")} ${t("agent.web.on")}` : `${t("agent.web.off")} ${t("agent.web.what")}`;
}

/** Falar com o Kiwi Cat (spec #9876; o atalho escolhido, #12946), em Ajustes › Agente. */
export const CONTROL_LABEL = translate("pt", "agent.control.label");

/** "Mostrar o que eu falei" (spec #26055): ligado por padrão desde o spec #32534; o balão mostra a fala até a resposta. */
export const SPOKEN_TEXT_LABEL = translate("pt", "agent.spoken.label");
export const SPOKEN_TEXT_HINT = translate("pt", "agent.spoken.hint");

/**
 * A dica da linha. `hold`: como a frase chama o atalho ("o Control", "⌃⌥Espaço"). `blocked`: o ditado está nas mesmas
 * teclas, e o do Kiwi Cat fica desligado. Com um Control, o aviso do Ditado da Apple, que em alguns Macs usa "pressionar
 * Control duas vezes": o Kiwi não mexe nos ajustes do sistema.
 */
export function controlHint(blocked: boolean, hold?: string, controlAlone = true, locale: Locale = "pt"): string {
  const h = hold ?? translate(locale, "agent.control.theControl");
  if (blocked) return translate(locale, "agent.control.blocked", { hold: h });
  const base = translate(locale, "agent.control.hold", { hold: h });
  // O aviso só vale para o Control sozinho: o Ditado da Apple não usa uma combinação.
  return controlAlone ? `${base} ${translate(locale, "agent.control.apple")}` : base;
}

/** A escolha do agente (spec #24666): o rótulo, as opções e a dica, que diz para onde o texto vai. */
export const KIND_LABEL = translate("pt", "agent.kind.label");
export const KIND_OPTIONS: { value: AgentKind; label: string }[] = [
  { value: "claude", label: AGENTS.claude.name },
  { value: "gemini", label: AGENTS.gemini.name },
];

export function kindHint(kind: AgentKind, enabled: boolean, locale: Locale = "pt"): string {
  const a = AGENTS[kind];
  const t = (key: TextKey) => translate(locale, key, { name: a.name, company: a.company });
  return enabled ? `${t("agent.kind.where")} ${t("agent.kind.on")}` : `${t("agent.kind.off")} ${t("agent.kind.where")}`;
}

/**
 * Trocar de agente mostra antes a tela "o que vai" do novo (spec #24666: trocar pede o clique da pessoa), porque o texto
 * passa a ir para outra empresa. O título e o botão dizem a troca.
 */
export function switchText(to: AgentKind, locale: Locale = "pt"): { title: string; yes: string } {
  const text = translate(locale, "agent.kind.switch", { name: AGENTS[to].name });
  return { title: text, yes: text };
}
