// Os atalhos (T5349, #175): todos configuráveis, com "aperte o atalho", o aviso quando outro atalho do Kiwi já usa as
// mesmas teclas, e "Padrão". Quem lê as teclas é o helper (o WebView não vê o Fn nem o lado dos modificadores), pelo
// `shortcuts.record`; aqui só se mostra e se salva (`settings.set {shortcuts}`). A mesma linha aparece nas Configurações
// e nos ajustes de reunião.
import { useState } from "react";

import type { TextKey } from "../../src/shared/i18n/index.ts";
import {
  conflictOf, isShortcutFor, SHORTCUTS, shortcutDef, shortcutGroupName, shortcutHint, shortcutLabel, shortcutName, type ShortcutDef, type ShortcutId,
  type Shortcuts,
} from "../../src/shared/shortcuts.ts";
import { api, has } from "../src/api.ts";
import { useT } from "../src/i18n.ts";
import { Button, Row, Section } from "../src/kit/index.tsx";
import { useShortcuts } from "../src/useShortcuts.ts";
import "./shortcuts.css";

const codeOf = (e: unknown) => (e as { code?: string })?.code ?? /E_[A-Z_]+/.exec(String((e as Error)?.message ?? e))?.[0];

type State =
  | { kind: "idle"; problem?: string }
  | { kind: "recording" }
  /** O atalho apertado já é de outra ação: usar aqui desliga lá. */
  | { kind: "conflict"; text: string; other: ShortcutId };

/**
 * O atalho do Kiwi Cat (spec #12946) não toma o lugar de outro nem cede o dele: o conflito com ele só avisa e não salva.
 * `label`: o nome da linha, quando não é o da ação (o "Atalho" embaixo do interruptor do Kiwi Cat).
 */
const refuses = (id: ShortcutId, other: ShortcutId) => id === "agent" || other === "agent";

export function ShortcutRow({ id, shortcuts, disabled = false }: { id: ShortcutId; shortcuts: Shortcuts; disabled?: boolean }) {
  const { t, locale } = useT();
  const keys = (text: string | null) => shortcutLabel(text, locale);
  const name = (of: ShortcutId) => shortcutName(of, locale);
  const def = shortcutDef(id);
  const [state, setState] = useState<State>({ kind: "idle" });
  const current = shortcuts[id];
  const canRecord = has("shortcuts.record");

  const save = (patch: Partial<Shortcuts>) => {
    setState({ kind: "idle" });
    api.settings.set({ shortcuts: patch }).catch(() => setState({ kind: "idle", problem: t("shortcuts.saveFailed") }));
  };

  /** Salva, ou pergunta antes quando outra ação já usa as mesmas teclas. */
  const choose = (text: string) => {
    if (!isShortcutFor(id, text)) {
      setState({
        kind: "idle",
        problem: id === "agent"
          ? t("shortcuts.notHereAgent", { keys: keys(text) })
          : t("shortcuts.notHereApp", { keys: keys(text) }),
      });
      return;
    }
    const other = conflictOf(shortcuts, id, text);
    if (other && refuses(id, other)) {
      const problem = other === "agent" ? t("shortcuts.takenByCat", { keys: keys(text) }) : t("shortcuts.takenBy", { keys: keys(text), other: name(other) });
      setState({ kind: "idle", problem });
    } else if (other) setState({ kind: "conflict", text, other });
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
            ? t("shortcuts.notAShortcut")
            : t("shortcuts.noPermission"),
        });
      },
    );
  };

  const hint =
    state.kind === "recording"
      ? def.scope === "app"
        ? t("shortcuts.recordApp")
        : id === "agent"
          ? t("shortcuts.recordAgent")
        : id === "cancel"
          ? t("shortcuts.recordCancel")
        : t("shortcuts.record")
      : state.kind === "conflict"
        ? t("shortcuts.conflict", { keys: keys(state.text), other: name(state.other) })
        : state.problem ?? shortcutHint(id, locale);

  return (
    <Row label={name(id)} hint={hint}>
      <div className="kn-shortcut" data-state={state.kind}>
        {state.kind === "conflict" ? (
          <>
            <Button variant="primary" onClick={() => save({ [id]: state.text, [state.other]: null })}>{t("shortcuts.useHere")}</Button>
            <Button onClick={() => setState({ kind: "idle" })}>{t("common.cancel")}</Button>
          </>
        ) : state.kind === "recording" ? (
          <>
            <kbd className="kn-kbd kn-shortcut-key" data-recording="true" aria-live="polite">{t("shortcuts.pressKeys")}</kbd>
            <Button onClick={() => void api.shortcuts.cancelRecord().catch(() => setState({ kind: "idle" }))}>{t("common.cancel")}</Button>
          </>
        ) : (
          <>
            {current !== def.default ? (
              <Button className="kn-button kn-shortcut-reset" onClick={() => choose(def.default)} title={t("shortcuts.resetTo", { keys: keys(def.default) })}>
                {t("shortcuts.reset")}
              </Button>
            ) : null}
            {/* O Kiwi Cat se desliga pelo interruptor dele (spec #12946), não pelo atalho. */}
            {current !== null && id !== "agent" ? (
              <Button className="kn-button kn-shortcut-off" onClick={() => save({ [id]: null })}>{t("shortcuts.turnOff")}</Button>
            ) : null}
            <button
              type="button"
              className="kn-kbd kn-shortcut-key"
              data-off={current === null || undefined}
              disabled={!canRecord || disabled}
              onClick={record}
              aria-label={t("shortcuts.changeAria", { name: name(id), keys: keys(current) })}
              title={canRecord ? t("shortcuts.change") : t("shortcuts.changeNeedsApp")}
            >
              {keys(current)}
            </button>
          </>
        )}
      </div>
    </Row>
  );
}

/**
 * Configurações › Atalhos, por grupo. Os das reuniões aparecem também nos ajustes de reunião. `group`: só os desse grupo
 * (cada assunto de Ajustes mostra os dele, spec #11966); sem ele, todos e as teclas da barra lateral.
 */
export function ShortcutsSection({ group: only }: { group?: ShortcutDef["group"] } = {}) {
  const { t, locale } = useT();
  const shortcuts = useShortcuts();
  // Um engine de antes do T5349: a seção não aparece.
  if (!shortcuts) return null;
  // O do Kiwi Cat fica em Ajustes › Agente, com o interruptor dele (spec #12946).
  const groups = [...new Set(SHORTCUTS.map((s) => s.group))].filter((g) => g !== "Kiwi Cat" && (!only || g === only));
  return (
    <>
      {groups.map((group) => (
        <Section key={group} title={t("shortcuts.section", { group: shortcutGroupName(group, locale) })}>
          {SHORTCUTS.filter((s) => s.group === group).map((s) => (
            <ShortcutRow key={s.id} id={s.id} shortcuts={shortcuts} />
          ))}
        </Section>
      ))}
      {only ? null : <SidebarKeysSection />}
    </>
  );
}

/**
 * As teclas da barra lateral das Notas (spec #10211): fixas, só para ler. Elas valem com o foco na barra; com o foco no
 * editor, as mesmas teclas fazem o que já faziam.
 */
export const SIDEBAR_KEYS: readonly { keys: string; textKey: TextKey }[] = [
  { keys: "↓", textKey: "sidebarKeys.toTree" },
  { keys: "↑ ↓", textKey: "sidebarKeys.move" },
  { keys: "→ ←", textKey: "sidebarKeys.fold" },
  { keys: "↩", textKey: "sidebarKeys.open" },
  { keys: "⇧F10", textKey: "sidebarKeys.menu" },
  { keys: "esc", textKey: "sidebarKeys.close" },
];

export function SidebarKeysSection() {
  const { t } = useT();
  return (
    <Section title={t("sidebarKeys.section")}>
      {SIDEBAR_KEYS.map((k) => (
        <Row key={k.keys} label={t(k.textKey)}>
          <kbd className="kn-kbd kn-shortcut-key" data-fixed="true">
            {k.keys}
          </kbd>
        </Row>
      ))}
    </Section>
  );
}
