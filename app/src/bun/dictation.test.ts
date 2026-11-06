import { describe, expect, test } from "bun:test";

import type { Command, Event, EventMessage, ResultMessage } from "../shared/ipc.ts";
import type { NewHistoryEntry } from "../store/history.ts";
import {
  Dictation,
  type DictationSidecar,
  MIC_LOST_EMPTY,
  MIC_LOST_NOTICE,
  micFellBackNotice,
  micShortName,
  NOT_PASTED,
  NOTE_FAILED,
  noteCreated,
  SECURE_INPUT_NOTICE,
  TRANSCRIPT_ERROR,
} from "./dictation.ts";

type Listener = (e: EventMessage) => void;

/** Um sidecar de mentira: guarda os comandos e responde o `insert.text` como o teste mandar. */
function fakeSidecar(insert: (text: string) => ResultMessage<"insert.text"> = () => ok({ pasted: true, restored: true })) {
  const sent: Command[] = [];
  const listeners = new Map<string, Set<Listener>>();
  return {
    sent,
    emit(e: Event) {
      for (const fn of listeners.get(e.type) ?? []) fn({ ...e, v: 1 } as EventMessage);
    },
    async send<C extends Command>(c: C): Promise<ResultMessage<C["type"]>> {
      sent.push(c);
      if (c.type === "insert.text") return insert(c.text) as ResultMessage<C["type"]>;
      return ok({}) as ResultMessage<C["type"]>;
    },
    on(type: string, fn: Listener) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(fn);
      return () => listeners.get(type)!.delete(fn);
    },
  };
}

function ok<T>(data: T) {
  return { v: 1 as const, type: "result" as const, id: "x", ok: true as const, data } as ResultMessage<any>;
}

const transcript = (text: string, extra: Partial<Extract<Event, { type: "transcript.final" }>> = {}): Event => ({
  type: "transcript.final",
  text,
  raw: text,
  lang: "pt",
  durationMs: 1200,
  latencyMs: 150,
  ...extra,
});

function setup(insert?: Parameters<typeof fakeSidecar>[0]) {
  const sidecar = fakeSidecar(insert);
  const added: NewHistoryEntry[] = [];
  const d = new Dictation({
    sidecar: sidecar as unknown as DictationSidecar,
    history: {
      add: async (e) => {
        added.push(e);
        return { ...e, id: `id${added.length}`, at: new Date().toISOString() } as any;
      },
    },
    log: () => {},
  });
  d.attach();
  const overlays = () => sidecar.sent.filter((c) => c.type === "overlay.state");
  const inserted = () => sidecar.sent.flatMap((c) => (c.type === "insert.text" ? [c.text] : []));
  return { sidecar, d, added, overlays, inserted };
}

describe("Dictation", () => {
  test("a transcript is cleaned for the app it was dictated to, pasted, saved, and the pill says done", async () => {
    const { sidecar, d, added, overlays, inserted } = setup();
    d.setDictionary([{ term: "DICOM", aliases: [] }]);
    sidecar.emit({ type: "app.active", bundleId: "com.apple.Terminal", name: "Terminal", pid: 42 });
    sidecar.emit({ type: "record.started", reason: "hotkey", app: { bundleId: "com.tinyspeck.slackmacgap", name: "Slack" } });
    // The front app changes before the text is ready: the text still goes out with the tone of the app it was dictated to.
    sidecar.emit({ type: "app.active", bundleId: "com.apple.Terminal", name: "Terminal", pid: 42 });
    sidecar.emit(transcript("hum o dicom tá fora do ar"));
    await d.idle();
    expect(inserted()).toEqual(["O DICOM tá fora do ar"]);
    expect(overlays()).toEqual([{ type: "overlay.state", state: "done" }]);
    expect(added).toHaveLength(1);
    expect(added[0]).toMatchObject({ raw: "hum o dicom tá fora do ar", text: "O DICOM tá fora do ar", tone: "casual", app: { name: "Slack" } });
  });

  test("the automatic space is asked for every tone but the literal one (T733)", async () => {
    const { sidecar, d, added } = setup();
    sidecar.emit({ type: "record.started", reason: "hotkey", app: { bundleId: "com.apple.Notes", name: "Notas" } });
    sidecar.emit(transcript("manda para o meu email"));
    sidecar.emit({ type: "record.started", reason: "hotkey", app: { bundleId: "com.apple.Terminal", name: "Terminal" } });
    sidecar.emit(transcript("git status"));
    await d.idle();
    const sent = sidecar.sent.flatMap((c) => (c.type === "insert.text" ? [c.autoSpace] : []));
    expect(added.map((e) => e.tone)).toEqual(["default", "literal"]);
    expect(sent).toEqual([true, false]);
    // The history keeps the text without the space.
    expect(added[1]!.text).toBe("git status");
  });

  test("without record.started.app, the last app.active is the target", async () => {
    const { sidecar, d, added } = setup();
    sidecar.emit({ type: "app.active", bundleId: "com.apple.mail", name: "Mail", pid: 42 });
    sidecar.emit({ type: "record.started", reason: "hotkey" });
    sidecar.emit(transcript("oi ana segue o relatório"));
    await d.idle();
    expect(added[0]!.tone).toBe("formal");
    expect(added[0]!.app).toEqual({ bundleId: "com.apple.mail", name: "Mail" });
  });

  test("a recording that starts before the last one's text arrives: each text keeps its own app (review #521)", async () => {
    const { sidecar, d, added } = setup();
    const mail = { bundleId: "com.apple.mail", name: "Mail" };
    const slack = { bundleId: "com.tinyspeck.slackmacgap", name: "Slack" };
    sidecar.emit({ type: "record.started", reason: "hotkey", app: mail });
    sidecar.emit({ type: "record.stopped", reason: "hotkey", mode: "ptt", durationMs: 900, samples: 14400 });
    sidecar.emit({ type: "record.started", reason: "hotkey", app: slack });
    sidecar.emit(transcript("oi ana segue o relatório"));
    sidecar.emit({ type: "record.stopped", reason: "hotkey", mode: "ptt", durationMs: 900, samples: 14400 });
    sidecar.emit(transcript("beleza valeu"));
    await d.idle();
    expect(added.map((e) => [e.app?.name, e.tone])).toEqual([
      ["Mail", "formal"],
      ["Slack", "casual"],
    ]);
  });

  test("a cancelled or failed recording has no text, so it doesn't take the next text's app", async () => {
    const { sidecar, d, added } = setup();
    sidecar.emit({ type: "record.started", reason: "hotkey", app: { bundleId: "com.apple.mail", name: "Mail" } });
    sidecar.emit({ type: "record.started", reason: "hotkey", app: { bundleId: "com.apple.Terminal", name: "Terminal" } });
    sidecar.emit({ type: "record.cancelled", reason: "hotkey" });
    sidecar.emit({ type: "record.started", reason: "hotkey", app: { bundleId: "com.apple.Notes", name: "Notes" } });
    sidecar.emit({ type: "record.error", reason: "hotkey", error: "device_changed", microphone: "granted" });
    sidecar.emit(transcript("oi ana segue o relatório"));
    await d.idle();
    expect(added.map((e) => e.app?.name)).toEqual(["Mail"]);
  });

  test("L5 (T5458): Esc during a recording cancels it, and nothing is pasted nor kept", async () => {
    const { sidecar, d, added, inserted } = setup();
    sidecar.emit({ type: "record.started", reason: "hotkey", app: { bundleId: "com.apple.mail", name: "Mail" } });
    sidecar.emit({ type: "record.cancelled", reason: "escape" });
    await d.idle();
    expect(inserted()).toEqual([]);
    expect(added).toEqual([]);
  });

  test("onDone also fires for an empty transcript and for transcript.error", async () => {
    const { sidecar, d } = setup();
    const outcomes: unknown[] = [];
    d.onDone = (o) => outcomes.push(o);
    sidecar.emit(transcript(""));
    sidecar.emit({ type: "transcript.error", error: "stt_failed" });
    await d.idle();
    expect(outcomes).toMatchObject([
      { skipped: "empty", pasted: false },
      { skipped: "error", error: "stt_failed", pasted: false },
    ]);
  });

  test("an empty transcript hides the pill and pastes nothing", async () => {
    const { sidecar, d, added, overlays, inserted } = setup();
    sidecar.emit(transcript("   ", { lang: "" }));
    await d.idle();
    expect(inserted()).toEqual([]);
    expect(added).toEqual([]);
    expect(overlays()).toEqual([{ type: "overlay.state", state: "hidden" }]);
  });

  test("snippets expand after the cleanup, exactly as written", async () => {
    const { sidecar, d, inserted } = setup();
    d.setSnippets([{ trigger: "meu e-mail", text: "davi@example.com" }]);
    sidecar.emit(transcript("meu email"));
    sidecar.emit(transcript("manda pro meu e-mail amanhã"));
    await d.idle();
    expect(inserted()).toEqual(["davi@example.com", "Manda pro davi@example.com amanhã."]);
  });

  test("not pasted: the pill says why and that the text is on the clipboard", async () => {
    const { sidecar, d, overlays, added } = setup(() => ok({ pasted: false, restored: false, reason: "no_text_field" }));
    sidecar.emit(transcript("teste"));
    await d.idle();
    expect(overlays()).toEqual([{ type: "overlay.state", state: "error", message: NOT_PASTED.no_text_field }]);
    expect(added).toHaveLength(1);
  });

  test("a focus that isn't a text field: pasted, and the pill says the text is on the clipboard too (T984)", async () => {
    const { sidecar, d, overlays } = setup(() => ok({ pasted: true, restored: false, reason: "no_text_field" }));
    sidecar.emit(transcript("teste"));
    await d.idle();
    expect(overlays()).toEqual([{ type: "overlay.state", state: "done", message: SECURE_INPUT_NOTICE }]);
  });

  test("secure input: done with the short notice (#224)", async () => {
    const { sidecar, d, overlays } = setup(() => ok({ pasted: true, restored: false, reason: "secure_input" }));
    sidecar.emit(transcript("teste"));
    await d.idle();
    expect(overlays()).toEqual([{ type: "overlay.state", state: "done", message: SECURE_INPUT_NOTICE }]);
  });

  test("the mic drops mid-dictation: what it heard is pasted, and the pill says so (T883)", async () => {
    const { sidecar, d, overlays, inserted, added } = setup();
    const stopped = (lost?: "no_audio"): Event => ({
      type: "record.stopped", reason: "hotkey", mode: "ptt", durationMs: 4000, samples: 64_000, ...(lost ? { lost } : {}),
    });
    // One normal dictation still being transcribed, then one where the headset went away.
    sidecar.emit({ type: "record.started", reason: "hotkey", app: { bundleId: "com.apple.Notes", name: "Notas" } });
    sidecar.emit(stopped());
    sidecar.emit({ type: "record.started", reason: "hotkey", app: { bundleId: "com.apple.Notes", name: "Notas" } });
    sidecar.emit(stopped("no_audio"));
    sidecar.emit(transcript("primeiro ditado"));
    sidecar.emit(transcript("o fone desligou no meio"));
    await d.idle();
    expect(inserted()).toEqual(["Primeiro ditado.", "O fone desligou no meio."]);
    expect(overlays()).toEqual([
      { type: "overlay.state", state: "done" },
      { type: "overlay.state", state: "done", message: MIC_LOST_NOTICE },
    ]);
    expect(added).toHaveLength(2);
  });

  test("the mic drops and what it heard has no speech: the old warning, not a silent pill (T883)", async () => {
    const { sidecar, d, overlays, inserted } = setup();
    sidecar.emit({ type: "record.started", reason: "hotkey" });
    sidecar.emit({ type: "record.stopped", reason: "hotkey", mode: "ptt", durationMs: 400, samples: 6400, lost: "device_changed" });
    sidecar.emit(transcript(""));
    await d.idle();
    expect(inserted()).toEqual([]);
    expect(overlays()).toEqual([{ type: "overlay.state", state: "error", message: MIC_LOST_EMPTY }]);
  });

  test("the chosen mic was not connected: the pill says which one recorded (T3344)", async () => {
    const { sidecar, d, overlays, inserted } = setup();
    const stopped: Event = { type: "record.stopped", reason: "hotkey", mode: "ptt", durationMs: 4000, samples: 64_000 };
    sidecar.emit({
      type: "record.started", reason: "hotkey",
      microphone: { name: "Microfone (MacBook Pro)", transport: "builtin", fellBack: true, reason: "chosen device not connected; auto" },
    });
    sidecar.emit(stopped);
    // The next one, with the chosen mic back: no notice.
    sidecar.emit({ type: "record.started", reason: "hotkey", microphone: { name: "Yeti", transport: "usb", fellBack: false } });
    sidecar.emit(stopped);
    sidecar.emit(transcript("gravou pelo do mac"));
    sidecar.emit(transcript("gravou pelo yeti"));
    await d.idle();
    expect(inserted()).toEqual(["Gravou pelo do mac.", "Gravou pelo yeti."]);
    expect(overlays()).toEqual([
      { type: "overlay.state", state: "done", message: "Mic escolhido ausente: usei o do Mac" },
      { type: "overlay.state", state: "done" },
    ]);
  });

  test("the fell-back notice fits the pill (38 letters) with the Mac's mic and the default; the lid is no notice (T3344)", async () => {
    expect(micFellBackNotice(micShortName({ name: "Microfone (MacBook Pro)", transport: "builtin", systemDefault: false })).length).toBeLessThanOrEqual(38);
    expect(micFellBackNotice(micShortName({ name: "", transport: null, systemDefault: true }))).toBe("Mic escolhido ausente: usei o padrão");
    expect(micShortName({ name: "Yeti", transport: "usb", systemDefault: false })).toBe("Yeti");
    const { sidecar, d, overlays } = setup();
    // The Mac's mic chosen by UID, lid closed: it's connected, just silent. Settings explain; the pill says nothing.
    sidecar.emit({ type: "record.started", reason: "hotkey", microphone: { name: "Yeti", transport: "usb", fellBack: true, lidClosed: true } });
    sidecar.emit({ type: "record.stopped", reason: "hotkey", mode: "ptt", durationMs: 4000, samples: 64_000 });
    sidecar.emit(transcript("tampa fechada"));
    await d.idle();
    expect(overlays()).toEqual([{ type: "overlay.state", state: "done" }]);
  });

  test("fell back and the mic also dropped: the drop is the notice that matters (T3344)", async () => {
    const { sidecar, d, overlays } = setup();
    sidecar.emit({ type: "record.started", reason: "hotkey", microphone: { name: "", fellBack: true } });
    sidecar.emit({ type: "record.stopped", reason: "hotkey", mode: "ptt", durationMs: 4000, samples: 64_000, lost: "no_audio" });
    sidecar.emit(transcript("caiu"));
    await d.idle();
    expect(overlays()).toEqual([{ type: "overlay.state", state: "done", message: MIC_LOST_NOTICE }]);
  });

  test("insert.text failing still saves the dictation and shows an error", async () => {
    const fail = { v: 1, type: "result", id: "x", ok: false, error: "sidecar_closed" } as ResultMessage<"insert.text">;
    const { sidecar, d, overlays, added } = setup(() => fail);
    sidecar.emit(transcript("teste"));
    await d.idle();
    expect(overlays()[0]).toMatchObject({ state: "error" });
    expect(added).toHaveLength(1);
  });

  test("dry run (agent tests): insert.text goes with dryRun, and the pill says done", async () => {
    const sidecar = fakeSidecar(() => ok({ pasted: false, restored: false, dryRun: true }));
    const added: unknown[] = [];
    const d = new Dictation({
      sidecar: sidecar as unknown as DictationSidecar,
      history: { add: async (e) => (added.push(e), e as any) },
      dryRun: true,
      log: () => {},
    });
    d.attach();
    let pasted: boolean | undefined;
    d.onDone = (o) => (pasted = o.pasted);
    sidecar.emit(transcript("teste"));
    await d.idle();
    expect(sidecar.sent.find((c) => c.type === "insert.text")).toMatchObject({ dryRun: true, text: "Teste." });
    expect(sidecar.sent.filter((c) => c.type === "overlay.state")).toEqual([{ type: "overlay.state", state: "done" }]);
    expect(pasted).toBe(true);
    expect(added).toHaveLength(1);
  });

  test("without dryRun, insert.text never carries it", async () => {
    const { sidecar, d } = setup();
    sidecar.emit(transcript("teste"));
    await d.idle();
    expect(sidecar.sent.find((c) => c.type === "insert.text")).not.toHaveProperty("dryRun");
  });

  test("transcript.error shows the reason", async () => {
    const { sidecar, d, overlays } = setup();
    sidecar.emit({ type: "transcript.error", error: "model_unavailable" });
    await d.idle();
    expect(overlays()).toEqual([{ type: "overlay.state", state: "error", message: TRANSCRIPT_ERROR.model_unavailable }]);
  });

  test("dictations go out one at a time, in order", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const order: string[] = [];
    const sidecar = fakeSidecar();
    const send = sidecar.send.bind(sidecar);
    sidecar.send = (async (c: Command) => {
      if (c.type === "insert.text") {
        order.push(`start ${c.text}`);
        if (c.text.startsWith("Oi")) await gate;
        order.push(`end ${c.text}`);
      }
      return send(c);
    }) as typeof sidecar.send;
    const d = new Dictation({ sidecar: sidecar as unknown as DictationSidecar, history: { add: async (e) => e as any }, log: () => {} });
    d.attach();
    sidecar.emit(transcript("oi"));
    sidecar.emit(transcript("tchau"));
    await Bun.sleep(5);
    release();
    await d.idle();
    expect(order).toEqual(["start Oi.", "end Oi.", "start Tchau.", "end Tchau."]);
  });

  test("a helper restart drops the recording that died with it: the next dictation keeps its own app (T914)", async () => {
    const { sidecar, d, added } = setup();
    sidecar.emit({ type: "record.started", reason: "hotkey", app: { bundleId: "com.apple.Terminal", name: "Terminal" } });
    // The helper dies before the text and comes back: that recording never gets a transcript.
    sidecar.emit({
      type: "ready",
      version: "t",
      pid: 2,
      hotkey: "fn",
      hotkeyActive: true,
      permissions: { microphone: "granted", accessibility: "granted", inputMonitoring: "granted" },
    });
    sidecar.emit({ type: "record.started", reason: "hotkey", app: { bundleId: "com.apple.Notes", name: "Notas" } });
    sidecar.emit(transcript("o relatório tá pronto"));
    await d.idle();
    expect(added[0]!.app).toEqual({ bundleId: "com.apple.Notes", name: "Notas" });
    expect(added[0]!.tone).not.toBe("literal");
  });

  test("the LLM is prewarmed only when it's on and not for the literal tone", async () => {
    const llm = { name: "foundation-models", available: () => true, complete: async (r: { prompt: string }) => r.prompt };
    const sidecar = fakeSidecar();
    const off = new Dictation({ sidecar: sidecar as unknown as DictationSidecar, history: { add: async (e) => e as any }, log: () => {} });
    off.attach();
    sidecar.emit({ type: "record.started", reason: "hotkey", app: { bundleId: "com.apple.mail", name: "Mail" } });
    expect(sidecar.sent.some((c) => c.type === "llm.prewarm")).toBe(false);
    off.detach();

    const on = new Dictation({ sidecar: sidecar as unknown as DictationSidecar, history: { add: async (e) => e as any }, llm: llm as any, llmMode: "auto", log: () => {} });
    on.attach();
    sidecar.emit({ type: "record.started", reason: "hotkey", app: { bundleId: "com.apple.Terminal", name: "Terminal" } });
    expect(sidecar.sent.some((c) => c.type === "llm.prewarm")).toBe(false);
    sidecar.emit({ type: "record.started", reason: "hotkey", app: { bundleId: "com.apple.mail", name: "Mail" } });
    const warm = sidecar.sent.find((c) => c.type === "llm.prewarm");
    expect(warm && "system" in warm && warm.system).toContain("TONE");
  });

  // ---------------------------------------------------------------- nota rápida (T1320)

  function noteSetup(toNew?: (text: string, at: Date) => Promise<any>) {
    const sidecar = fakeSidecar();
    const added: NewHistoryEntry[] = [];
    const made: { text: string; at: Date; id: string; fresh?: boolean }[] = [];
    const d = new Dictation({
      sidecar: sidecar as unknown as DictationSidecar,
      history: { add: async (e) => (added.push(e), { ...e, id: "id", at: (e.at ?? new Date()).toISOString() } as any) },
      notes: {
        toNew:
          toNew ??
          (async (text, at, id, options) => {
            made.push({ text, at, id, fresh: options?.fresh });
            return { note: { path: "Caixa de entrada/Comprar café.md", title: "Comprar café" }, created: true, already: false } as any;
          }),
      },
      log: () => {},
    });
    d.attach();
    const overlays = () => sidecar.sent.filter((c) => c.type === "overlay.state");
    const inserted = () => sidecar.sent.filter((c) => c.type === "insert.text");
    return { sidecar, d, added, made, overlays, inserted };
  }

  test("nota rápida: o ditado vira nota, não é colado, e vai para o Histórico com a mesma hora", async () => {
    const { sidecar, d, added, made, overlays, inserted } = noteSetup();
    sidecar.emit({ type: "record.started", reason: "hotkey", target: "note", app: { bundleId: "com.apple.Terminal", name: "Terminal" } });
    sidecar.emit(transcript("comprar café e açúcar"));
    await d.idle();
    expect(inserted()).toEqual([]);
    expect(made).toHaveLength(1);
    // O tom padrão, não o literal do terminal que estava na frente: a nota é texto, não comando.
    expect(made[0]!.text).toBe("Comprar café e açúcar.");
    expect(overlays().at(-1)).toMatchObject({ state: "done", message: noteCreated("Comprar café") });
    expect(added).toHaveLength(1);
    expect(added[0]!.text).toBe("Comprar café e açúcar.");
    expect(added[0]!.at).toBe(made[0]!.at);
    // A nota leva o id do ditado no Histórico (T1565), e não procura nada: o id acabou de nascer.
    expect(made[0]).toMatchObject({ id: "id", fresh: true });
    expect(added[0]!.app).toEqual({ bundleId: "com.apple.Terminal", name: "Terminal" });
  });

  test("nota rápida com o mic escolhido ausente: a pílula avisa por qual gravou, como no ditado comum (T3919)", async () => {
    const { sidecar, d, made, overlays } = noteSetup();
    sidecar.emit({
      type: "record.started", reason: "hotkey", target: "note",
      microphone: { name: "Microfone (MacBook Pro)", transport: "builtin", fellBack: true, reason: "chosen device not connected; auto" },
    });
    sidecar.emit({ type: "record.stopped", reason: "hotkey", mode: "ptt", durationMs: 4000, samples: 64_000 });
    // A próxima, com o mic escolhido de volta: o título da nota, sem aviso.
    sidecar.emit({ type: "record.started", reason: "hotkey", target: "note", microphone: { name: "Yeti", transport: "usb", fellBack: false } });
    sidecar.emit({ type: "record.stopped", reason: "hotkey", mode: "ptt", durationMs: 4000, samples: 64_000 });
    sidecar.emit(transcript("comprar café"));
    sidecar.emit(transcript("comprar pão"));
    await d.idle();
    // A nota é criada do mesmo jeito: o aviso só troca o que a pílula diz.
    expect(made.map((m) => m.text)).toEqual(["Comprar café.", "Comprar pão."]);
    expect(overlays().filter((o) => o.state === "done")).toEqual([
      { type: "overlay.state", state: "done", message: micFellBackNotice("do Mac") },
      { type: "overlay.state", state: "done", message: noteCreated("Comprar café") },
    ]);
  });

  test("nota rápida que falha: a pílula avisa, nada é colado, e o texto fica no Histórico", async () => {
    const { sidecar, d, added, overlays, inserted } = noteSetup(async () => {
      throw new Error("disk full");
    });
    sidecar.emit({ type: "record.started", reason: "hotkey", target: "note" });
    sidecar.emit(transcript("uma ideia"));
    await d.idle();
    expect(inserted()).toEqual([]);
    expect(overlays().at(-1)).toMatchObject({ state: "error", message: NOTE_FAILED });
    expect(added.map((e) => e.text)).toEqual(["Uma ideia."]);
  });

  test("nota rápida sem fala: nada de nota nem de Histórico", async () => {
    const { sidecar, d, added, made, overlays } = noteSetup();
    sidecar.emit({ type: "record.started", reason: "hotkey", target: "note" });
    sidecar.emit(transcript("   "));
    await d.idle();
    expect(made).toEqual([]);
    expect(added).toEqual([]);
    expect(overlays().at(-1)).toMatchObject({ state: "hidden" });
  });

  test("só a gravação marcada vira nota: a seguinte, sem ⌥, é colada como sempre", async () => {
    const { sidecar, d, made, inserted } = noteSetup();
    sidecar.emit({ type: "record.started", reason: "hotkey", target: "note" });
    sidecar.emit({ type: "record.started", reason: "hotkey" });
    sidecar.emit(transcript("primeira"));
    sidecar.emit(transcript("segunda"));
    await d.idle();
    expect(made.map((m) => m.text)).toEqual(["Primeira."]);
    expect(inserted().map((c) => (c.type === "insert.text" ? c.text : ""))).toEqual(["Segunda."]);
  });

  test("sem o vault por perto, target: note cai no ditado normal (colado)", async () => {
    const { sidecar, d, inserted } = setup();
    sidecar.emit({ type: "record.started", reason: "hotkey", target: "note" });
    sidecar.emit(transcript("oi"));
    await d.idle();
    expect(inserted()).toEqual(["Oi."]);
  });
});

describe("o ditado da CLI dos agentes (T1740)", () => {
  /** O helper com `simulate`: responde o plano e o espaço como o `SimulatedField` do Swift. */
  const simulated = () =>
    ok({ pasted: false, restored: false, dryRun: true, plan: "paste", spaced: true });

  test("um texto pula o STT, sai limpo com o tom do app, e o insert vai em dryRun com o campo descrito", async () => {
    const { sidecar, d, added } = setup(simulated);
    const out = await d.dictateText("hum manda o laudo pro joão", {
      app: { bundleId: "com.tinyspeck.slackmacgap", name: "Slack" },
      simulate: { textBefore: "Oi." },
    });
    const insert = sidecar.sent.find((c) => c.type === "insert.text")!;
    expect(insert).toMatchObject({ dryRun: true, simulate: { textBefore: "Oi." }, autoSpace: true });
    expect(out).toMatchObject({ raw: "hum manda o laudo pro joão", tone: "casual", pasted: true, app: { bundleId: "com.tinyspeck.slackmacgap" } });
    expect(out.text).not.toContain("hum");
    expect(out.insert).toEqual({ plan: "paste", reason: undefined, autoSpace: true, spaced: true });
    expect(added).toHaveLength(1);
  });

  test("simulado nunca cola de verdade, nem num app sem dryRun; no terminal não há espaço automático", async () => {
    const { sidecar, d } = setup(simulated);
    const out = await d.dictateText("git status", { app: { bundleId: "com.mitchellh.ghostty", name: "Ghostty" } });
    expect(sidecar.sent.find((c) => c.type === "insert.text")).toMatchObject({ dryRun: true, simulate: {}, autoSpace: false });
    expect(out.tone).toBe("literal");
    expect(out.insert?.autoSpace).toBe(false);
  });

  test("a nota rápida pela CLI vira nota e não chama o insert", async () => {
    const sidecar = fakeSidecar();
    const made: string[] = [];
    const d = new Dictation({
      sidecar: sidecar as unknown as DictationSidecar,
      history: { add: async (e) => ({ ...e, id: "h1", at: "" }) as any },
      notes: { toNew: async (text) => (made.push(text), { note: { path: "Caixa de entrada/Oi.md", title: "Oi" } as any, created: true, already: false }) },
      log: () => {},
    });
    d.attach();
    const out = await d.dictateText("Oi.", { note: true });
    expect(made).toEqual(["Oi."]);
    expect(out.note?.note.path).toBe("Caixa de entrada/Oi.md");
    expect(sidecar.sent.some((c) => c.type === "insert.text")).toBe(false);
  });

  test("um wav vai ao debug.transcribe com o app e o target, e resolve com o ditado daquela gravação", async () => {
    const { sidecar, d } = setup(simulated);
    const pending = d.dictateWav("/tmp/x.wav", { app: { bundleId: "com.apple.mail", name: "Mail" }, simulate: { textBefore: "" } });
    await Bun.sleep(0);
    expect(sidecar.sent.find((c) => c.type === "debug.transcribe")).toEqual({
      type: "debug.transcribe",
      path: "/tmp/x.wav",
      app: { bundleId: "com.apple.mail", name: "Mail" },
    });
    // O helper manda os eventos de uma gravação, como no `debug.transcribe` de verdade.
    sidecar.emit({ type: "record.started", reason: "debug", app: { bundleId: "com.apple.mail", name: "Mail" } });
    sidecar.emit(transcript("bom dia equipe", { latencyMs: 321 }));
    const out = await pending;
    expect(out).toMatchObject({ raw: "bom dia equipe", sttMs: 321, tone: "formal" });
    expect(sidecar.sent.find((c) => c.type === "insert.text")).toMatchObject({ dryRun: true, simulate: { textBefore: "" } });
  });

  test("um ditado de verdade no meio não pega o campo simulado, e o STT que falha resolve com o erro", async () => {
    const { sidecar, d } = setup(simulated);
    const pending = d.dictateWav("/tmp/y.wav");
    await Bun.sleep(0);
    // Uma gravação pelo atalho (reason: hotkey) não consome o pedido da CLI.
    sidecar.emit({ type: "record.started", reason: "hotkey" });
    sidecar.emit({ type: "record.started", reason: "debug" });
    sidecar.emit(transcript("um"));
    sidecar.emit({ type: "transcript.error", error: "stt_failed" });
    const out = await pending;
    expect(out).toMatchObject({ skipped: "error", error: "stt_failed" });
    await d.idle();
    const inserts = sidecar.sent.filter((c) => c.type === "insert.text");
    expect(inserts).toHaveLength(1);
    expect(inserts[0]).not.toHaveProperty("simulate");
  });

  test("o helper recusa o debug.transcribe: rejeita, e o próximo record.started não fica com o pedido", async () => {
    const sidecar = fakeSidecar();
    const original = sidecar.send.bind(sidecar);
    (sidecar as any).send = async (c: Command) =>
      c.type === "debug.transcribe" ? { v: 1, type: "result", id: "x", ok: false, error: "already_recording" } : original(c);
    const d = new Dictation({ sidecar: sidecar as unknown as DictationSidecar, history: { add: async (e) => ({ ...e, id: "h", at: "" }) as any }, log: () => {} });
    d.attach();
    await expect(d.dictateWav("/tmp/z.wav")).rejects.toThrow("already_recording");
    let done = 0;
    d.onDone = () => void done++;
    sidecar.emit({ type: "record.started", reason: "debug" });
    sidecar.emit(transcript("dois"));
    await d.idle();
    expect(done).toBe(1);
  });

  test("o helper reinicia no meio: o pedido resolve com helper_restarted em vez de ficar pendurado", async () => {
    const { sidecar, d } = setup(simulated);
    const pending = d.dictateWav("/tmp/w.wav");
    await Bun.sleep(0);
    sidecar.emit({ type: "ready", version: "x", pid: 1, hotkey: "fn", hotkeyActive: false, permissions: {} } as any);
    expect(await pending).toMatchObject({ skipped: "error", error: "helper_restarted" });
  });
});
