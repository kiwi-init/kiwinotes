import { afterEach, expect, test } from "bun:test";
import {
  mkdir,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import {
  RecordingRecoveries,
  RECOVERY_TTL_MS,
  recoveryHistoryId,
} from "./recording-recovery.ts";
import { HistoryStore } from "./history.ts";
import { tempDir } from "../../test/tmp.ts";
const rigs: { dir: string; recoveries: RecordingRecoveries }[] = [];
const nowAt = Date.parse("2026-11-06T12:00:00Z");
async function rig() {
  const dir = tempDir("kn-recover-");
  let now = nowAt;
  const recoveries = new RecordingRecoveries(dir, () => now),
    history = new HistoryStore(dir, recoveries);
  rigs.push({ dir, recoveries });
  return {
    dir,
    recoveries,
    history,
    setNow: (value: number) => {
      now = value;
    },
  };
}
let next = 0;
function wav(frames = 1600) {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + frames * 2, 4);
  header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(16000, 24);
  header.writeUInt32LE(32000, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(frames * 2, 40);
  return Buffer.concat([header, Buffer.alloc(frames * 2)]);
}
async function recording(r: Awaited<ReturnType<typeof rig>>, at = nowAt) {
  const id = `00000000-0000-4000-8000-${String(++next).padStart(12, "0")}`,
    date = new Date(at).toISOString();
  await mkdir(r.recoveries.dir, { recursive: true, mode: 0o700 });
  const file = path.join(r.recoveries.dir, id + ".wav"),
    meta = path.join(r.recoveries.dir, id + ".json");
  await writeFile(file, wav(), { mode: 0o600 });
  await writeFile(
    meta,
    JSON.stringify({
      id,
      at: date,
      app: { bundleId: "fake.app", name: "Synthetic" },
    }),
    { mode: 0o600 },
  );
  return { id, at: date, file, meta, historyId: recoveryHistoryId(id, date) };
}
afterEach(async () => {
  for (const r of rigs.splice(0)) {
    r.recoveries.stop();
    await rm(r.dir, { recursive: true, force: true });
  }
});

test("interrupted WAV becomes a retry row; active recording stays hidden; ack removes only managed files", async () => {
  const r = await rig(),
    rec = await recording(r);
  expect(await r.history.search()).toMatchObject({
    entries: [
      {
        id: rec.historyId,
        text: "",
        recoveryId: rec.id,
        recoveryError: "interrupted",
        durationMs: 100,
      },
    ],
  });
  r.recoveries.activate(rec);
  expect((await r.history.search()).entries).toEqual([]);
  await r.recoveries.fail(rec.id, "stt_failed");
  expect((await r.history.get(rec.historyId))?.recoveryError).toBe(
    "stt_failed",
  );
  await r.recoveries.complete(rec.id);
  expect((await r.history.search()).entries).toEqual([]);
  expect(await readdir(r.recoveries.dir)).toEqual([]);
});
test("saved transcript wins over its pending row, retry upserts the same id, ack hides retry without losing text", async () => {
  const r = await rig(),
    rec = await recording(r);
  const input = {
    raw: "synthetic",
    text: "First",
    at: new Date(rec.at),
    recoveryId: rec.id,
  };
  const first = await r.history.add(input);
  expect(first.id).toBe(rec.historyId);
  expect((await r.history.search()).entries).toMatchObject([
    { id: first.id, text: "First", recoveryId: rec.id },
  ]);
  await r.history.add({ ...input, text: "Retried" });
  expect((await r.history.search()).entries).toHaveLength(1);
  const files = await readdir(r.history.dir);
  const stored = await readFile(path.join(r.history.dir, files[0]!), "utf8");
  expect(stored.trim().split("\n")).toHaveLength(1);
  await r.recoveries.complete(rec.id);
  expect(await r.history.get(first.id)).toMatchObject({ text: "Retried" });
  expect(await r.history.get(first.id)).not.toHaveProperty("recoveryId");
});
test("mixed pending/saved history pages have no holes, duplicates or placeholder text search hits", async () => {
  const r = await rig();
  for (let i = 0; i < 5; i++) {
    await recording(r, nowAt - i * 120000);
    await r.history.add({
      raw: "special",
      text: "special",
      app: { name: "Synthetic" },
      at: new Date(nowAt - i * 120000 - 60000),
    });
  }
  let before: string | undefined;
  const ids: string[] = [];
  do {
    const page = await r.history.search({ limit: 3, before });
    ids.push(...page.entries.map((e) => e.id));
    before = page.nextBefore;
  } while (before);
  expect(ids).toHaveLength(10);
  expect(new Set(ids).size).toBe(10);
  expect(ids).toEqual([...ids].sort().reverse());
  expect((await r.history.search({ query: "special" })).entries).toHaveLength(
    5,
  );
  expect((await r.history.search({ query: "Synthetic" })).entries).toHaveLength(
    10,
  );
});
test("old files expire; active/retrying files are protected until their operation ends", async () => {
  const r = await rig(),
    old = await recording(r, nowAt - RECOVERY_TTL_MS - 1),
    active = await recording(r, nowAt - RECOVERY_TTL_MS - 1);
  r.recoveries.activate(active);
  await r.recoveries.prune();
  expect(await Bun.file(old.file).exists()).toBe(false);
  expect(await Bun.file(active.file).exists()).toBe(true);
  await r.recoveries.fail(active.id, "interrupted");
  await r.recoveries.prune();
  expect(await Bun.file(active.file).exists()).toBe(false);
  const rec = await recording(r);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let started = false;
  const running = r.recoveries.withRetry(rec.id, async () => {
    started = true;
    await gate;
    expect(await r.recoveries.get(rec.id)).not.toBeNull();
  });
  while (!started) await Bun.sleep(1);
  r.setNow(nowAt + RECOVERY_TTL_MS + 1);
  await r.recoveries.prune();
  expect(await Bun.file(rec.file).exists()).toBe(true);
  release();
  await running;
  await r.recoveries.prune();
  expect(await Bun.file(rec.file).exists()).toBe(false);
});
test("retry is singleflight and deleting a pending item removes the audio and manifest", async () => {
  const r = await rig(),
    rec = await recording(r);
  let calls = 0,
    release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const work = async () => {
    calls++;
    await gate;
    return r.recoveries.get(rec.id);
  };
  const first = r.recoveries.withRetry(rec.id, work),
    second = r.recoveries.withRetry(rec.id, work);
  while (!calls) await Bun.sleep(1);
  expect(calls).toBe(1);
  expect(await r.history.delete(rec.historyId)).toBe(true);
  release();
  expect(await first).toBeNull();
  expect(await second).toBeNull();
  expect(await readdir(r.recoveries.dir)).toEqual([]);
  await expect(
    r.history.add({
      raw: "late",
      text: "late",
      at: new Date(rec.at),
      recoveryId: rec.id,
    }),
  ).rejects.toThrow("E_RECOVERY_EXPIRED");
  expect((await r.history.search()).entries).toEqual([]);
});
test("paths and symlinked WAVs cannot be read; deletion never follows the link", async () => {
  const r = await rig(),
    rec = await recording(r);
  const outside = path.join(r.dir, "outside.wav");
  await writeFile(outside, wav());
  await rm(rec.file);
  await symlink(outside, rec.file);
  expect(await r.recoveries.get(rec.id)).toBeNull();
  expect(await r.recoveries.get("../../outside")).toBeNull();
  await expect(
    r.recoveries.withRetry("../../outside", async () => {}),
  ).rejects.toMatchObject({ code: "E_BAD_RECOVERY" });
  await r.recoveries.complete(rec.id);
  expect(await readFile(outside)).toEqual(wav());
});
test("a missing/corrupt manifest can still recover the app's intact PCM file", async () => {
  const r = await rig(),
    rec = await recording(r);
  await writeFile(rec.meta, "{");
  const recovered = await r.recoveries.get(rec.id);
  expect(recovered?.id).toBe(rec.id);
  expect(recovered?.app).toBeUndefined();
});


test("pending audio does not hide the last available text from L9",async()=>{
 const r=await rig();
 await r.history.add({raw:"last text",text:"Last text.",at:new Date(nowAt-60000)});
 await recording(r,nowAt);
 expect((await r.history.search({limit:1})).entries[0]?.text).toBe("");
 expect((await r.history.latestText())?.text).toBe("Last text.");
});
