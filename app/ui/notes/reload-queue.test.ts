import { describe, expect, test } from "bun:test";
import { ReloadQueue } from "./reload-queue.ts";

/** Um fetch que só termina quando o teste manda, e conta as chamadas. */
function fake() {
  const pending: ((v: number) => void)[] = [];
  let n = 0;
  return {
    fetch: () => new Promise<number>((resolve) => { n++; pending.push(resolve); }),
    get calls() { return n; },
    finish: async (v = n) => { pending.shift()?.(v); await Bun.sleep(0); },
  };
}

describe("ReloadQueue (spec #20118)", () => {
  test("o aviso do engine e o after() da mesma operação: uma lista só", async () => {
    const f = fake();
    const q = new ReloadQueue(f.fetch);
    const echo = q.changed(["Solta.md", "Solta dois.md"]);
    const mine = q.after(["Solta.md", "Solta dois.md"]);
    expect(mine).toBe(echo);
    await f.finish(1);
    expect(await mine).toBe(1);
    expect(f.calls).toBe(1);
  });

  test("criar: o after() com só o caminho novo acha a recarga do aviso", async () => {
    const f = fake();
    const q = new ReloadQueue(f.fetch);
    q.changed(["Projeto X/Nova.md"]);
    void q.after(["Projeto X/Nova.md"]);
    expect(f.calls).toBe(1);
  });

  test("sem aviso, o after() pede a lista, como antes", async () => {
    const f = fake();
    const q = new ReloadQueue(f.fetch);
    const mine = q.after(["Projeto X/Nova.md"]);
    await f.finish(7);
    expect(await mine).toBe(7);
    expect(f.calls).toBe(1);
  });

  test("um aviso de outro caminho não serve à operação", async () => {
    const f = fake();
    const q = new ReloadQueue(f.fetch);
    q.changed(["Outra.md"]);
    await f.finish();
    void q.after(["Projeto X/Nova.md"]);
    expect(f.calls).toBe(2);
  });

  test("o aviso velho não cobre uma operação nova do mesmo caminho", async () => {
    const f = fake();
    let now = 0;
    const q = new ReloadQueue(f.fetch, () => now, 3000);
    q.changed(["Solta.md"]);
    await f.finish();
    now = 3001;
    void q.after(["Solta.md"]);
    expect(f.calls).toBe(2);
  });

  test("um aviso durante uma recarga em andamento: mais uma no fim, uma só para todos", async () => {
    const f = fake();
    const q = new ReloadQueue(f.fetch);
    const first = q.request();
    const a = q.changed(["A.md"]);
    const b = q.changed(["B.md"]);
    const c = q.request();
    expect(a).toBe(b);
    expect(c).toBe(a);
    expect(f.calls).toBe(1);
    await f.finish(1);
    expect(await first).toBe(1);
    expect(f.calls).toBe(2);
    await f.finish(2);
    expect(await a).toBe(2);
    expect(f.calls).toBe(2);
  });

  test("o aviso usado sai, com os outros caminhos dele: a operação seguinte sem aviso pede", async () => {
    const f = fake();
    const q = new ReloadQueue(f.fetch);
    q.changed(["Velha.md", "Nova.md"]);
    await f.finish();
    void q.after(["Velha.md", "Nova.md"]);
    expect(f.calls).toBe(1);
    void q.after(["Nova.md"]);
    expect(f.calls).toBe(2);
  });

  test("a recarga que falha não trava a fila", async () => {
    let n = 0;
    const q = new ReloadQueue(() => (++n === 1 ? Promise.reject(new Error("x")) : Promise.resolve(n)));
    await q.request().catch(() => {});
    expect(await q.request()).toBe(2);
    expect(await q.request()).toBe(3);
  });
});
