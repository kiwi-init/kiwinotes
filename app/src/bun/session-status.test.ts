import { expect, test } from "bun:test";
import { statusLabel } from "./session-status.ts";
test("supervisor terminal failure takes precedence over startup and missing permissions", () => {
  expect(
    statusLabel({
      connected: false,
      stt: "starting",
      hotkeyActive: false,
      missing: ["microphone"],
      supervision: { state: "failed", crashes: 5, reason: "exit" },
    }),
  ).toBe("O ditado está com problema");
});
