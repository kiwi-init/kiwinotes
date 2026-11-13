import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { webkit, type Browser } from "playwright-core";
import { tempDir } from "../test/tmp.ts";

const browserTests = existsSync(webkit.executablePath()) ? describe : describe.skip;

browserTests("Kiwi-cat native animation cleanup", () => {
  let browser: Browser, bundle: string, directory: string;
  beforeAll(async () => {
    directory = tempDir("kiwi-vector-lifecycle-");
    const entry = join(directory, "entry.ts");
    writeFileSync(entry, `
      import { createVectorLayer } from ${JSON.stringify(resolve(import.meta.dir, "../ui/kiwicat/vectors.ts"))};
      import { GestureMachine, seededRandom } from ${JSON.stringify(resolve(import.meta.dir, "../ui/kiwicat/gestures.ts"))};
      window.runCleanup = async (hidden, operation) => {
        const root = document.createElement('div');
        root.style.cssText = 'position:relative;width:640px;height:800px';
        document.body.append(root);
        const layer = createVectorLayer(root, 640, 800);
        const machine = new GestureMachine({}, { clock: () => 0, random: seededRandom(3) });
        const open = machine.sample(0);
        layer.animate([open, { ...open, eyes: { ...open.eyes, blink: 0 } }], 10);
        const animations = root.getAnimations({ subtree: true });
        await Promise.all(animations.map(animation => animation.ready));
        if (hidden === 'detached') root.remove();
        else root.style.display = 'none';
        let commitError = null, cleanupError = null;
        try { animations[0].commitStyles(); } catch (error) { commitError = error.name; }
        try { layer[operation](); } catch (error) { cleanupError = error.name; }
        const states = animations.map(animation => animation.playState);
        // Keep failures isolated too: the pre-fix implementation leaks effects.
        animations.forEach(animation => animation.cancel());
        root.remove();
        return { count: animations.length, commitError, cleanupError, states };
      };
    `);
    const result = await Bun.build({ entrypoints: [entry], target: "browser", format: "iife" });
    if (!result.success) throw new Error(result.logs.join("\n"));
    bundle = await result.outputs[0]!.text();
    browser = await webkit.launch({ headless: true });
  }, 30000);

  afterAll(async () => {
    await browser?.close();
    if (directory) rmSync(directory, { recursive: true, force: true });
  });

  for (const hidden of ["display-none", "detached"]) {
    for (const operation of ["stop", "dispose"]) {
      test(`${operation} cancels every effect when ${hidden}`, async () => {
        const page = await browser.newPage();
        try {
          await page.setContent("<!doctype html><body></body>");
          await page.addScriptTag({ content: bundle });
          const result = await page.evaluate(({ hidden, operation }) =>
            (window as any).runCleanup(hidden, operation), { hidden, operation });
          expect(result.count).toBeGreaterThan(1);
          expect(result.commitError).toBe("InvalidStateError");
          expect(result.cleanupError).toBeNull();
          expect(result.states).toEqual(Array(result.count).fill("idle"));
        } finally {
          await page.close();
        }
      });
    }
  }
});
