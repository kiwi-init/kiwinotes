// L18: o tom pelo site no navegador. Casos do classificador do OpenWhispr (MIT) que valem no Mac.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

import { BROWSER_BUNDLE_IDS, siteTone } from "./site-tone.ts";
import { toneFor } from "./tone.ts";

const chrome = "com.google.Chrome";

describe("siteTone", () => {
  test("pelo host: Gmail é e-mail (formal); Slack e WhatsApp, casual", () => {
    expect(siteTone({ bundleId: chrome, urlHost: "mail.google.com" })).toBe("formal");
    expect(siteTone({ bundleId: "com.apple.Safari", urlHost: "app.slack.com" })).toBe("casual");
    expect(siteTone({ bundleId: "company.thebrowser.Browser", urlHost: "web.whatsapp.com" })).toBe("casual");
    expect(siteTone({ bundleId: chrome, urlHost: "www.linkedin.com" })).toBe("casual");
  });

  test("sem host, pelo nome do site no fim do título", () => {
    expect(siteTone({ bundleId: chrome, title: "Inbox (3) - ana@gmail.com - Gmail" })).toBe("formal");
    expect(siteTone({ bundleId: chrome, title: "Caixa de entrada - ana@empresa.com - Outlook - Google Chrome" })).toBe("formal");
    expect(siteTone({ bundleId: "org.mozilla.firefox", title: "(2) WhatsApp — Mozilla Firefox" })).toBe("casual");
    expect(siteTone({ bundleId: "com.microsoft.edgemac", title: "Chat | Microsoft Teams" })).toBe("casual");
  });

  test("site que só é citado no título não conta", () => {
    expect(siteTone({ bundleId: chrome, title: "Como configurar o Gmail no celular - Blog" })).toBeUndefined();
    expect(siteTone({ bundleId: chrome, title: "gmail - Brave Search" })).toBeUndefined();
  });

  test("host que não é do site recusa o nome no título: uma página do Notion chamada Hey fica de fora", () => {
    expect(siteTone({ bundleId: chrome, title: "Hey", urlHost: "www.notion.so" })).toBeUndefined();
    expect(siteTone({ bundleId: chrome, title: "iCloud Mail", urlHost: "www.icloud.com" })).toBe("formal");
  });

  test("fora do navegador, nada: o tom é o do app", () => {
    expect(siteTone({ bundleId: "com.apple.mail", title: "Gmail", urlHost: "mail.google.com" })).toBeUndefined();
    expect(siteTone({ bundleId: chrome })).toBeUndefined();
    expect(siteTone(undefined)).toBeUndefined();
  });
});

describe("toneFor com o site", () => {
  test("o site decide no navegador; sem site listado, fica no default como antes", () => {
    expect(toneFor(chrome, { urlHost: "mail.google.com" })).toBe("formal");
    expect(toneFor(chrome, { title: "Wikipedia" })).toBe("default");
    expect(toneFor(chrome)).toBe("default");
  });

  test("o app continua decidindo fora do navegador", () => {
    expect(toneFor("com.googlecode.iterm2", { title: "Gmail" })).toBe("literal");
    expect(toneFor("com.tinyspeck.slackmacgap")).toBe("casual");
  });
});

test("a lista de navegadores é a mesma do helper (BrowserSite.swift)", () => {
  const swift = readFileSync(path.resolve(import.meta.dir, "../../../native/Sources/KiwiHelperCore/BrowserSite.swift"), "utf8");
  const list = swift.slice(swift.indexOf("bundleIds: Set<String> = ["), swift.indexOf("]", swift.indexOf("bundleIds: Set<String> = [")));
  const ids = [...list.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  expect(ids.sort()).toEqual([...BROWSER_BUNDLE_IDS].sort());
});
