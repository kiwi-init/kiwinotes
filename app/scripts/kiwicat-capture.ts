// Deterministic visual capture, never a performance benchmark. No screen/mic.
import { webkit } from "playwright-core";
import { mkdirSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { resolve, join } from "node:path";
import { serveFogDemo } from "./kiwicat-demo";
const variant = "B1";
if (process.env.KIWI_FOG_VARIANT && process.env.KIWI_FOG_VARIANT !== variant)
  throw new Error("Only the selected B1 texture is implemented");
const out = resolve(process.argv[2] ?? "/tmp/kiwi-T8487-videos");
mkdirSync(out, { recursive: true });
const server = await serveFogDemo(),
  browser = await webkit.launch({ headless: true }).catch((error) => {
    server.close();
    throw error;
  });
const selected = process.argv[3];
const quietFPS = Number(process.env.KIWI_FOG_IDLE_FPS ?? 2);
if (!Number.isFinite(quietFPS) || quietFPS < 1 || quietFPS > 30)
  throw new Error("KIWI_FOG_IDLE_FPS must be between 1 and 30");
const scenes = [
  ...["repouso", "ouvindo", "thinking"].flatMap((state) =>
    ["padrao", "claude", "codex"].map((colour) => ({
      name: state + "-" + colour,
      state,
      colour,
      seconds: 8,
      idleFPS: quietFPS,
    })),
  ),
  {
    name: "repouso-60s",
    state: "repouso",
    colour: "padrao",
    seconds: 60,
    idleFPS: quietFPS,
  },
  {
    name: "repouso-12fps",
    state: "repouso",
    colour: "padrao",
    seconds: 8,
    idleFPS: 12,
  },
].filter((scene) =>
  selected ? scene.name === selected : scene.name !== "repouso-12fps",
);
const report: Record<string, any> = {
  task: "T8487",
  scope: "controlled-clock visual capture; not a benchmark",
  browser: browser.version(),
  size: [640, 800],
  fps: 30,
  simulationHz: 60,
  seed: 17,
  idleFPS: quietFPS,
  variant: variant,
  densityScale: Number(process.env.KIWI_FOG_SCALE ?? 1),
  scenes: [],
};
try {
  for (const scene of scenes) {
    const context = await browser.newContext({
      viewport: { width: 640, height: 800 },
      deviceScaleFactor: 1,
      reducedMotion: "no-preference",
    });
    await context.route("**/*", (route) =>
      new URL(route.request().url()).origin === server.url
        ? route.continue()
        : route.abort(),
    );
    const page = await context.newPage(),
      errors: string[] = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await page.goto(
      server.url +
        "/?mode=capture&variant=" +
        variant +
        "&densityScale=" +
        (process.env.KIWI_FOG_SCALE ?? 1) +
        "&state=" +
        scene.state +
        "&color=" +
        scene.colour +
        "&seed=17&caption=1&idleFPS=" +
        scene.idleFPS,
    );
    await page.waitForFunction(() => (window as any).kiwiFogReady, null, {
      timeout: 30000,
    });
    const backend = await page.evaluate(
      () => (window as any).kiwiFog.stats.backend,
    );
    if (backend !== "webgpu")
      throw new Error("Expected proven WebGPU backend, got " + backend);
    const filename = scene.name + ".mp4";
    const encoder = spawn(
      "ffmpeg",
      [
        "-v",
        "error",
        "-y",
        "-f",
        "image2pipe",
        "-framerate",
        "30",
        "-vcodec",
        "png",
        "-i",
        "pipe:0",
        "-an",
        "-c:v",
        "libx264",
        "-preset",
        "medium",
        "-crf",
        "18",
        "-threads",
        "2",
        "-pix_fmt",
        "yuv420p",
        "-movflags",
        "+faststart",
        join(out, filename),
      ],
      { stdio: ["pipe", "ignore", "pipe"] },
    );
    encoder.stdin!.on("error", () => {});
    let stderr = "";
    encoder.stderr!.on("data", (chunk) => (stderr += String(chunk)));
    const done = new Promise<void>((resolve, reject) => {
      encoder.on("error", reject);
      encoder.on("close", (code) =>
        code === 0 ? resolve() : reject(new Error(stderr)),
      );
    });
    void done.catch(() => {});
    const hashes: string[] = [];
    try {
      for (let frame = 0; frame < scene.seconds * 30; frame++) {
        // Advance the simulation at 60Hz even though the export is 30Hz.
        // Idle retains its actual 3Hz cadence; repeated frames stay repeated.
        for (const tick of frame === 0 ? [0] : [frame * 2 - 1, frame * 2]) {
          const time = tick / 60;
          if (scene.state === "ouvindo")
            await page.evaluate(
              (t) =>
                (window as any).kiwiFog.update({
                  voz: 0.9 * Math.pow(Math.max(0, Math.sin(t * 2.4)), 1.8),
                }),
              time,
            );
          await page.evaluate((t) => (window as any).kiwiFog.capture(t), time);
        }
        const png = await page.screenshot();
        hashes.push(new Bun.CryptoHasher("sha256").update(png).digest("hex"));
        if (frame === 90 && process.env.KIWI_FOG_STILLS === "1")
          writeFileSync(join(out, scene.name + ".png"), png);
        if (!encoder.stdin!.write(png)) await once(encoder.stdin!, "drain");
        if (frame % 150 === 0)
          console.log(scene.name, frame, "/", scene.seconds * 30);
      }
      encoder.stdin!.end();
      await done;
    } catch (error) {
      encoder.kill();
      await done.catch(() => {});
      throw error;
    }
    if (errors.length) throw new Error(errors.join("\n"));
    report.scenes.push({
      ...scene,
      file: filename,
      backend,
      frames: hashes.length,
      uniqueFrameHashes: new Set(hashes).size,
      firstHash: hashes[0],
      lastHash: hashes.at(-1),
      stats: await page.evaluate(() => (window as any).kiwiFog.stats),
    });
    await context.close();
    writeFileSync(
      join(out, "report.json"),
      JSON.stringify(report, null, 2) + "\n",
    );
  }
} finally {
  await browser.close();
  server.close();
}
