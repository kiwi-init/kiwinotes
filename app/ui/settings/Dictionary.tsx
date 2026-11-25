import { Fragment, useEffect, useState } from "react";

import { api, type DictionaryTerm } from "../src/api.ts";
import { useT } from "../src/i18n.ts";
import { LoadError, type LoadState, RemoveIcon, rowKey, SavedNote, useAutosave } from "../src/kit/editable.tsx";
import { Button, HoverLabel, Section } from "../src/kit/index.tsx";

type Row = { key: string; term: string; aliases: string; isNew?: boolean };

const toRows = (terms: DictionaryTerm[]): Row[] => terms.map((t) => ({ key: rowKey(), term: t.term, aliases: t.aliases.join(", ") }));
const toTerms = (rows: Row[]): DictionaryTerm[] =>
  rows
    .filter((r) => r.term.trim())
    .map((r) => ({ term: r.term.trim(), aliases: r.aliases.split(",").map((a) => a.trim()).filter(Boolean) }));

/** Termos que o STT deve reconhecer e que a limpeza nunca muda (ORBIT, SILO, nomes de pessoas). */
export function DictionarySection() {
  const { t } = useT();
  const [rows, setRows] = useState<Row[]>([]);
  const [state, setState] = useState<LoadState>("loading");
  const loaded = state === "ready";

  const load = () => {
    setState("loading");
    api.dictionary.get().then(
      (terms) => {
        setRows(toRows(terms));
        setState("ready");
      },
      // Um dictionary.json que não abre (editado à mão): avisa, e nada é salvo por cima dele (T914).
      () => setState("error"),
    );
  };
  useEffect(load, []);

  const status = useAutosave(rows, (r) => api.dictionary.set(toTerms(r)), loaded);
  const incomplete = rows.filter((r) => !r.term.trim() && r.aliases.trim()).length;
  // Aliases que trocariam texto de verdade ("New York" → IAM, #434): avisa embaixo do termo, sem bloquear.
  const [warnings, setWarnings] = useState<Map<string, string[]>>(new Map());
  useEffect(() => {
    if (!loaded) return;
    const timer = setTimeout(() => {
      api.dictionary.check(toTerms(rows)).then(
        (list) => {
          const byTerm = new Map<string, string[]>();
          for (const w of list) byTerm.set(w.term, [...(byTerm.get(w.term) ?? []), w.text]);
          setWarnings(byTerm);
        },
        () => {},
      );
    }, 300);
    return () => clearTimeout(timer);
  }, [rows, loaded]);
  const update = (key: string, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  return (
    <Section title={t("dictionary.section")}>
      {state === "error" ? (
        <LoadError file="dictionary.json" onRetry={load} />
      ) : rows.length === 0 ? (
        <div className="kn-list-empty">{t("dictionary.empty")}</div>
      ) : (
        rows.map((r) => (
          <Fragment key={r.key}>
            <div className="kn-list-row" data-new={r.isNew}>
              <input
                className="kn-input"
                data-strong="true"
                style={{ width: 170 }}
                value={r.term}
                placeholder={t("dictionary.termPlaceholder")}
                aria-label={t("dictionary.term")}
                autoFocus={r.isNew}
                onChange={(e) => update(r.key, { term: e.target.value })}
              />
              <input
                className="kn-input"
                style={{ flex: 1 }}
                value={r.aliases}
                placeholder={t("dictionary.aliasesPlaceholder")}
                aria-label={t("dictionary.aliasesOf", { term: r.term })}
                onChange={(e) => update(r.key, { aliases: e.target.value })}
              />
              <button
                type="button"
                className="kn-icon-button kn-expand"
                data-tone="danger"
                aria-label={r.term ? t("dictionary.remove", { term: r.term }) : t("dictionary.removeEmpty")}
                onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))}
              >
                <RemoveIcon />
                <HoverLabel>{t("common.remove")}</HoverLabel>
              </button>
            </div>
            {(warnings.get(r.term.trim()) ?? []).map((text) => (
              <div className="kn-list-warning" role="note" key={text}>
                {text}
              </div>
            ))}
          </Fragment>
        ))
      )}
      <div className="kn-list-footer">
        <Button disabled={!loaded} onClick={() => setRows((rs) => [...rs, { key: rowKey(), term: "", aliases: "", isNew: true }])}>
          {t("dictionary.add")}
        </Button>
        <SavedNote {...status} incomplete={incomplete} />
      </div>
    </Section>
  );
}
