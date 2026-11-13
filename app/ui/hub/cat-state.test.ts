import { expect, test } from "bun:test";
import { CatActivity } from "./cat-state";
test("request sequence, interruption and stale events", () => {
  const a = new CatActivity(false);
  expect(a.event({ id: "1", type: "started" })).toBe("acordou");
  expect(a.event({ id: "1", type: "status", status: "running", tool: "Read" })).toBe("agindo");
  expect(a.event({ id: "1", type: "status", status: "thinking" })).toBe("thinking");
  expect(a.event({ id: "1", type: "text", text: "hello" })).toBe("thinking");
  expect(a.event({ id: "1", type: "done", text: "hello", stopReason: "end_turn" })).toBe("pronto");
  expect(a.event({ id: "2", type: "started" })).toBe("acordou");
  expect(a.event({ id: "1", type: "error", code: "x", message: "late" })).toBe("acordou");
  expect(a.event({ id: "2", type: "done", text: "", stopReason: "cancelled" })).toBe("repouso");
  expect(a.event({ id: "3", type: "started" })).toBe("acordou");
  expect(a.event({ id: "3", type: "error", code: "x", message: "failed" })).toBe("erro");
  expect(a.event({ id: "3", type: "status", status: "thinking" })).toBe("erro");
});
test("mount while busy and non-success endings", () => {
  const a = new CatActivity(true); expect(a.state).toBe("thinking");
  expect(a.event({ id: "busy", type: "status", status: "running", tool: "Read" })).toBe("agindo");
  expect(a.event({ id: "busy", type: "done", text: "", stopReason: "max_tokens" })).toBe("repouso");
});
