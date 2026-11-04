// O processo do headless (T1739): `bun src/headless/main.ts --data DIR [--no-helper]`. Quem sobe é a CLI
// (`bun run cli start`), em segundo plano; ver server.ts.

import { startHeadless } from "./server.ts";

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const data = flag("--data");
if (!data) {
  console.error("usage: bun src/headless/main.ts --data DIR [--no-helper] [--helper PATH]");
  process.exit(2);
}
const running = await startHeadless({
  data,
  helper: !args.includes("--no-helper"),
  helperPath: flag("--helper"),
  onStopped: () => process.exit(0),
});
for (const sig of ["SIGINT", "SIGTERM"] as const) process.on(sig, () => void running.stop());
