// T11191: the tuning desk in headless WebKit. Opens the file directly, checks the loop, the controls, copy, reset and
// persistence, and prints the page. Usage: bun ajuste-check.ts <ajuste.html> <out.png>
import assert from "node:assert/strict";
const app = new URL("../../../../../app", import.meta.url).pathname;
const { webkit } = await import(`${app}/node_modules/playwright-core`);
const [file, shot] = [process.argv[2]!, process.argv[3]!];
const b = await webkit.launch({ headless: true });
const checks: string[] = [];
try {
  const ctx = await b.newContext({ viewport: { width: 1340, height: 1180 }, deviceScaleFactor: 1 });
  const p = await ctx.newPage();
  const errors: string[] = []; p.on("pageerror", e => errors.push(String(e))); p.on("console", m => { if (m.type() === "error") errors.push(m.text()); });
  const requests: string[] = []; p.on("request", r => { if (!r.url().startsWith("file:") && !r.url().startsWith("data:")) requests.push(r.url()); });
  await p.goto(`file://${file}`);
  await p.waitForFunction(() => (window as any).ready === true, null, { timeout: 20000 });
  assert.deepEqual(errors, []); checks.push("opens from the file, no errors");
  // the loop runs: two frames differ
  const px = () => p.evaluate(() => (document.getElementById("cd") as HTMLCanvasElement).toDataURL().length + ":" + (document.getElementById("cd") as HTMLCanvasElement).toDataURL().slice(-200));
  const a = await px(); await p.waitForTimeout(700); const c = await px();
  assert.notEqual(a, c); checks.push("the rest pose runs in a loop");
  // a slider changes the cat at once and shows its value
  await p.evaluate(() => (window as any).renderAt(1.0));
  const before = await px();
  await p.evaluate(() => { const i = document.getElementById("c-auraAmount") as HTMLInputElement; i.value = "0.2"; i.dispatchEvent(new Event("input")); (window as any).renderAt(1.0); });
  const after = await px();
  assert.notEqual(before, after);
  assert.equal(await p.locator("#c-auraAmount + output").textContent(), "20%"); checks.push("a slider changes the cat and shows the value");
  for (const id of ["c-auraRadius", "c-edgeSoftness", "c-auraFloor", "c-mistColor", "c-arcIntensity", "c-arcWidth", "c-arcFrom", "c-arcTo", "c-arcCyan", "c-breathOn", "c-breathType", "c-breathPeriod", "c-breathAmount", "c-floatOn", "c-floatHeight", "c-floatPeriod", "c-wispAmount", "c-wispSpeed"])
    assert.equal(await p.locator(`#${id}`).count(), 1, id);
  checks.push("aura, arc, breath, float and wisp controls are all there");
  // copy: the block with every value
  await p.click("#copy");
  const text = await p.locator("#out").inputValue();
  assert.match(text, /"auraAmount": 0\.2/); assert.match(text, /"floatPeriod": 6\.5/); assert.match(text, /"breathType": "respirar"/);
  checks.push("Copiar os valores makes the block");
  // persists between openings
  await p.reload(); await p.waitForFunction(() => (window as any).ready === true);
  assert.equal(await p.locator("#c-auraAmount").inputValue(), "0.2"); checks.push("values persist between openings");
  // reset
  await p.click("#reset");
  assert.equal(await p.locator("#c-auraAmount").inputValue(), "1"); checks.push("Voltar ao padrão undoes everything");
  await p.reload(); await p.waitForFunction(() => (window as any).ready === true);
  assert.equal(await p.locator("#c-auraAmount").inputValue(), "1");
  assert.deepEqual(requests, []); checks.push("nothing goes to the network");
  // pauses when hidden
  const paused = await p.evaluate(async () => {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
    document.dispatchEvent(new Event("visibilitychange"));
    const c = document.getElementById("cd") as HTMLCanvasElement, s1 = c.toDataURL();
    await new Promise(r => setTimeout(r, 600));
    return s1 === c.toDataURL();
  });
  assert.ok(paused); checks.push("pauses when the tab is hidden");
  await p.evaluate(() => { Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" }); });
  await p.evaluate(() => (window as any).renderAt(1.6));
  await p.screenshot({ path: shot, fullPage: true });
  console.log(JSON.stringify({ ok: true, checks }));
} finally { await b.close(); }
