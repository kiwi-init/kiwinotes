import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { UI_WINDOWS } from "../shared/ui-contract.ts";
import { VIEWS_CSP, windowSecurity } from "./window-security.ts";

/** As regras do Electrobun: em ordem, a última que casa vale; `^` bloqueia, `*` é qualquer coisa. */
function allowed(rulesJson: string, url: string): boolean {
  let ok = true;
  for (const rule of JSON.parse(rulesJson) as string[]) {
    const block = rule.startsWith("^");
    const glob = block ? rule.slice(1) : rule;
    const re = new RegExp(`^${glob.split("*").map((p) => p.replace(/[.+?^${}()|[\]\\/]/g, "\\$&")).join(".*")}$`);
    if (re.test(url)) ok = !block;
  }
  return ok;
}

const directives = (csp: string) => new Map(csp.split(";").map((d) => d.trim().split(/\s+/)).map(([k, ...v]) => [k!, v]));

describe("trava das janelas (T1378)", () => {
  test("stable: só a UI do AppEngine; um link não leva a janela para fora", () => {
    const { navigationRules } = windowSecurity(null);
    expect(allowed(navigationRules, "views://internal/index.html")).toBe(true);
    for (const url of [
      "https://example.com/",
      "http://localhost:5178/settings/index.html",
      "file:///etc/passwd",
      "javascript:alert(1)",
      "appdata://ui/x.html",
      "views://other/index.html",
    ]) expect(allowed(navigationRules, url)).toBe(false);
  });

  test("dev: o Vite também, e só a origem dele", () => {
    const { navigationRules } = windowSecurity("http://localhost:5178");
    expect(allowed(navigationRules, "http://localhost:5178/settings/index.html")).toBe(true);
    expect(allowed(navigationRules, "views://internal/index.html")).toBe(true);
    expect(allowed(navigationRules, "http://localhost:5179/x")).toBe(false);
    expect(allowed(navigationRules, "https://example.com/")).toBe(false);
  });

  test("window.open e target=_blank vão para o navegador padrão", () => {
    expect(windowSecurity(null).newWindow).toBe("external");
    expect(windowSecurity("http://localhost:5178").newWindow).toBe("external");
  });

  test("a CSP vai no stable e no dev, sem script inline nem eval, e sem rede", () => {
    for (const dev of [null, "http://localhost:5178"]) expect(windowSecurity(dev).contentSecurityPolicy).toBe(VIEWS_CSP);
    const d = directives(VIEWS_CSP);
    expect(d.get("script-src")).toEqual(["'self'", "views:"]);
    // Só o socket local da ponte do RPC (#1419): com 'none' o preload lança no `new WebSocket` e a janela não sobe.
    expect(d.get("connect-src")).toEqual(["ws://127.0.0.1:*"]);
    expect(d.get("object-src")).toEqual(["'none'"]);
    expect(d.get("base-uri")).toEqual(["'none'"]);
    expect(VIEWS_CSP).not.toContain("unsafe-eval");
    expect(VIEWS_CSP).not.toMatch(/[\r\n\0]/); // o Electrobun recusa header com quebra de linha
  });

  test("connect-src aceita o socket do preload e recusa rede (#1419)", () => {
    const sources = directives(VIEWS_CSP).get("connect-src")!;
    // A regra de host-source da CSP para o que está aqui: esquema, host e porta, com `*` de porta.
    const allows = (url: string) => {
      const u = new URL(url);
      return sources.some((src) => {
        const m = /^(\w+):\/\/([^:/]+):(\*|\d+)$/.exec(src);
        return !!m && u.protocol === `${m[1]}:` && u.hostname === m[2] && (m[3] === "*" || u.port === m[3]);
      });
    };
    // O que o preload abre: `ws://127.0.0.1:${HOST_SOCKET_PORT}/socket?webviewId=…`.
    // Confere no preload do devkit, quando ele já foi preparado (`bun run prepare:eb`; numa worktree nova ainda não).
    const compiled = path.resolve(import.meta.dirname, "../../.hutch/devkit/api/preload/.generated/compiled.ts");
    if (existsSync(compiled))
      expect(readFileSync(compiled, "utf8")).toContain("new WebSocket(`ws://127.0.0.1:${HOST_SOCKET_PORT}/socket");
    expect(allows("ws://127.0.0.1:50123/socket?webviewId=3")).toBe(true);
    for (const url of ["https://example.com/", "ws://example.com:80/", "ws://localhost:50123/", "wss://127.0.0.1:443/", "http://127.0.0.1:5178/"])
      expect(allows(url)).toBe(false);
  });

  test("o HTML das UIs cabe na CSP: nada de script inline", () => {
    const ui = path.resolve(import.meta.dirname, "../../ui");
    for (const window of UI_WINDOWS) {
      const html = readFileSync(path.join(ui, window, "index.html"), "utf8");
      for (const [, attrs, body] of html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)) {
        expect(attrs).toContain("src=");
        expect(body!.trim()).toBe("");
      }
      expect(html).not.toMatch(/\son[a-z]+=/i);
    }
  });

  test("windows.ts põe a trava em toda janela", () => {
    const src = readFileSync(path.join(import.meta.dirname, "windows.ts"), "utf8");
    expect(src).toContain("...windowSecurity(dev)");
  });
});
