import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

import type { Command } from "../shared/ipc.ts";
import { followLocale, type HelperSend, sendLocale, syncHelper } from "./helper-locale.ts";
import { MainLocale } from "./locale.ts";

// O helper segue a língua do app (spec #28171, T28192), com um sidecar falso: nada sobe.

/** Um sidecar falso que guarda o que recebeu e responde como o `reply` mandar. */
function fakeHelper(reply: (c: Command) => Promise<{ ok: boolean; error?: string }> = async () => ({ ok: true })) {
  const sent: Command[] = [];
  const send: HelperSend = (c) => {
    sent.push(c);
    return reply(c);
  };
  return { sent, send, locales: () => sent.filter((c) => c.type === "app.locale").map((c) => (c as { locale: string }).locale) };
}

describe("o app.locale ao helper", () => {
  test("ao conectar, o syncAll manda a língua junto com o dicionário e as Configurações", async () => {
    const helper = fakeHelper();
    const main = new MainLocale();
    main.set("en");
    const done: string[] = [];
    await syncHelper({
      dictionary: async () => void done.push("dictionary"),
      settings: async () => void done.push("settings"),
      locale: () => sendLocale(helper.send, main.get()),
    });
    expect(helper.locales()).toEqual(["en"]);
    expect(done.sort()).toEqual(["dictionary", "settings"]);
  });

  test("a cada troca do main, o helper recebe a nova; depois do desligar, mais nada", async () => {
    const helper = fakeHelper();
    const main = new MainLocale();
    const off = followLocale(main, helper.send);
    main.set("en");
    main.set("en");
    main.set("pt");
    off();
    main.set("en");
    await Bun.sleep(0);
    expect(helper.locales()).toEqual(["en", "pt"]);
  });

  test("um helper antigo (unknown_type) e um que caiu (send rejeita) não derrubam o resto do syncAll", async () => {
    const warn = console.warn;
    const warned: string[] = [];
    console.warn = (m: string) => void warned.push(m);
    try {
      for (const reply of [async () => ({ ok: false, error: "unknown_type" }), () => Promise.reject(new Error("helper gone"))]) {
        const helper = fakeHelper(reply);
        const done: string[] = [];
        await syncHelper({
          dictionary: async () => void done.push("dictionary"),
          settings: async () => void done.push("settings"),
          locale: () => sendLocale(helper.send, "en"),
        });
        expect(helper.locales()).toEqual(["en"]);
        expect(done.sort()).toEqual(["dictionary", "settings"]);
      }
    } finally {
      console.warn = warn;
    }
    expect(warned).toEqual(["[session] app.locale: unknown_type"]);
  });

  test("o Session usa estas funções: o syncAll passa a língua, e o start segue o mainLocale", () => {
    // O Session é pesado de montar (sobe o helper): a ligação dele com as funções acima se confere no código.
    const src = readFileSync(path.join(import.meta.dirname, "session.ts"), "utf8");
    expect(src).toContain("locale: () => this.localeChanged(mainLocale.get())");
    expect(src).toMatch(/this\.offLocale = followLocale\(mainLocale, /);
    expect(src).toContain("return sendLocale(");
  });
});
