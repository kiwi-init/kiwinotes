import { describe, expect, test } from "bun:test";

import type { HubSection } from "../shared/ui-contract.ts";
import { Hub } from "./hub.ts";

function fake(o: { intro?: boolean; failShow?: boolean } = {}) {
  const log: string[] = [];
  let open = false;
  const hub = new Hub({
    show: async () => {
      log.push("show");
      if (!o.failShow) open = true;
    },
    isOpen: () => open,
    navigate: (s: HubSection, p?: string) => log.push(p ? `navigate ${s} ${p}` : `navigate ${s}`),
    setDock: (v) => log.push(`dock ${v}`),
    intro: o.intro ? async () => void log.push("intro") : undefined,
  });
  const close = () => {
    open = false;
    hub.closed();
  };
  return { hub, log, close };
}

describe("Hub", () => {
  test("abrir do zero: Dock, intro e o hub; abrir de novo não toca a intro", async () => {
    const { hub, log, close } = fake({ intro: true });
    await hub.open();
    expect(log).toEqual(["dock true", "intro", "show"]);
    close();
    expect(log.at(-1)).toBe("dock false");
    log.length = 0;
    await hub.open();
    expect(log).toEqual(["dock true", "show"]);
  });

  test("duas aberturas juntas tocam a intro uma vez", async () => {
    const { hub, log } = fake({ intro: true });
    await Promise.all([hub.open(), hub.open()]);
    expect(log.filter((l) => l === "intro")).toHaveLength(1);
  });

  test("abrir de novo durante a intro não mostra o hub antes do fim dela (T2308)", async () => {
    const log: string[] = [];
    let open = false;
    let endIntro = () => {};
    const hub = new Hub({
      show: async () => {
        log.push("show");
        open = true;
      },
      isOpen: () => open,
      navigate: (s: HubSection) => log.push(`navigate ${s}`),
      setDock: (v) => log.push(`dock ${v}`),
      intro: () => new Promise<void>((r) => (endIntro = r)),
    });
    const first = hub.open();
    await Promise.resolve();
    // O ícone do Dock clicado (ou o menu da barra) com a intro tocando, pedindo uma seção.
    const second = hub.open("settings");
    await Promise.resolve();
    expect(log).toEqual(["dock true"]);
    endIntro();
    await Promise.all([first, second]);
    expect(log).toEqual(["dock true", "show"]);
    expect(hub.takeSection()).toBe("settings");
  });

  test("o fim da intro que já mostrou o hub: ele não abre de novo, e a seção pedida no meio vai pelo evento (T16769)", async () => {
    const log: string[] = [];
    let endIntro = (_shown: boolean) => {};
    let open = false;
    const hub = new Hub({
      show: async () => void log.push("show"),
      // O hub escondido conta como aberto desde que a intro começa.
      isOpen: () => open,
      navigate: (s: HubSection) => log.push(`navigate ${s}`),
      setDock: (v) => log.push(`dock ${v}`),
      intro: () => ((open = true), new Promise<boolean>((r) => (endIntro = r))),
    });
    const first = hub.open();
    await Promise.resolve();
    const second = hub.open("settings");
    await Promise.resolve();
    endIntro(true);
    await Promise.all([first, second]);
    // Sem o "show": abrir de novo tocaria a entrada do hub (o `__kiwiEnter`) por cima da troca.
    expect(log).toEqual(["dock true", "navigate settings"]);
    expect(hub.takeSection()).toBeNull();
  });

  test("a seção pedida com o hub fechado vai pelo hub.section, uma vez", async () => {
    const { hub } = fake();
    await hub.open("settings");
    expect(hub.takeSection()).toBe("settings");
    expect(hub.takeSection()).toBeNull();
  });

  test("com o hub aberto, a seção vai pelo evento e ele vem para a frente", async () => {
    const { hub, log } = fake();
    await hub.open();
    log.length = 0;
    await hub.open("dictation");
    expect(log).toEqual(["navigate dictation", "show"]);
    expect(hub.takeSection()).toBeNull();
  });

  test("o arquivo do balão do gato (spec #17683): com o hub aberto vai pelo evento, junto da seção", async () => {
    const { hub, log } = fake();
    await hub.open();
    log.length = 0;
    await hub.open("notes", "Projeto X/plano.pdf");
    expect(log).toEqual(["navigate notes Projeto X/plano.pdf", "show"]);
    expect(hub.takeRequest()).toBeNull();
  });

  test("o arquivo pedido com o hub fechado vai pelo hub.section, uma vez, e um pedido sem arquivo não herda o anterior", async () => {
    const { hub, close } = fake();
    await hub.open("notes", "Feira.md");
    expect(hub.takeRequest()).toEqual({ section: "notes", path: "Feira.md" });
    expect(hub.takeRequest()).toBeNull();
    close();
    await hub.open("notes");
    expect(hub.takeRequest()).toEqual({ section: "notes" });
  });

  test("o hub que não abriu não deixa o app no Dock", async () => {
    const { hub, log } = fake({ failShow: true });
    await hub.open("notes");
    expect(log).toEqual(["dock true", "show", "dock false"]);
    expect(hub.takeSection()).toBeNull();
  });

  test("fechar sem ter aberto não mexe no Dock", () => {
    const { hub, log } = fake();
    hub.closed();
    expect(log).toEqual([]);
  });
});
