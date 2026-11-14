// Lightweight persistent host; renderer loads only while enabled and visible.
import { useEffect, useRef, useState } from "react";
import type { AgentStatus, AppSettings } from "../../src/shared/ui-contract";
import type { createKiwiCat } from "../kiwicat/cat";
import { api, has } from "../src/api";
import { CatActivity } from "./cat-state";
import { CatAsk } from "./CatAsk";
import { CatBubble } from "./CatBubble";
import { ProposalBubble } from "./ProposalBubble";
type Cat = Awaited<ReturnType<typeof createKiwiCat>>;
/**
 * A tinta dos símbolos segue o tema da janela (T10737, #428): escura no claro, branca no escuro. O tema resolvido fica
 * no `data-theme` do <html> (o `applyAppearance`), e muda sem recarregar quando a pessoa troca a Aparência ou o macOS.
 */
const symbolBackground = (): "light" | "dark" => (document.documentElement.dataset.theme === "light" ? "light" : "dark");
// Com o gato no overlay (spec #9810), o do canto some e pausa o desenho: nunca dois gatos.
function CatMount({ busy, reduced, away }: { busy: boolean; reduced: boolean; away: boolean }) {
  const handle = useRef<Cat | undefined>(undefined);
  const reducedRef = useRef(reduced); reducedRef.current = reduced;
  const awayRef = useRef(away); awayRef.current = away;
  const refresh = useRef<() => void>(() => {});
  /** O balão da resposta está na tela: a proposta da reunião espera ele sair (spec #8360). */
  const [talking, setTalking] = useState(false);
  useEffect(() => { handle.current?.update({ parado: reduced }); }, [reduced]);
  useEffect(() => { refresh.current(); }, [away]);
  const root = useRef<HTMLDivElement>(null);
  // O estado do gato vive aqui, e não no efeito: o campo de texto (spec #9878) também o muda.
  const activityRef = useRef<CatActivity | null>(null);
  if (!activityRef.current) activityRef.current = new CatActivity(busy);
  const applyRef = useRef<() => void>(() => {});
  const hit = useRef<HTMLButtonElement>(null);
  const [asking, setAsking] = useState(false);
  // De onde o foco veio: o campo devolve o foco a quem o tinha (o editor, por exemplo) e, aberto pelo teclado no gato,
  // de volta ao gato. Nunca deixa o anel de foco no gato depois de um clique.
  const returnFocus = useRef<{ el: Element | null; keyboard: boolean }>({ el: null, keyboard: false });
  const giveBackFocus = () => {
    const { el, keyboard } = returnFocus.current;
    if (keyboard) hit.current?.focus();
    else if (el instanceof HTMLElement && el.isConnected && el !== document.body) el.focus();
    else (document.activeElement as HTMLElement | null)?.blur?.();
  };
  // O rascunho volta no próximo clique, até ser mandado ou apagado.
  const [draft, setDraft] = useState("");
  useEffect(() => {
    const el = root.current!;
    let gone = false, loading = false, cat: Cat | undefined;
    const activity = activityRef.current!;
    const state = () => { if (cat) { cat.update({ estado: activity.state }); el.dataset.state = cat.visualState; } };
    applyRef.current = state;
    async function create() {
      if (gone || cat || loading || document.hidden) return;
      loading = true;
      try {
        const { createKiwiCat } = await import("../kiwicat/cat");
        if (gone || document.hidden) return;
        const next = await createKiwiCat(el, { mode: "runtime", width: 96, height: 120, cutout: true, background: symbolBackground(),
          inputs: { estado: activity.state, cor: "claude", voz: null, parado: reducedRef.current } });
        if (gone) { await next.dispose(); return; }
        cat = next; handle.current = cat; cat.update({ parado: reducedRef.current }); cat.setBackground(symbolBackground()); cat.visibility(hidden()); state(); el.dataset.ready = "true";
      } catch { el.replaceChildren(); }
      finally { loading = false; }
    }
    const off = api.agent.onTurn(e => { const previous = activity.state; activity.event(e); if (activity.state !== previous) state(); });
    // A fala pelo Control (spec #9876): `ouvindo` com as ondas seguindo a voz; ao soltar as ondas somem na hora, e o
    // gato segue atento até o pedido começar. Cancelada ou vazia, ele volta ao repouso.
    let talking = false;
    const offVoice = api.agent.onVoice(v => {
      const before = activity.state;
      if (v.phase === "listening") {
        if (!talking) {
          talking = true;
          activity.attend(true);
          if (activity.state !== before) { cat?.update({ estado: "acordou" }); state(); }
        }
        cat?.update({ voz: v.voz });
      } else if (v.phase === "processing") {
        cat?.update({ voz: null });
      } else if (v.phase === "asked") {
        talking = false;
        cat?.update({ voz: null });
        activity.sent();
      } else {
        talking = false;
        cat?.update({ voz: null });
        activity.attend(false);
        if (activity.state !== before) state();
      }
    });
    const hidden = () => document.hidden || awayRef.current;
    const visibility = () => {
      el.dataset.away = String(awayRef.current);
      if (cat) {
        cat.visibility(hidden());
        // Na volta, o gato do canto mostra o estado de agora.
        if (!hidden()) state();
      } else void create();
    };
    refresh.current = visibility;
    document.addEventListener("visibilitychange", visibility);
    const theme = new MutationObserver(() => cat?.setBackground(symbolBackground()));
    theme.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    void create();
    return () => {
      gone = true; off(); offVoice(); theme.disconnect(); document.removeEventListener("visibilitychange", visibility); refresh.current = () => {};
      handle.current = undefined;
      if (cat) void cat.dispose();
    };
  }, []);
  const activity = activityRef.current;
  const openAsk = (keyboard: boolean) => {
    if (asking) return;
    returnFocus.current = { el: keyboard ? hit.current : document.activeElement, keyboard };
    setAsking(true);
    const before = activity.state;
    activity.attend(true);
    // Sem pedido em andamento, o gato passa pelo `acordou` e fica no `ouvindo` (o módulo segura o ouvindo 0,32 s); a
    // entrada do gato não atrasa o campo, que já abriu.
    if (activity.state !== before) { handle.current?.update({ estado: "acordou" }); applyRef.current(); }
  };
  const closeAsk = (giveBack: boolean) => {
    setAsking(false);
    const before = activity.state;
    activity.attend(false);
    if (activity.state !== before) applyRef.current();
    if (giveBack) giveBackFocus();
  };
  const send = (text: string) => {
    activity.sent();
    setAsking(false);
    setDraft("");
    giveBackFocus();
    api.agent.ask(text).catch(() => { activity.attend(false); applyRef.current(); });
  };
  // Clique fora fecha o campo (sem mandar); o clique no próprio gato não conta.
  useEffect(() => {
    if (!asking) return;
    const away = (e: MouseEvent) => {
      const t = e.target as Node;
      if (t instanceof Element && (t.closest(".kn-cat-ask") || t.closest(".kn-kiwicat-hit"))) return;
      closeAsk(false);
    };
    document.addEventListener("mousedown", away, true);
    return () => document.removeEventListener("mousedown", away, true);
  });
  return (
    <>
      <div className="kn-kiwicat" aria-hidden="true" ref={root} />
      {/* Só o corpo do gato recebe o clique (spec #9878); a névoa e o resto do canto deixam passar. */}
      <button
        ref={hit}
        type="button"
        className="kn-kiwicat-hit"
        // Com o gato no overlay, o do canto some, e o botão dele também (nem clique nem Tab num gato invisível).
        hidden={away}
        // No WebKit (o app e o Safari), o Tab pula um <button> sem tabIndex: com ele, o gato entra na ordem do Tab.
        tabIndex={0}
        // Com o tabIndex, o clique do mouse passaria o foco ao gato (e o anel ficaria nele): o mousedown não leva o foco,
        // e ele volta para onde estava quando o campo fecha.
        onMouseDown={(e) => e.preventDefault()}
        aria-label="Falar com o agente"
        aria-haspopup="dialog"
        aria-expanded={asking}
        // `detail === 0`: o clique veio do teclado (Enter ou Espaço no botão), não do mouse.
        onClick={(e) => (asking ? closeAsk(true) : openAsk(e.detail === 0))}
      />
      {asking ? (
        <CatAsk
          draft={draft}
          busy={busy || activity.busy}
          onDraft={setDraft}
          onSend={send}
          onClose={() => closeAsk(true)}
          onCancelRequest={() => void api.agent.cancel().catch(() => {})}
        />
      ) : null}
      {/* O balão (spec #9495): ao lado do gato, fora da caixa dele. Com o campo aberto ele espera escondido, sem perder
          o que chega, e aparece depois que o pedido sai (#10868). */}
      <CatBubble reduced={reduced} hidden={asking || away} onShown={setTalking} />
      {/* A proposta da reunião (spec #8360): no mesmo canto, depois que a resposta sai da tela. */}
      <ProposalBubble hidden={asking || away || talking} />
    </>
  );
}
export function KiwiCat() {
  const [status, setStatus] = useState<AgentStatus | null>(null);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [away, setAway] = useState(false);
  useEffect(() => api.agent.onCatWhere(e => setAway(e.overlay)), []);
  useEffect(() => {
    if (!has("agent.status") || !has("settings.get")) return;
    let alive = true, statusEvents = 0, settingsEvents = 0;
    const offStatus = api.agent.onStatus(s => { statusEvents++; if (alive) setStatus(s); });
    const offSettings = api.settings.onChanged(s => { settingsEvents++; if (alive) setSettings(s); });
    const st = statusEvents, se = settingsEvents;
    void api.agent.status().then(s => { if (alive && statusEvents === st) setStatus(s); }, () => {});
    void api.settings.get().then(s => { if (alive && settingsEvents === se) setSettings(s); }, () => {});
    return () => { alive = false; offStatus(); offSettings(); };
  }, []);
  return status?.enabled && settings?.kiwicat?.show === true ? <CatMount busy={status.busy} reduced={settings.appearance.motion === "reduced"} away={away} /> : null;
}
