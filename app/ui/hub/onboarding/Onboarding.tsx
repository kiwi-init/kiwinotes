// O onboarding do agente (spec #11955, T11993): na primeira vez que o agente liga, uma sequência de passos com o
// Kiwi-cat grande no topo, por cima do hub inteiro (sem janela nova, ok do lead no #12007). Um passo por vez, cada um
// com "Pular". O que a pessoa escolhe vai direto para o lugar de sempre; aqui só fica o passo, nos ajustes do agente.
// Fechar no meio termina o onboarding com o que já foi escolhido; "Refazer o onboarding" em Ajustes › Agente abre de novo.
import "./onboarding.css";

import { useEffect, useRef, useState } from "react";

import type { AgentChangeView, AgentStatus, AppSettings } from "../../../src/shared/ui-contract.ts";
import { catColorHex, catColorOptions } from "../../../src/shared/kiwicat-colors.ts";
import { api, has } from "../../src/api.ts";
import { Button, Kbd, Segmented, Select } from "../../src/kit/index.tsx";
import { shortcutLabel } from "../../../src/shared/shortcuts.ts";
import { ViewPanel } from "../../settings/AgentActivity.tsx";
import { ControlRow } from "../../settings/ControlRow.tsx";
import { CatColorRow } from "../../settings/CatRow.tsx";
import { NoteModelEditor } from "../../settings/NoteModel.tsx";
import { adapterLine, applyTurn, claudeLine, IDLE_TEST, type TestState } from "../../settings/agentText.ts";
import type { createKiwiCat } from "../../kiwicat/cat.ts";
import { CatActivity } from "../cat-state.ts";
import {
  canLeaveClaude,
  controlLine,
  controlStep,
  type ControlPhase,
  type Tone,
  toneExample,
  toneOf,
  withTone,
  magicCandidates,
  magicRequest,
  projectCandidates,
  progressLine,
  projectsSummary,
  shortcutSummary,
  STEP_COUNT,
  holdName,
  stepAt,
  stepText,
  toneSummary,
} from "./onboardingText.ts";

type Cat = Awaited<ReturnType<typeof createKiwiCat>>;

/** O oi do passo 1: o mesmo "Testar" de Ajustes › Agente. */
export const HELLO = "Diga oi em uma frase.";
/** Quantas vezes (uma por segundo) o oi espera o agente ocupado com outra coisa. */
const HELLO_WAIT_TRIES = 30;

const theme = (): "light" | "dark" => (document.documentElement.dataset.theme === "light" ? "light" : "dark");

/** O gato grande do topo: segue os pedidos (acordou → thinking → pronto), na cor escolhida. */
function BigCat({ cor, reduced }: { cor: string; reduced: boolean }) {
  const root = useRef<HTMLDivElement>(null);
  const handle = useRef<Cat | undefined>(undefined);
  const corRef = useRef(cor);
  corRef.current = cor;
  const reducedRef = useRef(reduced);
  reducedRef.current = reduced;
  useEffect(() => handle.current?.update({ cor }), [cor]);
  useEffect(() => handle.current?.update({ parado: reduced }), [reduced]);
  useEffect(() => {
    const el = root.current!;
    let gone = false;
    let cat: Cat | undefined;
    const activity = new CatActivity(false);
    const show = () => {
      if (!cat) return;
      cat.update({ estado: activity.state });
      el.dataset.state = cat.visualState;
    };
    void (async () => {
      try {
        const { createKiwiCat } = await import("../../kiwicat/cat.ts");
        if (gone) return;
        const next = await createKiwiCat(el, {
          mode: "runtime",
          width: 160,
          height: 200,
          cutout: true,
          background: theme(),
          inputs: { estado: "acordou", cor: corRef.current, voz: null, parado: reducedRef.current },
        });
        if (gone) return void (await next.dispose());
        cat = next;
        handle.current = next;
        el.dataset.ready = "true";
        show();
      } catch {
        el.replaceChildren();
      }
    })();
    const off = api.agent.onTurn((e) => {
      const before = activity.state;
      activity.event(e);
      if (activity.state !== before) show();
    });
    return () => {
      gone = true;
      off();
      void cat?.dispose();
      handle.current = undefined;
    };
  }, []);
  return <div className="kn-onb-cat" ref={root} aria-hidden="true" />;
}

/**
 * Manda um pedido e devolve o id. Logo depois do download, o medidor de Ajustes confere o uso (um pedido interno,
 * `agent.usageRefresh`): o pedido espera ele acabar, em vez de falhar com "ainda está respondendo".
 */
async function askWhenFree(text: string, onWait: () => void): Promise<string> {
  for (let tries = 0; ; tries++) {
    try {
      return (await api.agent.ask(text)).id;
    } catch (e) {
      if ((e as { code?: string })?.code !== "E_AGENT_BUSY" || tries >= HELLO_WAIT_TRIES) throw e;
      onWait();
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
}

/** Passo 1: o Claude Code instalado e logado, a ponte baixada no clique, e um oi para testar. */
function ClaudeStep({ status }: { status: AgentStatus }) {
  const [checking, setChecking] = useState(false);
  const [test, setTest] = useState<TestState>(IDLE_TEST);
  const [failure, setFailure] = useState<string | null>(null);
  useEffect(() => api.agent.onTurn((e) => setTest((t) => applyTurn(t, e, status.name))), [status.name]);
  const claude = claudeLine(status.name, status.claude);
  const phase = status.adapter.phase;
  const call = (fn: () => Promise<unknown>) => {
    setFailure(null);
    return fn().catch((e: unknown) => setFailure(e instanceof Error ? e.message : String(e)));
  };
  const check = async () => {
    setChecking(true);
    await call(() => api.agent.status(true));
    setChecking(false);
  };
  const hello = async () => {
    setTest({ ...IDLE_TEST, phase: "running", status: "Mandando o oi…" });
    try {
      const id = await askWhenFree(HELLO, () => setTest((t) => ({ ...t, status: `Esperando o ${status.name}…` })));
      setTest((t) => (t.id ? t : { ...t, id }));
    } catch (e) {
      const code = (e as { code?: string })?.code ?? "E_AGENT_FAILED";
      setTest({ ...IDLE_TEST, phase: "error", error: { code, message: e instanceof Error ? e.message : String(e) } });
    }
  };
  const ready = canLeaveClaude(status);
  return (
    <div className="kn-onb-checks">
      <div className="kn-onb-check" data-ok={claude.ok}>
        <span className="kn-onb-check-text">{claude.text}</span>
        {!claude.ok ? <Button onClick={() => void check()} disabled={checking}>{checking ? "Conferindo…" : "Conferir de novo"}</Button> : null}
      </div>
      <div className="kn-onb-check" data-ok={phase === "ready"}>
        <span className="kn-onb-check-text">{adapterLine(status)}</span>
        {phase === "missing" || phase === "error" ? (
          <Button variant="primary" onClick={() => void call(() => api.agent.download())} disabled={!claude.ok}>
            {phase === "error" ? "Tentar de novo" : "Baixar"}
          </Button>
        ) : null}
      </div>
      <div className="kn-onb-check" data-ok={test.phase === "done"}>
        <span className="kn-onb-check-text">{test.phase === "done" ? "O Claude Code respondeu." : "Mande um oi para testar."}</span>
        <Button onClick={() => void hello()} disabled={!ready || test.phase === "running"}>
          {test.phase === "running" ? "Esperando…" : "Mandar um oi"}
        </Button>
      </div>
      {test.text ? <p className="kn-onb-answer">{test.text}</p> : null}
      {test.phase === "running" && test.status ? <p className="kn-onb-status">{test.status}</p> : null}
      {test.error ? <p className="kn-onb-failure" role="alert">{test.error.message}</p> : null}
      {failure ? <p className="kn-onb-failure" role="alert">{failure}</p> : null}
    </div>
  );
}

/**
 * Passo 2: "aperta o Control e fala oi". A pessoa liga o atalho (a linha de Ajustes, a mesma) e aprende fazendo: a frase
 * segue a fala (`agent.voice`) e a resposta (`agent.turn`). O microfone só abre enquanto ela segura o Control.
 */
function ControlStep({ status, onStatus, settings }: { status: AgentStatus; onStatus(s: AgentStatus): void; settings: AppSettings }) {
  const hold = holdName(settings.shortcuts.agent);
  const [phase, setPhase] = useState<ControlPhase>({ phase: "waiting" });
  useEffect(() => {
    const offVoice = api.agent.onVoice((voice) => setPhase((s) => controlStep(s, { voice })));
    const offTurn = api.agent.onTurn((turn) => setPhase((s) => controlStep(s, { turn })));
    return () => {
      offVoice();
      offTurn();
    };
  }, []);
  return (
    <div className="kn-onb-control">
      <div className="kn-onb-row">
        <ControlRow status={status} onStatus={onStatus} />
      </div>
      {status.controlShortcut ? (
        <p className="kn-onb-try" data-phase={phase.phase} aria-live="polite">
          {phase.phase === "waiting" ? <Kbd>{shortcutLabel(settings.shortcuts.agent ?? "control")}</Kbd> : null}
          <span>{controlLine(phase, hold)}</span>
        </p>
      ) : (
        <p className="kn-onb-status">Ligue o atalho para testar. Se preferir digitar, pode pular: o gato também ouve pelo clique.</p>
      )}
    </div>
  );
}

/**
 * Passo 3: o jeito de falar. Curto ou detalhado, informal ou formal; a resposta de exemplo é fixa, do próprio Kiwi (sem
 * pedido), e muda na hora. A escolha vira uma linha das instruções do agente; as outras linhas da pessoa ficam.
 */
function ToneStep({ status, onStatus }: { status: AgentStatus; onStatus(s: AgentStatus): void }) {
  const [tone, setTone] = useState<Tone>(() => toneOf(status.instructions));
  const [failure, setFailure] = useState<string | null>(null);
  const choose = (next: Tone) => {
    setTone(next);
    setFailure(null);
    api.agent.configure({ instructions: withTone(status.instructions, next) }).then(onStatus, (e: unknown) => setFailure(e instanceof Error ? e.message : String(e)));
  };
  return (
    <div className="kn-onb-tone">
      <div className="kn-onb-tone-pick">
        <Segmented
          label="Tamanho das respostas"
          value={tone.length}
          options={[
            { value: "curto", label: "Curto" },
            { value: "detalhado", label: "Detalhado" },
          ]}
          onChange={(length) => choose({ ...tone, length })}
        />
        <Segmented
          label="Tom"
          value={tone.register}
          options={[
            { value: "informal", label: "Informal" },
            { value: "formal", label: "Formal" },
          ]}
          onChange={(register) => choose({ ...tone, register })}
        />
      </div>
      <p className="kn-onb-ask">O que tem de novo no projeto?</p>
      <p className="kn-onb-answer" aria-live="polite">{toneExample(tone)}</p>
      <p className="kn-onb-status">Um exemplo do Kiwi, sem gastar pedido. Fica nas instruções, em Ajustes › Agente.</p>
      {failure ? <p className="kn-onb-failure" role="alert">{failure}</p> : null}
    </div>
  );
}

/**
 * Passo 4: o guardrail na prática. O que a pessoa escreve passa pelo filtro local (`agent.guardPreview`) e volta com o
 * segredo trocado pelo marcador, na hora. Nada vai ao agente.
 */
export const GUARD_EXAMPLE = "a senha do servidor é abc123";
function GuardStep() {
  const [text, setText] = useState(GUARD_EXAMPLE);
  const [seen, setSeen] = useState<{ text: string; held: number } | null>(null);
  useEffect(() => {
    let alive = true;
    const t = setTimeout(() => {
      api.agent.guardPreview(text).then(
        (r) => alive && setSeen(r),
        () => alive && setSeen(null),
      );
    }, 120);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [text]);
  const parts = seen ? seen.text.split(/(‹segredo [^›\n]{0,40}›)/) : [];
  return (
    <div className="kn-onb-guard">
      <label className="kn-onb-label" htmlFor="kn-onb-guard-input">
        Você escreve
      </label>
      <input id="kn-onb-guard-input" className="kn-input" value={text} maxLength={300} onChange={(e) => setText(e.target.value)} />
      <div className="kn-onb-label">O agente recebe</div>
      <p className="kn-onb-seen" aria-live="polite">
        {parts.map((p, i) => (i % 2 ? <mark key={i} className="kn-onb-marker">{p}</mark> : <span key={i}>{p}</span>))}
      </p>
      <p className="kn-onb-status">
        {seen && seen.held > 0
          ? "O Kiwi trocou o segredo antes de qualquer coisa sair do Mac. O original fica aqui, e volta só na nota de onde saiu."
          : "Sem segredo, o texto vai como está."}
      </p>
    </div>
  );
}

/**
 * Passo 6: os projetos. As pastas de primeiro nível do cofre (só os nomes, lidos no Mac, sem mandar nada) e uma caixa
 * para cada; marcar e desmarcar são as mesmas ações da barra lateral das Notas (#9874).
 */
function ProjectsStep({ settings }: { settings: AppSettings }) {
  const [folders, setFolders] = useState<string[] | null>(null);
  const [marked, setMarked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    // Só os nomes das pastas (spec #12918): o `notes.list` mandava o cofre inteiro para a tela a cada recarga.
    const folderNames = () => (has("notes.folders") ? api.notes.folders() : api.notes.list());
    const load = () =>
      Promise.all([folderNames(), api.projects.list()]).then(
        ([n, p]) => {
          if (!alive) return;
          setFolders(projectCandidates(n.folders, [p.meetingsFolder, settings.templatesFolder, settings.dailyFolder, settings.attachmentsFolder]));
          setMarked(new Set(p.projects.map((x) => x.folder)));
        },
        (e: unknown) => alive && setFailure(e instanceof Error ? e.message : String(e)),
      );
    void load();
    const off = api.projects.onChanged(() => void load());
    return () => {
      alive = false;
      off();
    };
  }, [settings.templatesFolder, settings.dailyFolder, settings.attachmentsFolder]);
  const set = (folder: string, on: boolean) =>
    setMarked((m) => {
      const next = new Set(m);
      if (on) next.add(folder);
      else next.delete(folder);
      return next;
    });
  // A caixa muda no clique (spec #12918), sem esperar o Kiwi criar a nota principal; se ele não conseguir, ela volta.
  const toggle = async (folder: string, on: boolean) => {
    set(folder, on);
    setBusy(folder);
    setFailure(null);
    try {
      await (on ? api.projects.mark(folder) : api.projects.unmark(folder));
    } catch (e) {
      set(folder, !on);
      setFailure(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };
  if (folders === null) return failure ? <p className="kn-onb-failure" role="alert">{failure}</p> : null;
  return (
    <div className="kn-onb-projects">
      {folders.length ? (
        <ul className="kn-onb-folders" aria-label="As pastas do cofre">
          {folders.map((f) => (
            <li key={f}>
              <label className="kn-onb-folder">
                <input type="checkbox" checked={marked.has(f)} disabled={busy === f} onChange={(e) => void toggle(f, e.target.checked)} />
                <span>{f}</span>
              </label>
            </li>
          ))}
        </ul>
      ) : (
        <p className="kn-onb-status">O cofre ainda não tem pastas. Dá para marcar um projeto depois, na barra lateral das Notas.</p>
      )}
      <p className="kn-onb-status">Uma pasta marcada ganha uma nota principal, se ainda não tiver. Nenhuma outra nota muda.</p>
      {failure ? <p className="kn-onb-failure" role="alert">{failure}</p> : null}
    </div>
  );
}

type Magic =
  | { phase: "pick" }
  | { phase: "running"; id: string | null }
  | { phase: "review"; id: string; view: AgentChangeView }
  | { phase: "kept" }
  | { phase: "undone" }
  | { phase: "none"; text: string }
  | { phase: "error"; message: string };

/**
 * Passo 8, opcional: o momento mágico. A pessoa escolhe UMA nota, e só com o clique dela o agente a organiza no Modelo
 * (o único pedido do onboarding, e a tela diz que gasta do plano). A escrita é a de sempre (o texto de antes nas Versões
 * e na Atividade); a tela mostra o antes e o depois, com [Manter] e [Desfazer] (o desfazer do pedido).
 */
function MagicStep({ status, settings }: { status: AgentStatus; settings: AppSettings }) {
  const [notes, setNotes] = useState<string[] | null>(null);
  const [path, setPath] = useState("");
  const [magic, setMagic] = useState<Magic>({ phase: "pick" });
  const [waiting, setWaiting] = useState(false);
  const current = useRef<string | null>(null);
  useEffect(() => {
    let alive = true;
    void Promise.all([api.notes.list(), api.projects.list()]).then(
      ([n, p]) => {
        if (!alive) return;
        const list = magicCandidates(n.notes, [p.meetingsFolder, settings.templatesFolder]);
        setNotes(list);
        const main = p.projects.map((x) => x.main).find((m): m is string => !!m && list.includes(m));
        setPath(main ?? list[0] ?? "");
      },
      () => alive && setNotes([]),
    );
    return () => {
      alive = false;
    };
  }, [settings.templatesFolder]);
  // O fim do pedido: a mudança dele vem da Atividade, com o antes e o depois.
  useEffect(
    () =>
      api.agent.onTurn((e) => {
        if (!current.current || e.id !== current.current) return;
        if (e.type === "error") return setMagic({ phase: "error", message: e.message });
        if (e.type !== "done") return;
        const id = e.id;
        void (async () => {
          try {
            const r = (await api.agent.activity(10)).requests.find((x) => x.id === id);
            if (!r?.changes.length) return setMagic({ phase: "none", text: e.text });
            setMagic({ phase: "review", id, view: await api.agent.change(id, 1) });
          } catch (err) {
            setMagic({ phase: "error", message: err instanceof Error ? err.message : String(err) });
          }
        })();
      }),
    [],
  );
  const run = async () => {
    setMagic({ phase: "running", id: null });
    try {
      const id = await askWhenFree(magicRequest(path), () => setWaiting(true));
      current.current = id;
      setWaiting(false);
      setMagic((m) => (m.phase === "running" ? { phase: "running", id } : m));
    } catch (e) {
      setMagic({ phase: "error", message: e instanceof Error ? e.message : String(e) });
    }
  };
  const undo = async (id: string) => {
    try {
      await api.agent.undo(id);
      setMagic({ phase: "undone" });
    } catch (e) {
      setMagic({ phase: "error", message: e instanceof Error ? e.message : String(e) });
    }
  };
  if (notes === null) return null;
  if (!notes.length) return <p className="kn-onb-status">Ainda não há notas para organizar. Dá para pular: o agente organiza quando você pedir.</p>;
  return (
    <div className="kn-onb-magic">
      {magic.phase === "pick" || magic.phase === "error" ? (
        <>
          <div className="kn-onb-magic-pick">
            <Select label="A nota para organizar" value={path} options={notes.map((n) => ({ value: n, label: n.replace(/\.md$/, "") }))} onChange={setPath} />
            <Button variant="primary" onClick={() => void run()} disabled={!path || !status.enabled}>
              Organizar esta nota
            </Button>
          </div>
          <p className="kn-onb-status">
            Isto manda um pedido ao {status.name} e gasta do seu plano. É o único passo que fala com ele. O texto de antes fica nas Versões da nota.
          </p>
          {magic.phase === "error" ? <p className="kn-onb-failure" role="alert">{magic.message}</p> : null}
        </>
      ) : magic.phase === "running" ? (
        <p className="kn-onb-status" aria-live="polite">{waiting ? `Esperando o ${status.name}…` : `O ${status.name} está organizando ${path.replace(/\.md$/, "")}…`}</p>
      ) : magic.phase === "review" ? (
        <>
          <p className="kn-onb-status">O antes e o depois de {magic.view.path.replace(/\.md$/, "")}:</p>
          <div className="kn-onb-diff">
            <ViewPanel view={{ phase: "ready", view: magic.view }} />
          </div>
          <div className="kn-onb-magic-pick">
            <Button variant="primary" onClick={() => setMagic({ phase: "kept" })}>
              Manter
            </Button>
            <Button onClick={() => void undo(magic.id)}>Desfazer</Button>
          </div>
        </>
      ) : magic.phase === "kept" ? (
        <p className="kn-onb-try" data-phase="answered">Ficou assim. Dá para desfazer depois, em Ajustes › Atividade do agente.</p>
      ) : magic.phase === "undone" ? (
        <p className="kn-onb-try">Desfeito: a nota voltou como estava.</p>
      ) : (
        <p className="kn-onb-status">O {status.name} não mudou a nota: {magic.text}</p>
      )}
    </div>
  );
}

/** Passo 9: o cartão final, com o que ficou escolhido. */
function DoneStep({ status, settings }: { status: AgentStatus; settings: AppSettings }) {
  const [projects, setProjects] = useState<string[] | null>(null);
  useEffect(() => {
    if (!has("projects.list")) return setProjects([]);
    let alive = true;
    api.projects.list().then(
      (r) => alive && setProjects(r.projects.map((p) => p.name)),
      () => alive && setProjects([]),
    );
    return () => {
      alive = false;
    };
  }, []);
  const color = catColorOptions().find((c) => c.id === settings.kiwicat.cor) ?? catColorOptions()[0]!;
  const rows: [string, string][] = [
    ["A cor", color.label],
    ["O jeito de falar", toneSummary(status.instructions)],
    ["Os projetos", projects === null ? "…" : projectsSummary(projects)],
    ["O atalho", shortcutSummary(status.controlShortcut, holdName(settings.shortcuts.agent))],
  ];
  return (
    <dl className="kn-onb-card" style={{ "--kn-onb-cor": color.hex } as React.CSSProperties}>
      {rows.map(([k, v]) => (
        <div key={k} className="kn-onb-card-row">
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Onboarding() {
  const [status, setStatus] = useState<AgentStatus | null>(null);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const checked = useRef(false);
  const dialog = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!has("agent.status") || !has("settings.get")) return;
    let alive = true;
    const offStatus = api.agent.onStatus((s) => alive && setStatus(s));
    const offSettings = api.settings.onChanged((s) => alive && setSettings(s));
    void api.agent.status().then((s) => alive && setStatus(s), () => {});
    void api.settings.get().then((s) => alive && setSettings(s), () => {});
    return () => {
      alive = false;
      offStatus();
      offSettings();
    };
  }, []);

  const open = status?.onboarding?.state === "open";
  // Aberto, o passo 1 confere o Claude Code uma vez (o `claude --version` e o `auth status`, sem a conta).
  useEffect(() => {
    if (!open || checked.current) return;
    checked.current = true;
    void api.agent.status(true).then(setStatus, () => {});
  }, [open]);

  // Aberto, o foco entra no onboarding (é um diálogo modal), no título do passo; o Esc fecha, como o ×.
  const shown = open && !!status && !!settings;
  const stepNow = status?.onboarding?.step;
  useEffect(() => {
    if (!shown) return;
    dialog.current?.querySelector<HTMLElement>(".kn-onb-title")?.focus();
  }, [shown, stepNow]);
  // O hub atrás fica `inert` (fora do Tab, do clique e do VoiceOver) enquanto o onboarding está aberto.
  useEffect(() => {
    if (!shown) return;
    const behind = [...document.querySelectorAll<HTMLElement>(".kn-hub-top, .kn-hub-main")];
    for (const el of behind) el.inert = true;
    return () => {
      for (const el of behind) el.inert = false;
    };
  }, [shown]);
  useEffect(() => {
    if (!shown) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      e.preventDefault();
      void api.agent.configure({ onboarding: { state: "done" } }).then(setStatus, () => {});
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [shown]);

  if (!open || !status || !settings) return null;
  const n = status.onboarding.step;
  const step = stepAt(n);
  // O atalho escolhido (spec #12946) nas frases do Control e do fim.
  const hold = holdName(settings.shortcuts.agent);
  const text = stepText(step, hold);
  const reduced = settings.appearance.motion === "reduced";
  const set = (o: { state?: "open" | "done"; step?: number }) => {
    setFailure(null);
    api.agent.configure({ onboarding: o }).then(setStatus, (e: unknown) => setFailure(e instanceof Error ? e.message : String(e)));
  };
  // Só o Continuar do passo 1 espera o Claude Code logado e a ponte baixada; o Pular vale sempre (revisão do T11993).
  const blocked = step === "claude" && !canLeaveClaude(status);
  const next = () => (n >= STEP_COUNT ? set({ state: "done" }) : set({ step: n + 1 }));

  return (
    <div className="kn-onb" ref={dialog} role="dialog" aria-modal="true" aria-label="Conhecendo o agente" data-motion={reduced ? "reduced" : "full"} data-step={step}>
      <header className="kn-onb-top">
        <ol className="kn-onb-dots" aria-label={progressLine(n)}>
          {Array.from({ length: STEP_COUNT }, (_, i) => (
            <li key={i} data-on={i + 1 === n} data-past={i + 1 < n} />
          ))}
        </ol>
        <span className="kn-onb-progress">{progressLine(n)}</span>
        <button type="button" className="kn-onb-close" aria-label="Fechar o onboarding" onClick={() => set({ state: "done" })}>
          ×
        </button>
      </header>
      <BigCat cor={catColorHex(settings.kiwicat.cor)} reduced={reduced} />
      <section className="kn-onb-step" key={step} aria-labelledby="kn-onb-title">
        <h1 id="kn-onb-title" className="kn-onb-title" tabIndex={-1}>{text.title}</h1>
        {text.hint ? <p className="kn-onb-hint">{text.hint}</p> : null}
        {step === "claude" ? (
          <ClaudeStep status={status} />
        ) : step === "control" ? (
          <ControlStep status={status} onStatus={setStatus} settings={settings} />
        ) : step === "tone" ? (
          <ToneStep status={status} onStatus={setStatus} />
        ) : step === "guardrail" ? (
          <GuardStep />
        ) : step === "model" ? (
          <div className="kn-onb-model">
            <NoteModelEditor />
          </div>
        ) : step === "projects" ? (
          <ProjectsStep settings={settings} />
        ) : step === "color" ? (
          <div className="kn-onb-row kn-onb-color">
            <CatColorRow agentEnabled={status.enabled} preview={false} />
          </div>
        ) : step === "magic" ? (
          <MagicStep status={status} settings={settings} />
        ) : step === "done" ? (
          <DoneStep status={status} settings={settings} />
        ) : (
          <p className="kn-onb-soon">Este passo chega nas próximas tasks do spec #11955.</p>
        )}
        {failure ? <p className="kn-onb-failure" role="alert">{failure}</p> : null}
      </section>
      <footer className="kn-onb-actions">
        {n > 1 ? <Button onClick={() => set({ step: n - 1 })}>Voltar</Button> : <span />}
        <span className="kn-onb-actions-end">
          {n < STEP_COUNT ? (
            <Button onClick={next}>Pular</Button>
          ) : null}
          <Button variant="primary" onClick={next} disabled={blocked}>
            {n < STEP_COUNT ? "Continuar" : "Pronto, é só segurar o Control"}
          </Button>
        </span>
      </footer>
    </div>
  );
}
