import { describe, expect, test } from "bun:test";

import { CATALOGS, LOCALES, translate } from "../shared/i18n/index.ts";
import { MainLocale } from "./locale.ts";
import { appMenu, trayMenu } from "./menus.ts";
import { permissionName } from "./permissions.ts";
import type { SessionStatus } from "./session.ts";
import { statusLabel } from "./session-status.ts";
import { updateMenuLabel } from "./updates.ts";
import { micFellBackNotice, micShortName, pillText } from "./dictation.ts";
import { noticeBody, noticeTitle } from "../agent/notice.ts";

// O main em inglês (spec #28171, T28192): o menu do app, a bandeja, o status, a pílula e a notificação.

const ready = { connected: true, hotkeyActive: true, stt: "ready", missing: [] } as unknown as SessionStatus;
type Item = { label?: string; submenu?: readonly object[] };
const labels = (items: readonly object[]): string[] =>
  (items as Item[]).flatMap((i) => [...(i.label ? [i.label] : []), ...labels(i.submenu ?? [])]);

describe("o menu do app e a bandeja", () => {
  test("em inglês, nada em português", () => {
    const app = labels(appMenu("en"));
    expect(app).toEqual(["Kiwi Notes", "Quit Kiwi Notes", "Edit", "Window"]);
    const missing = { ...ready, missing: ["accessibility"] } as SessionStatus;
    const tray = labels(trayMenu(missing, { label: updateMenuLabel({ kind: "ready", version: "9.9.9", hash: "x" }, "1.0.0", "en"), ready: true }, "en"));
    expect(tray).toEqual([
      "Open Kiwi Notes",
      "Ready to dictate",
      "Allow access… (Accessibility)",
      "Notes…",
      "Open notes folder…",
      "Dictation…",
      "Settings…",
      "About Kiwi Notes…",
      "Update and restart (v9.9.9)",
      "Quit Kiwi Notes",
    ]);
  });

  test("em português, como era antes", () => {
    expect(labels(appMenu("pt"))).toEqual(["Kiwi Notes", "Sair do Kiwi Notes", "Editar", "Janela"]);
    const tray = labels(trayMenu(ready, { label: null, ready: false }, "pt"));
    expect(tray[0]).toBe("Abrir o Kiwi Notes");
    expect(tray.at(-1)).toBe("Sair do Kiwi Notes");
    expect(tray).not.toContain("Atualizar e reiniciar");
  });

  test("as mesmas ações nas duas línguas", () => {
    const actions = (l: "pt" | "en") => trayMenu(ready, { label: "x", ready: true }, l).map((i) => ("action" in i ? i.action : i.type));
    expect(actions("en")).toEqual(actions("pt"));
  });

  test("o status em inglês", () => {
    expect(statusLabel({ ...ready, connected: false } as SessionStatus, "en")).toBe("Starting…");
    expect(statusLabel({ ...ready, hotkeyActive: false, missing: ["inputMonitoring"] } as SessionStatus, "en")).toBe("Shortcut off: needs Input Monitoring");
    expect(statusLabel({ ...ready, hotkeyPriority: false } as SessionStatus, "en")).toBe("Ready to dictate · shortcuts without priority: needs Accessibility");
    expect(statusLabel({ ...ready, hotkeyActive: false, missing: [] } as unknown as SessionStatus, "pt")).toBe("Atalho desligado: falta permissão");
    expect(permissionName("systemAudio", "en")).toBe("System Audio");
    expect(updateMenuLabel({ kind: "applying" }, "1.0.0", "en")).toBe("Updating…");
  });
});

describe("a pílula do ditado", () => {
  test("em inglês, com o nome do mic também na língua", () => {
    const mac = micShortName({ name: "Microfone", transport: "builtin", systemDefault: false }, "en");
    expect(pillText("en", micFellBackNotice(mac))).toBe("Chosen mic missing: used the Mac's");
    expect(pillText("en", "pill.nothingToPaste")).toBe("No dictation to paste yet");
  });

  test("toda mensagem que cabe nas 38 letras em português cabe em inglês", () => {
    const keys = Object.keys(CATALOGS.pt).filter((k) => k.startsWith("pill.")) as (keyof typeof CATALOGS.pt)[];
    expect(keys.length).toBeGreaterThan(10);
    for (const k of keys) {
      if (translate("pt", k).length <= 38) expect({ k, n: translate("en", k).length <= 38 }).toEqual({ k, n: true });
    }
  });
});

describe("a notificação do agente", () => {
  test("em inglês", () => {
    expect(noticeTitle("en")).toBe("The agent is waiting for your answer");
    expect(noticeBody({ id: "c", items: [{ path: "Projeto X/Ideias.md" }] }, "en")).toBe("A question in Projeto X/Ideias. Click to answer.");
    expect(noticeBody({ id: "c", items: [{ path: "" }] }, "en")).toBe("A question about your request. Click to answer.");
  });
});

describe("a língua do main", () => {
  test("começa em português, troca e avisa uma vez por troca", () => {
    const l = new MainLocale();
    const seen: string[] = [];
    const off = l.onChange((x) => seen.push(x));
    expect(l.get()).toBe("pt");
    expect(l.t("menu.quit")).toBe("Sair do Kiwi Notes");
    l.set("en");
    l.set("en");
    expect(l.t("menu.quit")).toBe("Quit Kiwi Notes");
    off();
    l.set("pt");
    expect(seen).toEqual(["en"]);
  });

  test("toda língua tem os textos do main", () => {
    for (const locale of LOCALES) {
      for (const k of Object.keys(CATALOGS.pt).filter((k) => /^(menu|tray|status|permission|dialog|notice|pill)\./.test(k))) {
        expect(CATALOGS[locale][k as keyof typeof CATALOGS.pt]).toBeTruthy();
      }
    }
  });
});
