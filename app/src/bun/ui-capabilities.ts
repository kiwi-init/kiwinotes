// As capacidades do contrato 1.0.0 (src/shared/ui-contract.ts): o único jeito de uma UI do AppEngine pedir algo ao
// main (T1192). Cada handler valida os argumentos e responde `E_BAD_ARGS` quando eles não servem. Nada genérico: não
// há "rodar comando" nem "ler arquivo qualquer".

import type { DictionaryTerm, HistoryEntry, HistoryPage, Snippet } from "../shared/ui-contract.ts";
import { CLIPBOARD_MAX_CHARS, UI_CAPABILITIES, type UiCapabilities, type UiCapability } from "../shared/ui-contract.ts";
import { aliasWarnings, aliasWarningText } from "../store/aliasCheck.ts";
import { MAX_TERMS, sanitizeTerms } from "../store/dictionary.ts";
import { sanitizeSnippets } from "../store/snippets.ts";

/** O que as capacidades usam do app. Nos testes, tudo de mentira. */
export interface CapabilityDeps {
  dictionary: { load(): Promise<DictionaryTerm[]>; save(terms: DictionaryTerm[]): Promise<DictionaryTerm[]> };
  snippets: { load(): Promise<Snippet[]>; save(snippets: Snippet[]): Promise<Snippet[]> };
  history: {
    search(params: { query?: string; limit?: number; before?: string }): Promise<HistoryPage>;
    delete(id: string): Promise<boolean>;
  };
  /** O STT e a limpeza passam a usar o dicionário e os snippets novos já no próximo ditado. */
  dictionaryChanged?(terms: DictionaryTerm[]): void;
  snippetsChanged?(snippets: Snippet[]): void;
  clipboardWrite(text: string): void;
  /** Agora, em ms (para o limite de ritmo do clipboard). */
  now?(): number;
}

/** Um erro com código, que o AppEngine passa à UI como está (`E_BAD_ARGS`). */
export class CapabilityError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

const bad = (message: string) => new CapabilityError("E_BAD_ARGS", message);

function object(args: unknown, cap: string): Record<string, unknown> {
  if (args === undefined || args === null) return {};
  if (typeof args !== "object" || Array.isArray(args)) throw bad(`${cap}: args must be an object`);
  return args as Record<string, unknown>;
}

function noArgs(args: unknown, cap: string): void {
  const a = object(args, cap);
  if (Object.keys(a).length) throw bad(`${cap}: takes no args`);
}

function list(value: unknown, field: string, max: number): unknown[] {
  if (!Array.isArray(value)) throw bad(`${field} must be an array`);
  if (value.length > max) throw bad(`${field} has more than ${max} items`);
  return value;
}

function optionalString(value: unknown, field: string, max: number): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw bad(`${field} must be a string`);
  if (value.length > max) throw bad(`${field} is longer than ${max}`);
  return value;
}

/** Os handlers do contrato, por nome. O AppEngine recusa (`E_NO_CAPABILITY`) qualquer nome fora daqui. */
export function uiCapabilities(deps: CapabilityDeps): Record<UiCapability, (args: unknown) => Promise<unknown> | unknown> {
  const now = deps.now ?? Date.now;
  // O main não vê o clique: a UI só chama no gesto (navigator.userActivation), e aqui vai um limite de ritmo para uma
  // UI que tente encher o clipboard sozinha.
  let lastCopy = -Infinity;

  const handlers: { [K in UiCapability]: (args: unknown) => Promise<UiCapabilities[K]["result"]> | UiCapabilities[K]["result"] } = {
    "dictionary.get": (args) => {
      noArgs(args, "dictionary.get");
      return deps.dictionary.load();
    },
    "dictionary.set": async (args) => {
      const terms = sanitizeTerms(list(object(args, "dictionary.set").terms, "terms", MAX_TERMS * 2));
      const saved = await deps.dictionary.save(terms);
      deps.dictionaryChanged?.(saved);
      return saved;
    },
    "dictionary.check": (args) => {
      const terms = sanitizeTerms(list(object(args, "dictionary.check").terms, "terms", MAX_TERMS * 2));
      return aliasWarnings(terms).map((w) => ({ ...w, text: aliasWarningText(w) }));
    },
    "snippets.get": (args) => {
      noArgs(args, "snippets.get");
      return deps.snippets.load();
    },
    "snippets.set": async (args) => {
      const snippets = sanitizeSnippets(list(object(args, "snippets.set").snippets, "snippets", 2000));
      const saved = await deps.snippets.save(snippets);
      deps.snippetsChanged?.(saved);
      return saved;
    },
    "history.search": (args) => {
      const a = object(args, "history.search");
      const query = optionalString(a.query, "query", 500);
      const before = optionalString(a.before, "before", 64);
      if (a.limit !== undefined && (typeof a.limit !== "number" || !Number.isInteger(a.limit) || a.limit < 1 || a.limit > 500)) {
        throw bad("limit must be an integer from 1 to 500");
      }
      return deps.history.search({ query, before, limit: a.limit as number | undefined });
    },
    "history.delete": (args) => {
      const id = optionalString(object(args, "history.delete").id, "id", 128);
      if (!id) throw bad("id is required");
      return deps.history.delete(id);
    },
    "clipboard.write": (args) => {
      const text = object(args, "clipboard.write").text;
      if (typeof text !== "string") throw bad("text must be a string");
      if (text.length > CLIPBOARD_MAX_CHARS) throw bad(`text is longer than ${CLIPBOARD_MAX_CHARS} characters`);
      const t = now();
      if (t - lastCopy < 300) throw new CapabilityError("E_RATE", "clipboard.write: too soon after the last copy");
      lastCopy = t;
      deps.clipboardWrite(text);
      return true;
    },
  };
  // A lista do contrato e os handlers andam juntos.
  for (const cap of UI_CAPABILITIES) if (!handlers[cap]) throw new Error(`no handler for ${cap}`);
  return handlers;
}

export type { HistoryEntry };
