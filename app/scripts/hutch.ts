// Runs the pinned Hutch (Electrobun's build CLI) against Livewire.
// Downloads it once into ~/.hutch/kiwinotes/<sha256>, checks the archive's
// sha256 against hutch-pin.json, and puts it on PATH for nested `hutch` calls.
//
//   bun scripts/hutch.ts run dev      # = hutch run dev
//   bun scripts/hutch.ts electrobun prepare
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import pin from "../hutch-pin.json" with { type: "json" };

const key = `${process.platform === "darwin" ? "macos" : process.platform}-${process.arch}`;
const platform = (pin.hutch.platforms as Record<string, { url: string; sha256: string }>)[key];
if (!platform) {
  console.error(`hutch: no pinned Hutch for ${key}; Kiwi Notes only builds on macOS arm64`);
  process.exit(1);
}

const appDir = path.resolve(import.meta.dirname, "..");
const home = path.join(process.env.HUTCH_HOME ?? path.join(os.homedir(), ".hutch"), "kiwinotes", platform.sha256);
const bin = path.join(home, "bin");
const hutch = path.join(bin, "hutch");

async function install(): Promise<void> {
  console.log(`hutch: downloading ${pin.hutch.version} for ${key}`);
  const res = await fetch(platform.url);
  if (!res.ok) throw new Error(`hutch: download failed (${res.status}): ${platform.url}`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  const sum = createHash("sha256").update(bytes).digest("hex");
  if (sum !== platform.sha256) throw new Error(`hutch: sha256 ${sum} doesn't match the pin ${platform.sha256}`);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "kiwinotes-hutch-"));
  try {
    fs.writeFileSync(path.join(tmp, "hutch.tar.gz"), bytes);
    const tar = spawnSync("tar", ["-xzf", "hutch.tar.gz"], { cwd: tmp, stdio: "inherit" });
    if (tar.status !== 0) throw new Error("hutch: couldn't unpack the archive");
    const top = path.join(tmp, `hutch-v${pin.hutch.version}-${key}`);
    fs.rmSync(home, { recursive: true, force: true });
    fs.mkdirSync(path.dirname(home), { recursive: true });
    fs.cpSync(top, home, { recursive: true });
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

if (!fs.existsSync(hutch)) await install();

const run = spawnSync(hutch, process.argv.slice(2), {
  stdio: "inherit",
  cwd: appDir,
  env: {
    ...process.env,
    PATH: `${bin}${path.delimiter}${process.env.PATH ?? ""}`,
    ELECTROBUN_HUTCH_BINARY: hutch,
    ELECTROBUN_RELEASES_BASE_URL: pin.releasesBaseUrl,
    HUTCH_DEFAULT_CLI: pin.hutch.version,
    HUTCH_DEFAULT_ELECTROBUN: pin.electrobun,
  },
});
process.exit(run.status ?? 1);
