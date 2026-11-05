// Rascunho do que não foi gravado (T1506, nota do review #1502). Fechar a janela com um conflito ou um erro de save na
// tela não dá para segurar; então cada edição pendente fica também no `localStorage` da janela, fora do vault, e some
// quando a gravação passa ou quando a pessoa descarta. Ao reabrir a nota, a janela oferece recuperar ou descartar.
//
// Só na máquina: o `localStorage` da view (views://internal) é do app, nunca do vault, e nada disso sai do Mac.
// Uma UI mais velha (rollback do AppEngine) só ignora as chaves; por isso o `UI_DATA_SCHEMA` não muda.

export interface Draft {
  path: string;
  /** O corpo da nota como estava no editor (sem o frontmatter). */
  body: string;
  /**
   * O frontmatter da nota quando a edição começou (tags, propriedades), para o órfão recuperado como nota nova não
   * perder nada (#1538). Rascunho de antes do T1550 não tem: vale "".
   */
  frontmatter?: string;
  /** A versão do disco em que a edição começou: se mudou, a nota foi mexida depois. */
  baseVersion: string;
  /** ISO 8601. */
  at: string;
}

const PREFIX = "kiwi.notes.draft.v1:";
/** Rascunho mais velho que isso não é oferecido de volta e sai da janela ao abrir. */
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

/** O que o rascunho usa do `localStorage` (os testes passam um de mentira). */
export type DraftStorage = Pick<Storage, "getItem" | "setItem" | "removeItem" | "key" | "length">;

function windowStorage(): DraftStorage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null; // storage bloqueado: a janela segue, só sem rascunho
  }
}

export class Drafts {
  constructor(
    private storage: DraftStorage | null = windowStorage(),
    private now: () => number = Date.now,
    private namespace = "",
  ) {}

  private owns(key:string|null):key is string{if(!key?.startsWith(this.prefix()))return false;return Boolean(this.namespace)||!/^kiwi\.notes\.draft\.v1:[a-f0-9]{20}:/.test(key);}

  private prefix(){return this.namespace?`${PREFIX}${this.namespace}:`:PREFIX;}

  get(path: string): Draft | null {
    try {
      const raw = this.storage?.getItem(this.prefix() + path);
      if (!raw) return null;
      const d = JSON.parse(raw) as Draft;
      if (d.path !== path || typeof d.body !== "string" || this.now() - Date.parse(d.at) > MAX_AGE_MS) return null;
      return { ...d, frontmatter: typeof d.frontmatter === "string" ? d.frontmatter : "" };
    } catch {
      return null;
    }
  }

  set(d: Omit<Draft, "at">): void {
    try {
      this.storage?.setItem(this.prefix() + d.path, JSON.stringify({ ...d, at: new Date(this.now()).toISOString() }));
    } catch {
      // cota cheia: o save de verdade continua tentando, só não há rascunho
    }
  }

  remove(path: string): void {
    try {
      this.storage?.removeItem(this.prefix() + path);
    } catch {}
  }

  /** Todos os rascunhos válidos (para achar os órfãos: o de uma nota que não existe mais). */
  all(): Draft[] {
    const s = this.storage;
    const out: Draft[] = [];
    if (!s) return out;
    try {
      for (let i = 0; i < s.length; i++) {
        const k = s.key(i);
        const d = this.owns(k) ? this.get(k.slice(this.prefix().length)) : null;
        if (d) out.push(d);
      }
    } catch {}
    return out.sort((a, b) => a.at.localeCompare(b.at));
  }

  /** Tira os rascunhos velhos ou estragados. */
  prune(): void {
    const s = this.storage;
    if (!s) return;
    try {
      const keys: string[] = [];
      for (let i = 0; i < s.length; i++) {
        const k = s.key(i);
        if (this.owns(k)) keys.push(k);
      }
      for (const k of keys) if (!this.get(k.slice(this.prefix().length))) s.removeItem(k);
    } catch {}
  }
}

/** O `notes.delete` que também apaga o rascunho da nota: o texto não fica num 2º lugar depois de ir para a Lixeira (#1525). */
export function forgetDraftOnDelete<A extends { delete(path: string): Promise<unknown> }>(api: A, drafts: Drafts): A {
  return Object.assign(Object.create(api) as A, {
    delete: async (path: string) => {
      const r = await api.delete(path);
      drafts.remove(path);
      return r;
    },
  });
}
