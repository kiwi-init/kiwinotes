// Os atalhos (T5349, #175): todos configuráveis, com "aperte o atalho", o aviso quando outro atalho do Kiwi já usa as
// mesmas teclas, e "Padrão". Quem lê as teclas é o helper (o WebView não vê o Fn nem o lado dos modificadores), pelo
// `shortcuts.record`; aqui só se mostra e se salva (`settings.set {shortcuts}`). A mesma linha aparece nas Configurações
// e nos ajustes de reunião.
import { useState } from "react";

import {
  conflictOf, isShortcutFor, SHORTCUTS, shortcutDef, shortcutLabel, type ShortcutId, type Shortcuts,
} from "../../src/shared/shortcuts.ts";
import { api, has } from "../src/api.ts";
import { Button, Row, Section } from "../src/kit/index.tsx";
import { useShortcuts } from "../src/useShortcuts.ts";
import "./shortcuts.css";

const codeOf = (e: unknown) => (e as { code?: string })?.code ?? /E_[A-Z_]+/.exec(String((e as Error)?.message ?? e))?.[0];

type State =
  | { kind: "idle"; problem?: string }
  | { kind: "recording" }
  /** O atalho apertado já é de outra ação: usar aqui desliga lá. */
  | { kind: "conflict"; text: string; other: ShortcutId };

export function ShortcutRow({ id, shortcuts }: { id: ShortcutId; shortcuts: Shortcuts }) {
  const def = shortcutDef(id);
  const [state, setState] = useState<State>({ kind: "idle" });
  const current = shortcuts[id];
  const canRecord = has("shortcuts.record");

  const save = (patch: Partial<Shortcuts>) => {
    setState({ kind: "idle" });
    api.settings.set({ shortcuts: patch }).catch(() => setState({ kind: "idle", problem: "Não deu para salvar o atalho. Tente de novo." }));
  };

  /** Salva, ou pergunta antes quando outra ação já usa as mesmas teclas. */
  const choose = (text: string) => {
    if (!isShortcutFor(id, text)) {
      setState({ kind: "idle", problem: `${shortcutLabel(text)} não serve aqui: com as Notas na frente, só uma combinação, como ⌘K.` });
      return;
    }
    const other = conflictOf(shortcuts, id, text);
    if (other) setState({ kind: "conflict", text, other });
    else if (text !== current) save({ [id]: text });
    else setState({ kind: "idle" });
  };

  const record = () => {
    setState({ kind: "recording" });
    api.shortcuts.record(id === "cancel").then(
      ({ shortcut }) => choose(shortcut),
      (e) => {
        const code = codeOf(e);
        if (code === "E_CANCELLED") return setState({ kind: "idle" });
        setState({
          kind: "idle",
          problem: code === "E_BAD_ARGS"
            ? "Isso não é um atalho: use ⌃, ⌥ ou ⌘ com uma tecla, uma tecla F, ou o Fn e o ⌥ direito sozinhos."
            : "Os atalhos estão desligados: falta a permissão de Monitoramento de Entrada.",
        });
      },
    );
  };

  const hint =
    state.kind === "recording"
      ? def.scope === "app"
        ? "Aperte a combinação. Esc cancela."
        : id === "cancel"
          ? "Aperte a tecla (⌫, ↩…) ou a combinação. Esc cancela; para voltar ao Esc, use Padrão."
        : "Aperte o atalho: uma tecla, duas vezes, uma combinação ou uma sequência. Esc cancela."
      : state.kind === "conflict"
        ? `${shortcutLabel(state.text)} já é de “${shortcutDef(state.other).label}”. Usar aqui desliga lá.`
        : state.problem ?? def.hint;

  return (
    <Row label={def.label} hint={hint}>
      <div className="kn-shortcut" data-state={state.kind}>
        {state.kind === "conflict" ? (
          <>
            <Button variant="primary" onClick={() => save({ [id]: state.text, [state.other]: null })}>Usar aqui</Button>
            <Button onClick={() => setState({ kind: "idle" })}>Cancelar</Button>
          </>
        ) : state.kind === "recording" ? (
          <>
            <kbd className="kn-kbd kn-shortcut-key" data-recording="true" aria-live="polite">Aperte o atalho…</kbd>
            <Button onClick={() => void api.shortcuts.cancelRecord().catch(() => setState({ kind: "idle" }))}>Cancelar</Button>
          </>
        ) : (
          <>
            {current !== def.default ? (
              <Button className="kn-button kn-shortcut-reset" onClick={() => choose(def.default)} title={`Voltar ao padrão (${shortcutLabel(def.default)})`}>
                Padrão
              </Button>
            ) : null}
            {current !== null ? (
              <Button className="kn-button kn-shortcut-off" onClick={() => save({ [id]: null })}>Desligar</Button>
            ) : null}
            <button
              type="button"
              className="kn-kbd kn-shortcut-key"
              data-off={current === null || undefined}
              disabled={!canRecord}
              onClick={record}
              aria-label={`${def.label}: ${shortcutLabel(current)}. Trocar o atalho`}
              title={canRecord ? "Trocar o atalho" : "Trocar o atalho precisa do Kiwi aberto, com o atalho ativo"}
            >
              {shortcutLabel(current)}
            </button>
          </>
        )}
      </div>
    </Row>
  );
}

/** Configurações › Atalhos: todos, por grupo. Os das reuniões aparecem também nos ajustes de reunião. */
export function ShortcutsSection() {
  const shortcuts = useShortcuts();
  // Um engine de antes do T5349: a seção não aparece.
  if (!shortcuts) return null;
  const groups = [...new Set(SHORTCUTS.map((s) => s.group))];
  return (
    <>
      {groups.map((group) => (
        <Section key={group} title={`Atalhos · ${group}`}>
          {SHORTCUTS.filter((s) => s.group === group).map((s) => (
            <ShortcutRow key={s.id} id={s.id} shortcuts={shortcuts} />
          ))}
        </Section>
      ))}
    </>
  );
}
