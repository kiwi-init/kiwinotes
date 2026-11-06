// T5455: only the app's own UUID files. No arbitrary paths, device APIs or network.
import { constants } from "node:fs";
import { lstat, open, readdir, rm } from "node:fs/promises";
import path from "node:path";
import { writeJson } from "./files.ts";
import type { HistoryEntry } from "./history.ts";

export const RECOVERY_TTL_MS = 7 * 24 * 60 * 60_000;
export const isRecoveryId = (id: unknown): id is string =>
  typeof id === "string" &&
  /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(id);
export const recoveryHistoryId = (id: string, at: string) =>
  `${new Date(at).toISOString()}-recovery-${id}`;
export interface RecordingRef {
  id: string;
  at: string;
}
export interface RecoveryRecording extends RecordingRef {
  app?: { bundleId: string; name?: string };
  target?: "note";
  error?: string;
  durationMs: number;
  expiresAt: string;
}
export class RecoveryError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}
const ERRORS = new Set([
  "stt_failed",
  "stt_empty",
  "model_unavailable",
  "helper_restarted",
  "interrupted",
  "insert_failed",
  "note_failed",
  "record_error",
  "recording_storage",
]);

export class RecordingRecoveries {
  readonly dir: string;
  private active = new Set<string>();
  private retries = new Map<string, Promise<unknown>>();
  private listeners = new Set<() => void>();
  private writes: Promise<unknown> = Promise.resolve();
  private timer?: Timer;
  constructor(
    dataDir: string,
    private now: () => number = Date.now,
    private ttl = RECOVERY_TTL_MS,
  ) {
    this.dir = path.join(dataDir, "recovery", "dictation");
  }
  onChanged(fn: () => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  private changed() {
    for (const fn of this.listeners) fn();
  }
  private serial<T>(work: () => Promise<T>): Promise<T> {
    const job = this.writes.then(work, work);
    this.writes = job.catch(() => {});
    return job;
  }
  start() {
    if (this.timer) return;
    void this.prune().catch(() => console.warn("[recovery] expiry_failed"));
    this.timer = setInterval(
      () =>
        void this.prune().catch(() => console.warn("[recovery] expiry_failed")),
      60 * 60_000,
    );
    this.timer.unref();
  }
  stop() {
    clearInterval(this.timer);
    this.timer = undefined;
  }
  activate(ref: RecordingRef) {
    if (isRecoveryId(ref?.id)) {
      this.active.add(ref.id);
      this.changed();
    }
  }
  async interrupted() {
    const ids = [...this.active];
    this.active.clear();
    for (const id of ids) await this.fail(id, "interrupted");
    this.changed();
  }
  async fail(id: string, error: string) {
    if (!isRecoveryId(id)) return;
    await this.serial(async () => {
      this.active.delete(id);
      const record = await this.read(id);
      if (record)
        await writeJson(this.file(id, "json"), {
          id,
          at: record.at,
          app: record.app,
          target: record.target,
          error: ERRORS.has(error) ? error : "stt_failed",
        });
    });
    this.changed();
  }
  async complete(id: string) {
    if (!isRecoveryId(id)) return;
    await this.serial(async () => {
      this.active.delete(id);
      await this.remove(id);
    });
    this.changed();
  }
  async withRetry<T>(
    id: string,
    work: (record: RecoveryRecording) => Promise<T>,
  ): Promise<T> {
    if (!isRecoveryId(id)) throw new RecoveryError("E_BAD_RECOVERY");
    if (this.active.has(id)) throw new RecoveryError("E_RECORDING_ACTIVE");
    const existing = this.retries.get(id);
    if (existing) return existing as Promise<T>;
    const job = Promise.resolve().then(async () => {
      const record = await this.read(id);
      if (!record || Date.parse(record.expiresAt) <= this.now())
        throw new RecoveryError("E_RECOVERY_EXPIRED");
      return work(record);
    });
    this.retries.set(id, job);
    try {
      return await job;
    } finally {
      if (this.retries.get(id) === job) this.retries.delete(id);
    }
  }
  async get(id: string): Promise<RecoveryRecording | null> {
    if (!isRecoveryId(id)) return null;
    const record = await this.read(id);
    return record &&
      (Date.parse(record.expiresAt) > this.now() ||
        this.active.has(id) ||
        this.retries.has(id))
      ? record
      : null;
  }
  async canWrite(id: string): Promise<boolean> {
    return !!(await this.get(id));
  }
  async list(): Promise<HistoryEntry[]> {
    await this.prune();
    const rows: HistoryEntry[] = [];
    for (const id of await this.ids()) {
      if (this.active.has(id)) continue;
      const record = await this.get(id);
      if (!record) continue;
      rows.push({
        id: recoveryHistoryId(id, record.at),
        at: record.at,
        raw: "",
        text: "",
        app: record.app,
        durationMs: record.durationMs,
        recoveryId: id,
        recoveryError: record.error ?? "interrupted",
        expiresAt: record.expiresAt,
      });
    }
    return rows.sort((a, b) => b.id.localeCompare(a.id));
  }
  async deleteHistory(id: string): Promise<boolean> {
    const row = (await this.list()).find((row) => row.id === id);
    if (!row?.recoveryId) return false;
    await this.complete(row.recoveryId);
    return true;
  }
  async prune() {
    await this.serial(async () => {
      let removed = false;
      for (const id of await this.ids()) {
        if (this.active.has(id) || this.retries.has(id)) continue;
        const at = await this.createdAt(id);
        if (at !== null && this.now() - at >= this.ttl) {
          await this.remove(id);
          removed = true;
        }
      }
      if (removed) this.changed();
    });
  }
  private file(id: string, ext: "wav" | "json") {
    return path.join(this.dir, `${id}.${ext}`);
  }
  private async ids(): Promise<string[]> {
    const entries = await readdir(this.dir).catch((e) => {
      if (e.code === "ENOENT") return [];
      throw e;
    });
    return [
      ...new Set(
        entries
          .map((name) => name.replace(/\.(?:wav|json)$/, ""))
          .filter(isRecoveryId),
      ),
    ];
  }
  private async readJson(id: string): Promise<Record<string, unknown> | null> {
    try {
      const handle = await open(
        this.file(id, "json"),
        constants.O_RDONLY | constants.O_NOFOLLOW,
      );
      try {
        const stat = await handle.stat();
        if (!stat.isFile() || stat.size > 16_384) return null;
        const value = JSON.parse(await handle.readFile("utf8"));
        return value &&
          typeof value === "object" &&
          !Array.isArray(value) &&
          value.id === id
          ? value
          : null;
      } finally {
        await handle.close();
      }
    } catch {
      return null;
    }
  }
  private async createdAt(id: string): Promise<number | null> {
    const metadata = await this.readJson(id);
    if (
      typeof metadata?.at === "string" &&
      Number.isFinite(Date.parse(metadata.at))
    )
      return Date.parse(metadata.at);
    for (const ext of ["wav", "json"] as const) {
      const stat = await lstat(this.file(id, ext)).catch(() => null);
      if (stat?.isFile() && !stat.isSymbolicLink())
        return stat.birthtimeMs > 0 ? stat.birthtimeMs : stat.mtimeMs;
    }
    return null;
  }
  private async read(id: string): Promise<RecoveryRecording | null> {
    try {
      const handle = await open(
        this.file(id, "wav"),
        constants.O_RDONLY | constants.O_NOFOLLOW,
      );
      let bytes: number;
      try {
        const stat = await handle.stat();
        if (!stat.isFile() || stat.size <= 44 || stat.size > 0xffff_ffff)
          return null;
        const header = Buffer.alloc(44);
        const read = await handle.read(header, 0, 44, 0);
        if (
          read.bytesRead !== 44 ||
          header.toString("ascii", 0, 4) !== "RIFF" ||
          header.toString("ascii", 8, 16) !== "WAVEfmt " ||
          header.readUInt16LE(20) !== 1 ||
          header.readUInt16LE(22) !== 1 ||
          header.readUInt32LE(24) !== 16000 ||
          header.readUInt16LE(34) !== 16 ||
          header.toString("ascii", 36, 40) !== "data"
        )
          return null;
        bytes = stat.size - 44;
      } finally {
        await handle.close();
      }
      const at = await this.createdAt(id);
      if (at === null) return null;
      const metadata = await this.readJson(id);
      const app = metadata?.app as Record<string, unknown> | undefined;
      const validApp =
        app && typeof app.bundleId === "string" && app.bundleId.length <= 256
          ? {
              bundleId: app.bundleId,
              ...(typeof app.name === "string" && app.name.length <= 256
                ? { name: app.name }
                : {}),
            }
          : undefined;
      return {
        id,
        at: new Date(at).toISOString(),
        app: validApp,
        target: metadata?.target === "note" ? "note" : undefined,
        error:
          typeof metadata?.error === "string" && ERRORS.has(metadata.error)
            ? metadata.error
            : undefined,
        durationMs: Math.floor((Math.floor(bytes / 2) / 16000) * 1000),
        expiresAt: new Date(at + this.ttl).toISOString(),
      };
    } catch {
      return null;
    }
  }
  private async remove(id: string) {
    for (const ext of ["wav", "json"] as const)
      await rm(this.file(id, ext), { force: true });
  }
}
