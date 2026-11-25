import { useEffect, useState } from "react";

import { api, type Snippet } from "../src/api.ts";
import { useT } from "../src/i18n.ts";
import { LoadError, type LoadState, RemoveIcon, rowKey, SavedNote, useAutosave } from "../src/kit/editable.tsx";
import { Button, HoverLabel, Section } from "../src/kit/index.tsx";

type Row = Snippet & { key: string; isNew?: boolean };

/** Frases faladas que viram texto pronto: "meu e-mail" → o endereço. */
export function SnippetsSection() {
  const { t } = useT();
  const [rows, setRows] = useState<Row[]>([]);
  const [state, setState] = useState<LoadState>("loading");
  const loaded = state === "ready";

  const load = () => {
    setState("loading");
    api.snippets.get().then(
      (snippets) => {
        setRows(snippets.map((s) => ({ ...s, key: rowKey() })));
        setState("ready");
      },
      // Um snippets.json que não abre (editado à mão): avisa, e nada é salvo por cima dele (T914).
      () => setState("error"),
    );
  };
  useEffect(load, []);

  const status = useAutosave(
    rows,
    (r) => api.snippets.set(r.filter((s) => s.trigger.trim() && s.text.trim()).map(({ trigger, text }) => ({ trigger, text }))),
    loaded,
  );
  const incomplete = rows.filter((r) => !r.trigger.trim() !== !r.text.trim()).length;
  const update = (key: string, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  return (
    <Section title={t("snippets.section")}>
      {state === "error" ? (
        <LoadError file="snippets.json" onRetry={load} />
      ) : rows.length === 0 ? (
        <div className="kn-list-empty">{t("snippets.empty")}</div>
      ) : (
        rows.map((r) => (
          <div className="kn-list-row" key={r.key} data-new={r.isNew}>
            <input
              className="kn-input"
              data-strong="true"
              style={{ width: 170 }}
              value={r.trigger}
              placeholder={t("snippets.triggerPlaceholder")}
              aria-label={t("snippets.trigger")}
              autoFocus={r.isNew}
              onChange={(e) => update(r.key, { trigger: e.target.value })}
            />
            <textarea
              className="kn-textarea"
              style={{ flex: 1 }}
              rows={Math.min(5, Math.max(1, r.text.split("\n").length))}
              value={r.text}
              placeholder={t("snippets.textPlaceholder")}
              aria-label={r.trigger ? t("snippets.textOf", { trigger: r.trigger }) : t("snippets.textOfEmpty")}
              onChange={(e) => update(r.key, { text: e.target.value })}
            />
            <button
              type="button"
              className="kn-icon-button kn-expand"
              data-tone="danger"
              aria-label={r.trigger ? t("snippets.remove", { trigger: r.trigger }) : t("snippets.removeEmpty")}
              onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))}
            >
              <RemoveIcon />
              <HoverLabel>{t("common.remove")}</HoverLabel>
            </button>
          </div>
        ))
      )}
      <div className="kn-list-footer">
        <Button disabled={!loaded} onClick={() => setRows((rs) => [...rs, { key: rowKey(), trigger: "", text: "", isNew: true }])}>
          {t("snippets.add")}
        </Button>
        <SavedNote {...status} incomplete={incomplete} />
      </div>
    </Section>
  );
}
