// O balão do gato em inglês (T30636, spec #28171, caixa 6): o campo de falar, uma resposta curta, uma longa com o
// "See more" aberto, o pedido ocupado e os avisos do agente (o limite, o limite com hora, sem rede, sem login), com o app
// em English. No hub de verdade, com o AppEngine headless e o agente de mentira (`KIWI_FAKE_AGENT`), num WebKit headless:
// nada aparece na tela de ninguém. As respostas do agente são inventadas e em inglês (`/conta …`), então qualquer
// português no balão é do app. O balão do overlay em inglês está no kiwicat-bubble-check (seção 8).
//
//   bun scripts/bubble-english-check.ts [pasta]
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Page } from "playwright-core";
import { startEnglish } from "./english-check-lib";
import { fakeRegistry } from "../src/agent/fake/registry";

const registry = fakeRegistry([
  { name: "@agentclientprotocol/claude-agent-acp", version: "0.106.0", files: { "dist/index.js": "" } },
  { name: "zod", version: "4.6.7", files: { "index.js": "" } },
]);
const packages = join(mkdtempSync(join(tmpdir(), "kiwi-bubble-en-")), "packages.json");
writeFileSync(packages, JSON.stringify(registry.pinned));

// O português que já tem dono: some daqui no PR que o traduz. Os erros do agente saem do catálogo desde o T30986, e
// um erro em português no balão volta a barrar.
const KNOWN: [string, string][] = [];
const s = await startEnglish({
  name: "T30636-bubble-english",
  known: KNOWN,
  env: { KIWI_ADAPTER_REGISTRY: registry.url, KIWI_ADAPTER_PACKAGES: packages },
});

const SHORT = "Your garden plan is in Projects. Plant tomatoes in May.";
const LONG = [
  "Here is a summary of the week.",
  "",
  "## Garden",
  "- Plant tomatoes in May.",
  "- Water twice a week.",
  "",
  "## Reading",
  "- A book about rivers.",
  "- A book about bread.",
  "",
  "The next step is to buy a new hose and to move the shelf for the plants closer to the window, so they get more sun in the morning.",
].join("\n");

let page: Page | null = null;
try {
  assert.equal((await s.invoke("app.locale")).locale, "en", "o app devia estar em English");
  const { page: p } = await s.open("hub", { section: "notes" }, { width: 1000, height: 740 });
  page = p;
  await s.invoke("agent.enable", { consent: true });
  await s.invoke("agent.download");
  // O onboarding abre na primeira vez que o agente liga e cobre o hub; aqui ele já foi feito. O gato do overlay fica
  // desligado: o headless nunca está na frente, e o gato do canto iria embora.
  await s.invoke("agent.configure", { onboarding: { state: "done" } });
  await s.invoke("settings.set", { kiwicat: { overlay: false } });
  for (let n = 0; (await s.invoke("agent.status")).adapter.phase !== "ready"; n++) {
    assert.ok(n < 200, "o agente falso não ficou pronto");
    await Bun.sleep(100);
  }
  await p.waitForSelector('.kn-kiwicat[data-ready="true"]', { timeout: 20000 });
  const body = (await p.locator(".kn-kiwicat-hit").boundingBox())!;
  const clickCat = () => p.mouse.click(body.x + body.width / 2, body.y + body.height / 2);
  const bubbleText = () => p.locator(".kn-bubble-text").innerText().catch(() => "");
  /** Pede ao agente e espera o balão dizer algo novo e parar de mudar. */
  const ask = async (text: string) => {
    const before = await bubbleText();
    await s.invoke("agent.ask", { text });
    for (let n = 0, last = "", same = 0; same < 6; n++) {
      assert.ok(n < 200, `o balão não respondeu a ${text}`);
      await Bun.sleep(100);
      const now = await bubbleText();
      same = now && now !== before && now === last ? same + 1 : 0;
      last = now;
    }
    // O pedido acabou: espera o gato sair do "pensando"/"agindo" antes do próximo.
    await p.waitForFunction(() => !["thinking", "agindo"].includes(document.querySelector(".kn-kiwicat")?.getAttribute("data-state") ?? ""), undefined, { timeout: 15000 });
  };

  // 1. O campo de falar, aberto pelo clique no gato.
  await clickCat();
  await p.waitForSelector(".kn-cat-ask", { timeout: 10000 });
  await s.check(p, "1-campo");
  await p.keyboard.press("Escape");
  await p.waitForSelector(".kn-cat-ask", { state: "detached", timeout: 10000 });

  // 2. Uma resposta curta.
  await ask(`/conta ${SHORT}`);
  await s.check(p, "2-resposta-curta");

  // 3. Uma resposta longa: fechada com o "See more", e aberta.
  await ask(`/conta ${LONG}`);
  await p.waitForSelector(".kn-bubble-more", { timeout: 10000 });
  await s.check(p, "3-resposta-longa");
  await p.locator(".kn-bubble-more").click();
  await p.waitForSelector(".kn-bubble-big", { timeout: 10000 });
  await s.check(p, "4-ver-mais");
  await p.keyboard.press("Escape");

  // 4. Ocupado: o campo diz que espera e oferece parar.
  await s.invoke("agent.ask", { text: "/lento" });
  await p.waitForSelector('.kn-kiwicat[data-state="agindo"]', { timeout: 15000 });
  await clickCat();
  await p.waitForSelector(".kn-cat-ask", { timeout: 10000 });
  // A fala do agente falso no `/lento` ("pedaço N") é dele, não do app.
  await s.check(p, "5-ocupado", { skip: [/pedaço \d+/g] });
  await p.keyboard.press("Escape");
  await p.waitForFunction(() => document.querySelector(".kn-kiwicat")?.getAttribute("data-state") !== "agindo", undefined, { timeout: 20000 });

  // 5. Os avisos do agente: as frases são do app.
  for (const [i, cmd] of ["/limite", "/limite-com-hora", "/sem-rede", "/sem-login"].entries()) {
    await ask(cmd);
    await s.check(p, `${6 + i}-aviso-${cmd.slice(1)}`);
  }
} catch (e) {
  await s.fail(e, page);
}
await s.finish();
