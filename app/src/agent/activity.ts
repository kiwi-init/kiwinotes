// O registro do agente (spec #8356): para cada pedido, o que ele leu e o que mudou nas notas, com a cópia do texto de
// antes de cada mudança. É o que o `agent activity` mostra, e o que o desfazer (`undo.ts`, spec #9353) usa.
//
// - **Fora do cofre,** nos dados do app: `<dados>/agent/activity/<carimbo>_<id do pedido>/`, com o `request.json` e as
//   cópias (`copy-1.md`, `copy-2.md`…). Pastas 0700 e arquivos 0600, como a sessão do agente.
// - **A cópia de antes é do próprio registro:** não depende do histórico de versões das Notas, que guarda até 50
//   versões por nota e pode apagar a mais velha. Ela é gravada antes da escrita no cofre (`keep`), e sai se a escrita
//   não acontece (`drop`).
// - **30 dias:** cada pedido novo apaga as pastas com mais de 30 dias, com as cópias.
// - Uma operação por vez, na ordem em que chegaram: duas ferramentas ao mesmo tempo não atropelam o `request.json`.
// - **Avisa quem escuta** (`onChanged`, spec #9480) quando um pedido começa, quando o agente lê ou muda uma nota e
//   quando algo é desfeito: a tela "Atividade do agente" lê de novo, também depois de um desfazer pela CLI.
// - **O número de uma cópia nunca se repete** no pedido (spec #9353): o último usado fica no `request.json` antes de a
//   cópia ser gravada, e um app reaberto continua dele, mesmo que uma cópia do meio tenha saído (`drop`).

import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import type { ToolChange } from "./tools/tools.ts";

/** Quanto o registro guarda cada pedido, com as cópias. */
export const ACTIVITY_KEEP_MS = 30 * 86_400_000;
/** O começo do pedido que o registro guarda, para a pessoa reconhecer qual foi. */
export const ACTIVITY_REQUEST_CHARS = 300;
/** Quantos pedidos o `list` devolve, no máximo. */
export const ACTIVITY_LIST_MAX = 200;

export interface ActivityRead {
  at: string;
  tool: string;
  target?: string;
  /** Quantos segredos o filtro segurou nesta leitura (spec #9818): só a contagem. */
  held?: number;
}

export interface ActivityChange extends ToolChange {
  at: string;
  /** Quando a mudança foi desfeita (spec #9353). */
  undone?: string;
}

export interface ActivityRequest {
  id: string;
  /** Quando o pedido começou (ISO 8601). */
  at: string;
  /** O começo do texto do pedido, já filtrado (spec #9818): um segredo colado no pedido não vai para o disco. */
  request: string;
  /** Quantos segredos o filtro segurou no texto do pedido. */
  requestHeld?: number;
  reads: ActivityRead[];
  changes: ActivityChange[];
}

/** O `request.json` como fica no disco: com o último número de cópia usado, que não sai no `list`. */
interface StoredRequest extends ActivityRequest {
  copies?: number;
}

export interface ActivityOptions {
  /** `<dados>/agent/activity`. */
  dir: string;
  now?: () => number;
  keepMs?: number;
}

/** O carimbo da pasta: a hora ISO sem `:` nem `.`, que ordena como texto. */
const stampOf = (ms: number) => new Date(ms).toISOString().replace(/[:.]/g, "-");
const STAMP = /^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z_(.+)$/;
const timeOf = (name: string): number | null => {
  const m = STAMP.exec(name);
  return m ? Date.parse(`${m[1]}T${m[2]}:${m[3]}:${m[4]}.${m[5]}Z`) : null;
};
/** O id de um pedido vira nome de pasta: só letras, números, `-` e `_`. */
const safeId = (id: string) => {
  if (!/^[\w-]{1,100}$/.test(id)) throw new Error(`bad request id: ${id}`);
  return id;
};
const COPY = /^copy-\d+\.md$/;

interface Open {
  dir: string;
  record: StoredRequest;
}

/** O número de uma marca ou de um arquivo de cópia (`…copy-7.md` → 7). */
const copyNumber = (name: string | undefined) => Number(/copy-(\d+)\.md$/.exec(name ?? "")?.[1] ?? 0);
const shown = ({ copies: _, ...r }: StoredRequest): ActivityRequest => r;

export class AgentActivity {
  private readonly dir: string;
  private readonly now: () => number;
  private readonly keepMs: number;
  private readonly open = new Map<string, Open>();
  private queue: Promise<unknown> = Promise.resolve();
  private readonly listeners = new Set<(request: string) => void>();

  constructor(o: ActivityOptions) {
    this.dir = o.dir;
    this.now = o.now ?? Date.now;
    this.keepMs = o.keepMs ?? ACTIVITY_KEEP_MS;
  }

  /** Avisa `fn` (com o id do pedido) a cada mudança no registro (spec #9480). Devolve como parar. */
  onChanged(fn: (request: string) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Um pedido começou. Apaga antes os pedidos com mais de 30 dias. */
  begin(id: string, request: string, held = 0): Promise<void> {
    return this.serial(async () => {
      await this.prune();
      const o = await this.ensure(id, request);
      if (held && !o.record.requestHeld) {
        o.record.requestHeld = held;
        await this.save(o);
      }
      this.changed(id);
    });
  }

  /** O agente leu (ou procurou) algo pelas ferramentas do Kiwi. */
  read(id: string, r: { tool: string; target?: string; held?: number }): Promise<void> {
    return this.serial(async () => {
      const o = await this.ensure(id);
      o.record.reads.push({ at: new Date(this.now()).toISOString(), tool: r.tool, ...(r.target ? { target: r.target } : {}), ...(r.held ? { held: r.held } : {}) });
      await this.save(o);
      this.changed(id);
    });
  }

  /** O agente mudou uma nota. */
  change(id: string, c: ToolChange): Promise<void> {
    return this.serial(async () => {
      const o = await this.ensure(id);
      o.record.changes.push({ at: new Date(this.now()).toISOString(), ...c });
      await this.save(o);
      this.changed(id);
    });
  }

  /** Guarda o texto de antes de uma escrita, antes dela. Devolve a marca da cópia (`<id>/copy-N.md`). */
  keep(id: string, before: string): Promise<string> {
    return this.serial(async () => {
      const o = await this.ensure(id);
      // O número vai para o `request.json` antes da cópia: um app que reabre nunca volta a usar este.
      o.record.copies = (o.record.copies ?? 0) + 1;
      await this.save(o);
      const name = `copy-${o.record.copies}.md`;
      await writeFile(path.join(o.dir, name), before, { mode: 0o600 });
      return `${id}/${name}`;
    });
  }

  /** A escrita não aconteceu: a cópia sai. */
  drop(copy: string): Promise<void> {
    return this.serial(async () => {
      const at = await this.copyPath(copy);
      if (at) await rm(at, { force: true });
    });
  }

  /** O texto de uma cópia (`keep`). */
  async copy(copy: string): Promise<string> {
    const at = await this.serial(() => this.copyPath(copy));
    if (!at) throw Object.assign(new Error(`no copy ${copy}`), { code: "E_NOT_FOUND" });
    try {
      return await readFile(at, "utf8");
    } catch {
      throw Object.assign(new Error(`no copy ${copy}`), { code: "E_NOT_FOUND" });
    }
  }

  /** Um pedido do registro, ou null se ele não está (nunca existiu, ou passou dos 30 dias). Não cria nada. */
  get(id: string): Promise<ActivityRequest | null> {
    return this.serial(async () => {
      const o = await this.lookup(id);
      return o ? shown(structuredClone(o.record)) : null;
    });
  }

  /**
   * Anota o desfazer (spec #9353): as mudanças `indexes` (0 é a primeira) do pedido foram desfeitas agora. Uma já
   * desfeita fica com a hora de antes.
   */
  markUndone(id: string, indexes: number[]): Promise<void> {
    return this.serial(async () => {
      const o = await this.lookup(id);
      if (!o) throw Object.assign(new Error(`no request ${id}`), { code: "E_NOT_FOUND" });
      const at = new Date(this.now()).toISOString();
      for (const i of indexes) {
        const c = o.record.changes[i];
        if (c && !c.undone) c.undone = at;
      }
      await this.save(o);
      this.changed(id);
    });
  }

  /** Os pedidos dos últimos 30 dias, do mais novo para o mais velho. */
  list(limit = 50): Promise<ActivityRequest[]> {
    return this.serial(async () => {
      const out: ActivityRequest[] = [];
      const oldest = this.now() - this.keepMs;
      for (const name of (await this.names()).reverse()) {
        if (out.length >= Math.min(Math.max(1, limit), ACTIVITY_LIST_MAX)) break;
        // Mais velho que o prazo: ainda no disco até o próximo pedido apagar, mas fora do registro.
        if (timeOf(name)! < oldest) break;
        const r = await this.load(path.join(this.dir, name));
        if (r) out.push(shown(r));
      }
      return out;
    });
  }

  // ---------------------------------------------------------------- por dentro

  /** Avisa quem escuta; um erro de quem escuta não derruba o registro. */
  private changed(id: string): void {
    for (const fn of this.listeners) {
      try {
        fn(id);
      } catch {
        // quem escuta cuida dos próprios erros
      }
    }
  }

  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.queue.then(fn, fn);
    this.queue = next.catch(() => {});
    return next;
  }

  /** As pastas de pedidos, da mais velha para a mais nova. */
  private async names(): Promise<string[]> {
    const all = await readdir(this.dir).catch(() => [] as string[]);
    return all.filter((n) => timeOf(n) !== null).sort();
  }

  private async load(dir: string): Promise<StoredRequest | null> {
    try {
      const r = JSON.parse(await readFile(path.join(dir, "request.json"), "utf8")) as StoredRequest;
      return r && typeof r.id === "string" && Array.isArray(r.reads) && Array.isArray(r.changes) ? r : null;
    } catch {
      return null;
    }
  }

  /** O pedido aberto, ou o de antes de o app reabrir (pela pasta); null se não há. */
  private async lookup(id: string): Promise<Open | null> {
    const known = this.open.get(safeId(id));
    if (known) return known;
    const existing = (await this.names()).find((n) => STAMP.exec(n)![6] === id);
    if (!existing) return null;
    const dir = path.join(this.dir, existing);
    const record = await this.load(dir);
    if (!record) return null;
    // Um registro de antes do spec #9353 não tem o último número: continua do maior que aparece, nos arquivos ou
    // nas marcas das mudanças.
    const files = (await readdir(dir).catch(() => [] as string[])).filter((n) => COPY.test(n));
    record.copies = Math.max(record.copies ?? 0, ...files.map(copyNumber), ...record.changes.map((c) => copyNumber(c.copy)));
    const o = { dir, record };
    this.open.set(id, o);
    return o;
  }

  /** O pedido aberto, ou um novo (com o texto vazio, se a ferramenta chegou sem pedido). */
  private async ensure(id: string, request = ""): Promise<Open> {
    const known = await this.lookup(id);
    if (known) return known;
    const at = this.now();
    const dir = path.join(this.dir, `${stampOf(at)}_${id}`);
    await mkdir(dir, { recursive: true, mode: 0o700 });
    const o: Open = {
      dir,
      record: { id, at: new Date(at).toISOString(), request: request.slice(0, ACTIVITY_REQUEST_CHARS), reads: [], changes: [] },
    };
    this.open.set(id, o);
    await this.save(o);
    return o;
  }

  /** Grava o `request.json` de uma vez: um arquivo temporário e o `rename`. */
  private async save(o: Open): Promise<void> {
    const file = path.join(o.dir, "request.json");
    const tmp = `${file}.tmp`;
    await writeFile(tmp, JSON.stringify(o.record, null, 2) + "\n", { mode: 0o600 });
    await rename(tmp, file);
  }

  /** Onde fica uma cópia, pela marca `<id>/copy-N.md`; null se a marca não é de um pedido conhecido. */
  private async copyPath(copy: string): Promise<string | null> {
    const m = /^([\w-]{1,100})\/(copy-\d+\.md)$/.exec(copy);
    if (!m) return null;
    const o = this.open.get(m[1]!);
    if (o) return path.join(o.dir, m[2]!);
    const name = (await this.names()).find((n) => STAMP.exec(n)![6] === m[1]);
    return name ? path.join(this.dir, name, m[2]!) : null;
  }

  /** Apaga os pedidos com mais de `keepMs`, com as cópias. */
  private async prune(): Promise<void> {
    const oldest = this.now() - this.keepMs;
    for (const name of await this.names()) {
      if (timeOf(name)! >= oldest) break;
      await rm(path.join(this.dir, name), { recursive: true, force: true });
      this.open.delete(STAMP.exec(name)![6]!);
    }
  }
}
