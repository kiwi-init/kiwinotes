// Histórico local de cada ditado (T57): um arquivo JSONL por dia em <dados>/history/,
// legível e fácil de apagar. O áudio é opcional e fica desligado por padrão.

import { randomBytes } from "node:crypto";
import { appendFile, readdir, readFile } from "node:fs/promises";
import path from "node:path";

import { ensureDir, writeAtomic } from "./files.ts";
import { fold } from "./text.ts";
import { isRecoveryId, recoveryHistoryId } from "./recording-recovery.ts";

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
  /** A managed local recording still available for a retry; absent once acknowledged or expired. */
  recoveryId?: string;
  recoveryError?: string;
  expiresAt?: string;
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

/** O id mais novo que um arquivo de dia pode ter: o fim do dia no fuso mais a oeste, com folga (UTC−12). */
function latestIn(file: string): string {
  const start = Date.parse(`${file.slice(0, 10)}T00:00:00.000Z`);
  return new Date(start + 24 * 3600_000 + MAX_TZ_SPREAD_MS).toISOString();
}

export interface HistoryRecoverySource {
  list(): Promise<HistoryEntry[]>;
  canWrite?(id:string):Promise<boolean>;
  deleteHistory(id: string): Promise<boolean>;
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

  constructor(dataDir: string, private recoveries?: HistoryRecoverySource) {
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
    const recordingId = isRecoveryId(input.recoveryId) ? input.recoveryId : undefined;
    // Serialized with delete: a retry finishing after deletion must not recreate the deleted item.
    if(recordingId&&this.recoveries?.canWrite&&!await this.recoveries.canWrite(recordingId))throw new Error("E_RECOVERY_EXPIRED");
    const entry: HistoryEntry = {
      ...rest,
      recoveryId: recordingId,
      id: recordingId ? recoveryHistoryId(recordingId, when.toISOString()) : `${when.toISOString()}-${randomBytes(2).toString("hex")}`,
      at: when.toISOString(),
      raw: input.raw.slice(0, MAX_TEXT),
      text: input.text.slice(0, MAX_TEXT),
    };
    await ensureDir(this.dir);
    let replaced = false;
    if (recordingId) {
      const from = dayOf(new Date(when.getTime()-MAX_TZ_SPREAD_MS)), to = dayOf(new Date(when.getTime()+MAX_TZ_SPREAD_MS));
      for (const day of await this.days()) {
        if(day.slice(0,10)<from||day.slice(0,10)>to)continue;
        const file=path.join(this.dir,day), lines=(await readFile(file,"utf8")).split("\n").filter(Boolean);
        let found=false;
        const next=lines.map(line=>{try{if(JSON.parse(line).id===entry.id){found=true;return JSON.stringify(entry);}}catch{}return line;});
        if(found){await writeAtomic(file,next.join("\n")+"\n");replaced=true;break;}
      }
    }
    if(!replaced) await appendFile(path.join(this.dir, `${dayOf(when)}.jsonl`), `${JSON.stringify(entry)}\n`, { mode: 0o600 });
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
  async search(params: {query?:string;limit?:number;before?:string} = {}):Promise<HistoryPage>{
    const saved=await this.savedSearch(params);
    if(!this.recoveries)return saved;
    const pending=await this.pending();
    const byId=new Map(pending.map(entry=>[entry.id,entry]));
    const words=fold(params.query??"").split(/\s+/).filter(Boolean);
    const candidates=pending.filter(entry=>(!params.before||entry.id<params.before)&&words.every(word=>fold(`${entry.text}\n${entry.raw}\n${entry.app?.name??""}`).includes(word)));
    const merged=new Map(candidates.map(entry=>[entry.id,entry]));
    for(const entry of saved.entries)merged.set(entry.id,this.enrich(entry,byId.get(entry.id)));
    const entries=[...merged.values()].sort((a,b)=>a.id<b.id?1:-1);
    const max=Math.min(Math.max(1,params.limit??50),500);
    const page=entries.slice(0,max);
    const hasMore=entries.length>max||!!saved.nextBefore;
    return {entries:page,...(hasMore&&page.length?{nextBefore:page.at(-1)!.id}:{})};
  }

  private pending():Promise<HistoryEntry[]>{
    return this.recoveries!.list().catch(()=>{console.warn("[history] recovery_list_failed");return [];});
  }
  private enrich(entry:HistoryEntry,pending?:HistoryEntry):HistoryEntry{
    const {recoveryId:_id,recoveryError:_error,expiresAt:_expiry,...saved}=entry;
    return pending?{...saved,recoveryId:pending.recoveryId,recoveryError:pending.recoveryError,expiresAt:pending.expiresAt}:saved;
  }

  /** L9: a failed/pending audio item has no text to paste; use the latest saved transcript. */
  async latestText():Promise<HistoryEntry|null>{return (await this.savedSearch({limit:1})).entries[0]??null;}

  private async savedSearch({ query = "", limit = 50, before }: { query?: string; limit?: number; before?: string } = {}): Promise<HistoryPage> {
    const words = fold(query).split(/\s+/).filter(Boolean);
    const max = Math.min(Math.max(1, limit), 500);
    const entries: HistoryEntry[] = [];
    // Com cursor, os dias mais novos que ele não têm nada para esta página.
    const cursorDay = before ? cursorFile(before) : undefined;
    const days = (await this.days()).filter((day) => !cursorDay || day <= cursorDay);
    for (const [i, day] of days.entries()) {
      for (const e of await this.readDay(day)) {
        if (before && e.id >= before) continue;
        if (words.length) {
          const hay = fold(`${e.text}\n${e.raw}\n${e.app?.name ?? ""}`);
          if (!words.every((w) => hay.includes(w))) continue;
        }
        entries.push(e);
      }
      if (entries.length <= max) continue;
      // O arquivo leva o dia local de quem ditou, então um dia mais velho ainda pode ter um ditado mais novo, de
      // outro fuso (T914). Para quando nenhum dos próximos arquivos pode ter algo mais novo que o último da página.
      entries.sort((a, b) => (a.id < b.id ? 1 : -1));
      const next = days[i + 1];
      if (!next || latestIn(next) < entries[max - 1]!.id) break;
    }
    entries.sort((a, b) => (a.id < b.id ? 1 : -1));
    return entries.length > max ? { entries: entries.slice(0, max), nextBefore: entries[max - 1]!.id } : { entries };
  }

  /** Apaga um ditado (e só ele) reescrevendo o arquivo do dia. */
  /** Um ditado pelo id, ou null. Só lê os arquivos de dia em volta da hora do id (o fuso de quem ditou muda o dia). */
  async get(id:string):Promise<HistoryEntry|null>{
    const saved=await this.savedGet(id);
    if(!this.recoveries)return saved;
    const pending=(await this.pending()).find(entry=>entry.id===id);
    return saved?this.enrich(saved,pending):pending??null;
  }

  private async savedGet(id: string): Promise<HistoryEntry | null> {
    const at = Date.parse(id.slice(0, 24));
    if (Number.isNaN(at)) return null;
    const from = `${dayOf(new Date(at - MAX_TZ_SPREAD_MS))}.jsonl`;
    const to = `${dayOf(new Date(at + MAX_TZ_SPREAD_MS))}.jsonl`;
    for (const file of await this.days()) {
      if (file < from || file > to) continue;
      const hit = (await this.readDay(file)).find((e) => e.id === id);
      if (hit) return hit;
    }
    return null;
  }

  delete(id: string): Promise<boolean> {
    return this.serialize(async () => {
      const saved=await this.remove(id);
      const recovery=await this.recoveries?.deleteHistory(id);
      return saved||recovery===true;
    });
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
