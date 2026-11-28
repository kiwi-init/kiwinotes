// Lightweight persistent host; renderer loads only while enabled and visible.
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { catPalette } from "../../src/shared/kiwicat-colors";
import { DEFAULT_SHORTCUTS, shortcutLabel } from "../../src/shared/shortcuts";
import type { AgentStatus, AppSettings } from "../../src/shared/ui-contract";
import type { createKiwiCat } from "../kiwicat/cat";
import { api, has } from "../src/api";
import { CatActivity } from "./cat-state";
import { NOT_HEARD_MS } from "./bubble-state";
import { CatAsk } from "./CatAsk";
import { BubblePresence } from "./BubblePresence";
import { CatBubble } from "./CatBubble";
import { BubblePeek } from "./bubble-peek";
import { provideKiwiAsk } from "./kiwi-ask.ts";
import { useT } from "../src/i18n.ts";
import { MemoryBubble } from "./MemoryBubble";
import { RoutineBubble } from "./RoutineBubble";
import { ProposalBubble } from "./ProposalBubble";
import { BubbleCornerContext, useCatCorner } from "./bubbleCorner";
import { ANSWER_GATE_MS, ASK_HOLD_MS, AnswerGate, proposalHidden } from "./answer-gate";
type Cat = Awaited<ReturnType<typeof createKiwiCat>>;
/**
 * A tinta dos símbolos segue o tema da janela (T10737, #428): escura no claro, branca no escuro. O tema resolvido fica
 * no `data-theme` do <html> (o `applyAppearance`), e muda sem recarregar quando a pessoa troca a Aparência ou o macOS.
 */
const symbolBackground = (): "light" | "dark" => (document.documentElement.dataset.theme === "light" ? "light" : "dark");
// Com o gato no overlay (spec #9810), o do canto some e pausa o desenho: nunca dois gatos.
/** Onde o mouse mostra os balões (spec #32534): o Kiwi e os balões à vista (os escondidos não pegam o mouse). */
const PEEK_TARGETS = ".kn-kiwicat-hit, .kn-bubble-shell:not(.kn-cat-ask), .kn-bubble-big";

function CatMount({ busy, reduced, away, cor, voiceHint }: { busy: boolean; reduced: boolean; away: boolean; cor: string; voiceHint?: string }) {
  const { t } = useT();
  const handle = useRef<Cat | undefined>(undefined);
  /** Tira a resposta de antes do canto quando a pergunta sai (o `drop` do CatBubble). */
  const dropAnswer = useRef<(() => void) | null>(null);
  /** Traz a última resposta de volta (o `recall` do CatBubble, spec #32534): o mouse chegou no Kiwi depois que ela saiu. */
  const recallAnswer = useRef<(() => boolean) | null>(null);
  const reducedRef = useRef(reduced); reducedRef.current = reduced;
  const awayRef = useRef(away); awayRef.current = away;
  const refresh = useRef<() => void>(() => {});
  /** O balão da resposta está na tela: a proposta da reunião espera ele sair (spec #8360). */
  const [talking, setTalking] = useState(false);
  /**
   * A resposta que está chegando, antes de o balão dela aparecer (spec #15454): nasce do evento do pedido, no mesmo
   * render do balão. Sem isso, a proposta entrava um quadro junto com a resposta e saía em seguida.
   */
  const gate = useRef(new AnswerGate());
  const [answering, setAnswering] = useState(false);
  /** O texto mandado, enquanto o portão segura a pergunta no canto até a resposta entrar (T15377). */
  const [held, setHeld] = useState<string | null>(null);
  const releaseAsk = () => { if (!gate.current.asked) setHeld(null); };
  const onShown = (showing: boolean) => { setTalking(showing); setAnswering(gate.current.shown(showing)); releaseAsk(); };
  // Sem resposta nesse prazo, a pergunta sai mesmo assim: ela cobre a ida e volta do pedido, não a espera do agente.
  useEffect(() => {
    if (held === null) return;
    const t = setTimeout(() => { gate.current.unsent(); releaseAsk(); }, ASK_HOLD_MS);
    return () => clearTimeout(t);
  }, [held]);
  useEffect(() => {
    if (!answering || talking) return;
    const t = setTimeout(() => setAnswering(gate.current.expire()), ANSWER_GATE_MS);
    return () => clearTimeout(t);
  }, [answering, talking]);
  /** O balão da memória está na tela (spec #11469): a proposta espera ele sair. */
  const [noting, setNoting] = useState(false);
  const [routining, setRoutining] = useState(false);
  const [proposing, setProposing] = useState(false);
  useEffect(() => { handle.current?.update({ parado: reduced }); }, [reduced]);
  // A paleta (spec #14963), pelo id: troca no próximo quadro, sem reiniciar o gato.
  const corRef = useRef(cor); corRef.current = cor;
  // E a borda e a sombra dos balões (spec #14963), pelo `--kn-cat-accent` da raiz, que o `bubble.css` lê.
  useEffect(() => {
    if (root.current) root.current.dataset.cor = cor;
    handle.current?.update({ cor });
    document.documentElement.style.setProperty("--kn-cat-accent", catPalette(cor).accentColor);
  }, [cor]);
  useEffect(() => { refresh.current(); }, [away]);
  const root = useRef<HTMLDivElement>(null);
  // O estado do gato vive aqui, e não no efeito: o campo de texto (spec #9878) também o muda.
  const activityRef = useRef<CatActivity | null>(null);
  if (!activityRef.current) activityRef.current = new CatActivity(busy);
  const applyRef = useRef<() => void>(() => {});
  const hit = useRef<HTMLButtonElement>(null);
  const [asking, setAsking] = useState(false);
  /** A pergunta no canto: aberta, ou mandada e esperando a resposta. Os outros balões do canto esperam ela sair. */
  const askShown = asking || held !== null;
  /**
   * O pedido mandado e ainda sem o `busy` do status (que chega depois): a proposta da reunião espera, para não voltar por
   * um instante entre a pergunta e a resposta (spec #11652).
   */
  const [sending, setSending] = useState(false);
  useEffect(() => {
    if (!sending) return;
    if (busy) return void setSending(false);
    const t = setTimeout(() => setSending(false), 5000);
    return () => clearTimeout(t);
  }, [sending, busy]);
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
    // A voz do gato (T26829): o nível de agora, para o gato que nasce no meio da fala.
    let fala: number | null = null;
    const activity = activityRef.current!;
    const state = () => { if (cat) { cat.update({ estado: activity.state, limite: activity.limited }); el.dataset.state = cat.visualState; } };
    applyRef.current = state;
    async function create() {
      if (gone || cat || loading || document.hidden) return;
      loading = true;
      try {
        const { createKiwiCat } = await import("../kiwicat/cat");
        if (gone || document.hidden) return;
        const next = await createKiwiCat(el, { mode: "runtime", width: 96, height: 120, cutout: true, background: symbolBackground(),
          // Trabalhando, 30 fps como no overlay (#14840): a 60, o hub gastava 32 % de CPU (T14977, #15128).
          activeFPS: 30,
          inputs: { estado: activity.state, cor: corRef.current, voz: null, fala, parado: reducedRef.current } });
        if (gone) { await next.dispose(); return; }
        cat = next; handle.current = cat; cat.update({ parado: reducedRef.current, cor: corRef.current }); cat.setBackground(symbolBackground()); cat.visibility(hidden()); state(); el.dataset.ready = "true";
      } catch { el.replaceChildren(); }
      finally { loading = false; }
    }
    const off = api.agent.onTurn(e => { setAnswering(gate.current.event(e)); releaseAsk(); const previous = activity.state; activity.event(e); if (activity.state !== previous) state(); });
    // A fala pelo Control (spec #9876): `ouvindo` com as ondas seguindo a voz; ao soltar as ondas somem na hora, e o
    // gato segue atento até o pedido começar. Cancelada ou vazia, ele volta ao repouso.
    let talking = false;
    let confusedTimer: ReturnType<typeof setTimeout> | undefined;
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
        // A fala curta ou vazia (spec #32534, Cena 4): o gato fica confuso por `NOT_HEARD_MS`, com o "Não ouvi" no balão.
        if (v.notHeard) {
          activity.notHeard();
          clearTimeout(confusedTimer);
          confusedTimer = setTimeout(() => { const at = activity.state; activity.notHeardEnd(); if (activity.state !== at) state(); }, NOT_HEARD_MS);
        }
        if (activity.state !== before) state();
      }
    });
    // A voz do gato (T26829): o `falando`, com a boca no nível do que tocou; `null` volta ao estado de antes.
    const offSpeech = api.agent.onSpeech(e => {
      fala = typeof e.nivel === "number" && Number.isFinite(e.nivel) ? e.nivel : null;
      cat?.update({ fala });
      el.dataset.falando = String(fala !== null);
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
      gone = true; off(); offVoice(); clearTimeout(confusedTimer); offSpeech(); theme.disconnect(); document.removeEventListener("visibilitychange", visibility); refresh.current = () => {};
      handle.current = undefined;
      if (cat) void cat.dispose();
    };
  }, []);
  const activity = activityRef.current;
  // O agente livre no status solta o pedido que o gato ia adotar (`CatActivity.idle`); o desenho segue no efeito.
  if (!busy) activity.idle();
  useEffect(() => { if (!busy) applyRef.current(); }, [busy]);
  const openAsk = (keyboard: boolean) => {
    if (asking) return;
    returnFocus.current = { el: keyboard ? hit.current : document.activeElement, keyboard };
    setAsking(true);
    gate.current.unsent();
    setHeld(null);
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
  // A busca do Kiwi (⌘K) do Calendário (T32156) abre este mesmo campo, com o texto que ela já tinha; o foco volta
  // para ela quando o campo fecha.
  const openAskRef = useRef(openAsk);
  openAskRef.current = openAsk;
  useEffect(() => provideKiwiAsk((text) => {
    if (text !== undefined) setDraft(text);
    openAskRef.current(false);
  }), []);
  const send = (text: string) => {
    activity.sent();
    setSending(true);
    setAsking(false);
    gate.current.sent();
    dropAnswer.current?.();
    setHeld(text);
    setDraft("");
    giveBackFocus();
    api.agent.ask(text).catch(() => { setSending(false); gate.current.unsent(); setHeld(null); activity.attend(false); applyRef.current(); });
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
  // O balão no mouse (spec #32534): os balões só aparecem com o mouse em cima do Kiwi ou de um balão, e saem 250 ms
  // depois. Quem esconde é o CSS (`data-bubble-peek` no hub), pela opacidade: a vida de cada balão, a ordem entre eles e
  // os anúncios do leitor de tela não mudam. O campo de falar por texto e o balão grande, que a pessoa abriu, ficam.
  const [peekShown, setPeekShown] = useState(false);
  const peekRef = useRef(peekShown);
  peekRef.current = peekShown;
  const [unseen, setUnseen] = useState(false);
  const peekApi = useRef<BubblePeek | null>(null);
  /** O mouse em cima do Kiwi ou de um balão, agora: segura o relógio do balão e arma o Esc (spec #32534, Cena 3). */
  const [hovering, setHovering] = useState(false);
  /** Quem pode trazer a última resposta de volta: só com o canto livre (sem outro balão, sem o campo, à vista). */
  const recallOk = useRef(false);
  useEffect(() => {
    const peek = new BubblePeek((shown) => {
      setPeekShown(shown);
      if (shown) setUnseen(false);
    });
    peekApi.current = peek;
    let onKiwi = false;
    const over = (e: PointerEvent) => {
      const t = e.target;
      const kiwi = t instanceof Element && !!t.closest(".kn-kiwicat-hit");
      // O mouse chegou no Kiwi: a última resposta volta, se já saiu (o `recall` não faz nada com ela na tela).
      if (kiwi && !onKiwi && recallOk.current) recallAnswer.current?.();
      onKiwi = kiwi;
      peek.hover("mouse", t instanceof Element && !!t.closest(PEEK_TARGETS));
      setHovering(peek.hovering);
    };
    // Saiu da janela: o `relatedTarget` é nenhum.
    const out = (e: PointerEvent) => {
      if (e.relatedTarget) return;
      onKiwi = false;
      peek.hover("mouse", false);
      setHovering(false);
    };
    document.addEventListener("pointerover", over, true);
    document.addEventListener("pointerout", out, true);
    return () => {
      document.removeEventListener("pointerover", over, true);
      document.removeEventListener("pointerout", out, true);
      peek.dispose();
      peekApi.current = null;
    };
  }, []);
  // A marca no Kiwi (spec #32534): cada balão novo que chega com o mouse longe a acende, também com outro balão ainda
  // na tela (T33053); ela some quando o mouse mostra os balões, ou quando nenhum sobra.
  const anyBubble = talking || noting || routining || proposing;
  recallOk.current = !anyBubble && !askShown && !away;
  useEffect(() => { if (!anyBubble) setUnseen(false); }, [anyBubble]);
  useEffect(() => {
    const hub = root.current?.parentElement;
    if (!hub) return;
    const arrived = () => {
      // O mouse parado em cima do Kiwi desde antes do balão chegar: nenhum `pointerover` veio.
      const hovered = [...document.querySelectorAll(":hover")].some((el) => el.matches(PEEK_TARGETS));
      if (hovered) peekApi.current?.hover("mouse", true);
      else if (!peekRef.current) setUnseen(true);
    };
    // Um balão novo é um slot novo do BubblePresence (um por balão, com a própria chave), com um balão de resposta dentro.
    // O campo de texto (`.kn-cat-ask`) não é balão de resposta e não conta.
    const isNew = (n: Node) => n instanceof HTMLElement && n.classList.contains("kn-bubble-slot") && !!n.querySelector(".kn-bubble-shell.kn-bubble");
    const watch = new MutationObserver((records) => {
      if (records.some((r) => [...r.addedNodes].some(isNew))) arrived();
    });
    watch.observe(hub, { childList: true, subtree: true });
    return () => watch.disconnect();
  }, []);
  useLayoutEffect(() => {
    const hub = root.current?.parentElement;
    if (!hub) return;
    hub.dataset.bubblePeek = String(peekShown);
    hub.dataset.bubbleUnseen = String(unseen && !away);
  }, [peekShown, unseen, away]);
  useLayoutEffect(() => () => {
    const hub = root.current?.parentElement;
    if (hub) { delete hub.dataset.bubblePeek; delete hub.dataset.bubbleUnseen; }
  }, []);
  // A quina do balão (T16754): de que lado do gato os balões abrem, com o rabo encostado nele.
  const corner = useCatCorner(root);
  return (
    <BubbleCornerContext.Provider value={corner}>
      {/* A barra de rolagem termina antes do gato e da névoa dele (spec #13381). */}
      <div className="kn-kiwicat" aria-hidden="true" data-scrollbar-avoid="" ref={root} />
      {/* A marca de balão não visto (spec #32534): o CSS a mostra pelo `data-bubble-unseen` do hub. */}
      <span className="kn-kiwicat-mark" aria-hidden="true" />
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
        aria-label={t("hub.ask.aria")}
        aria-haspopup="dialog"
        aria-expanded={asking}
        // `detail === 0`: o clique veio do teclado (Enter ou Espaço no botão), não do mouse.
        onClick={(e) => (asking ? closeAsk(true) : openAsk(e.detail === 0))}
      />
      {/* O campo de falar por texto também é um balão do canto: entra e sai pela mesma passagem (spec #11652). */}
      {/* Mandado o pedido, a pergunta fica (com o texto, sem receber nada) até a resposta entrar no lugar dela (T15377). */}
      <BubblePresence itemKey={askShown ? "pergunta" : null} reduced={reduced}>
        {asking ? (
          <CatAsk
            draft={draft}
            hint={voiceHint}
            busy={busy || activity.busy}
            onDraft={setDraft}
            onSend={send}
            onClose={() => closeAsk(true)}
            onCancelRequest={() => void api.agent.cancel().catch(() => {})}
          />
        ) : held !== null ? (
          <CatAsk draft={held} busy={false} sent onDraft={() => {}} onSend={() => {}} onClose={() => {}} onCancelRequest={() => {}} />
        ) : null}
      </BubblePresence>
      {/* O balão (spec #9495): ao lado do gato, fora da caixa dele. Com o campo aberto ele espera escondido, sem perder
          o que chega, e aparece depois que o pedido sai (#10868). */}
      {/* Um balão com ação esperando (T28350): com o agente parado, a resposta dá lugar a ele depois do tempo de leitura. */}
      <CatBubble reduced={reduced} hidden={asking || away} onShown={onShown} drop={dropAnswer} recall={recallAnswer} hovering={hovering} onAsk={() => { if (!peekRef.current) setUnseen(true); }} yieldTo={(noting || routining || proposing) && !(busy || activity.busy) && !sending} />
      {/* A proposta da reunião (spec #8360): no mesmo canto, depois que a resposta sai da tela. */}
      {/* "Anotei: …" (spec #11469): depois da resposta; a proposta da reunião espera ele sair, e também o pedido em
          andamento (sem isso ela voltava por um instante entre a pergunta e a resposta, spec #11652). */}
      <MemoryBubble hidden={askShown || away || talking} onShown={setNoting} reduced={reduced} />
      {/* As rotinas (spec #12150): o resumo pronto, com [Ver] [Manter] [Descartar], depois da memória. */}
      <RoutineBubble hidden={askShown || away || talking || noting} onShown={setRoutining} reduced={reduced} />
      <ProposalBubble hidden={proposalHidden({ asking: askShown, away, talking, answering, noting, routining, busy: busy || activity.busy, sending })} reduced={reduced} onPending={setProposing} />
    </BubbleCornerContext.Provider>
  );
}
/** O estado do agente e os Ajustes, ao vivo: o hub decide daqui se há gato, e onde (a Início, spec #15728). */
export function useAgentCat(): { status: AgentStatus | null; settings: AppSettings | null } {
  const [status, setStatus] = useState<AgentStatus | null>(null);
  const [settings, setSettings] = useState<AppSettings | null>(null);
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
  return { status, settings };
}
/** `atHome`: a Início está na frente, e o gato está no meio dela (o hub o leva; aqui só muda a dica do campo). */
export function KiwiCat({ status, settings, atHome = false }: { status: AgentStatus | null; settings: AppSettings | null; atHome?: boolean }) {
  const { t } = useT();
  const [away, setAway] = useState(false);
  useEffect(() => api.agent.onCatWhere(e => setAway(e.overlay)), []);
  // No onboarding (spec #11955), o gato grande é o dele: nunca dois gatos.
  return status?.enabled && settings?.kiwicat?.show === true && status.onboarding?.state !== "open" ? <CatMount busy={status.busy} reduced={settings.appearance.motion === "reduced"} away={away} cor={settings.kiwicat.cor} voiceHint={atHome ? t("hub.ask.voiceHint", { keys: shortcutLabel(settings.shortcuts?.agent ?? DEFAULT_SHORTCUTS.agent!) }) : undefined} /> : null;
}
