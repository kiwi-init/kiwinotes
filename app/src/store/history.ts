// Histórico local de cada ditado (T57): um arquivo JSONL por dia em <dados>/history/,
// legível e fácil de apagar. O áudio é opcional e fica desligado por padrão.

import { randomBytes } from "node:crypto";
import { appendFile, readdir, readFile } from "node:fs/promises";
import path from "node:path";

import { ensureDir, writeAtomic } from "./files.ts";
import { fold } from "./text.ts";

export interface HistoryEntry {
  /** Ordena no tempo: `<ISO>-<4 hex>`. */
  id: string;
  /** ISO 8601 em UTC. */
  at: string;
  /** App em foco (evento `app.active`). */
  app?: { bundleId?: string; name?: string };
  /** O que o STT entregou. */
  raw: string;
  /** O que foi inserido. */
  text: string;
  tone?: string;
  lang?: string;
  durationMs?: number;
  /** Só quando "Guardar o áudio no histórico" está ligado. */
  audioPath?: string;
}

export type NewHistoryEntry = Omit<HistoryEntry, "id" | "at"> & { at?: Date };

export interface HistoryPage {
  entries: HistoryEntry[];
  /** Passe em `before` para a próxima página; ausente quando acabou. */
  nextBefore?: string;
}

const DAY_FILE = /^\d{4}-\d{2}-\d{2}\.jsonl$/;
const MAX_TEXT = 100_000;

/** Dia local do arquivo (o histórico agrupa pelo dia de quem ditou, não pelo UTC). */
function dayOf(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** A maior diferença entre dois fusos (UTC−12 a UTC+14). */
const MAX_TZ_SPREAD_MS = 26 * 3600_000;

/**
 * O arquivo de dia mais novo que ainda pode ter ditados de antes do cursor (`<ISO UTC>-<hex>`). O arquivo leva o
 * dia no fuso de quando a pessoa ditou, e o cursor é lido no fuso de agora: quem viajou para o oeste teria um dia
 * pulado (#416). A margem do maior desvio entre fusos custa ler um arquivo a mais e nunca pula nada.
 */
export function cursorFile(id: string): string | undefined {
  const at = new Date(id.slice(0, 24));
  return Number.isNaN(at.getTime()) ? undefined : `${dayOf(new Date(at.getTime() + MAX_TZ_SPREAD_MS))}.jsonl`;
}

export class HistoryStore {
  readonly dir: string;
  private listeners = new Set<(e: HistoryEntry) => void>();
  /**
   * Uma escrita por vez. O `delete` lê, filtra e troca o arquivo do dia; um `add` no meio disso
   * (um ditado chegando enquanto a pessoa apaga outro) sumiria no rename.
   */
  private writes: Promise<unknown> = Promise.resolve();

  private serialize<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.writes.then(fn, fn);
    this.writes = run.catch(() => {});
    return run;
  }

  constructor(dataDir: string) {
    this.dir = path.join(dataDir, "history");
  }

  /** Avisa as janelas abertas (Histórico) quando entra um ditado. */
  onAdded(fn: (e: HistoryEntry) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  add(input: NewHistoryEntry): Promise<HistoryEntry> {
    return this.serialize(() => this.append(input));
  }

  private async append(input: NewHistoryEntry): Promise<HistoryEntry> {
    const when = input.at ?? new Date();
    const { at: _ignored, ...rest } = input;
    const entry: HistoryEntry = {
      ...rest,
      id: `${when.toISOString()}-${randomBytes(2).toString("hex")}`,
      at: when.toISOString(),
      raw: input.raw.slice(0, MAX_TEXT),
      text: input.text.slice(0, MAX_TEXT),
    };
    await ensureDir(this.dir);
    await appendFile(path.join(this.dir, `${dayOf(when)}.jsonl`), `${JSON.stringify(entry)}\n`, { mode: 0o600 });
    for (const fn of this.listeners) fn(entry);
    return entry;
  }

  /** Dias com histórico, do mais novo para o mais velho. */
  private async days(): Promise<string[]> {
    try {
      return (await readdir(this.dir)).filter((f) => DAY_FILE.test(f)).sort().reverse();
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw e;
    }
  }

  private async readDay(file: string): Promise<HistoryEntry[]> {
    const text = await readFile(path.join(this.dir, file), "utf8");
    const out: HistoryEntry[] = [];
    for (const line of text.split("\n")) {
      if (!line.trim()) continue;
      try {
        const e = JSON.parse(line) as HistoryEntry;
        if (typeof e.id === "string" && typeof e.text === "string") out.push(e);
      } catch {
        // Uma linha estragada (editada à mão) não esconde as outras.
      }
    }
    return out.sort((a, b) => (a.id < b.id ? 1 : -1));
  }

  /**
   * Os ditados mais novos primeiro. `query` casa sem acento e sem maiúscula, e todas as
   * palavras precisam aparecer (no texto final, no cru ou no nome do app).
   */
  async search({ query = "", limit = 50, before }: { query?: string; limit?: number; before?: string } = {}): Promise<HistoryPage> {
    const words = fold(query).split(/\s+/).filter(Boolean);
    const max = Math.min(Math.max(1, limit), 500);
    const entries: HistoryEntry[] = [];
    // Com cursor, os dias mais novos que ele não têm nada para esta página.
    const cursorDay = before ? cursorFile(before) : undefined;
    for (const day of await this.days()) {
      if (cursorDay && day > cursorDay) continue;
      for (const e of await this.readDay(day)) {
        if (before && e.id >= before) continue;
        if (words.length) {
          const hay = fold(`${e.text}\n${e.raw}\n${e.app?.name ?? ""}`);
          if (!words.every((w) => hay.includes(w))) continue;
        }
        entries.push(e);
        if (entries.length > max) return { entries: entries.slice(0, max), nextBefore: entries[max - 1]!.id };
      }
    }
    return { entries };
  }

  /** Apaga um ditado (e só ele) reescrevendo o arquivo do dia. */
  delete(id: string): Promise<boolean> {
    return this.serialize(() => this.remove(id));
  }

  private async remove(id: string): Promise<boolean> {
    for (const day of await this.days()) {
      const file = path.join(this.dir, day);
      const lines = (await readFile(file, "utf8")).split("\n").filter((l) => l.trim());
      const kept = lines.filter((l) => {
        try {
          return (JSON.parse(l) as HistoryEntry).id !== id;
        } catch {
          return true;
        }
      });
      if (kept.length !== lines.length) {
        await writeAtomic(file, kept.length ? `${kept.join("\n")}\n` : "");
        return true;
      }
    }
    return false;
  }
}
