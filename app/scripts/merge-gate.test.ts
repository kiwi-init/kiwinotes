// O portão do merge (spec #21331): aceita o pulado com motivo, barra o vermelho, o que falta e o pulado sem motivo.
import { describe, expect, test } from "bun:test";

import { type Check, judge, skipReason, type Step } from "./merge-gate.ts";

const job = (id: number) => `https://github.com/exemplo/app/actions/runs/1/job/${id}`;
const run = (name: string, conclusion: string, id: number, startedAt = "2026-01-01T10:00:00Z"): Check => ({
  __typename: "CheckRun",
  name,
  status: "COMPLETED",
  conclusion,
  detailsUrl: job(id),
  startedAt,
});
const ran: Step[] = [
  { name: "Set up job", conclusion: "success" },
  { name: "bun test", conclusion: "success" },
];
const skipped = (reason: string): Step[] => [
  { name: "Set up job", conclusion: "success" },
  { name: `pulado: ${reason}`, conclusion: "success" },
  { name: "bun test", conclusion: "skipped" },
];

describe("merge-gate", () => {
  test("os três verdes: passa", () => {
    const v = judge([run("bun test", "SUCCESS", 1), run("typecheck", "SUCCESS", 2), run("swift test", "SUCCESS", 3)], () => ran);
    expect(v.map((x) => [x.name, x.state, x.ok])).toEqual([
      ["bun test", "passou", true],
      ["typecheck", "passou", true],
      ["swift test", "passou", true],
    ]);
  });

  test("o pulado com motivo passa, com o motivo", () => {
    const steps = new Map([[3, skipped("o PR não mexe em native/")]]);
    const v = judge([run("bun test", "SUCCESS", 1), run("typecheck", "SUCCESS", 2), run("swift test", "SUCCESS", 3)], (c) => steps.get(Number(c.detailsUrl!.split("/").pop())) ?? ran);
    expect(v[2]).toEqual({ name: "swift test", state: "pulado", ok: true, detail: "o PR não mexe em native/" });
    expect(v.every((x) => x.ok)).toBe(true);
  });

  test("barra o vermelho, o cancelado e o que ainda roda", () => {
    const v = judge(
      [run("bun test", "FAILURE", 1), run("typecheck", "CANCELLED", 2), { __typename: "CheckRun", name: "swift test", status: "IN_PROGRESS", conclusion: null }],
      () => ran,
    );
    expect(v.map((x) => [x.state, x.ok])).toEqual([
      ["vermelho", false],
      ["vermelho", false],
      ["rodando", false],
    ]);
  });

  test("barra o check que falta", () => {
    const v = judge([run("bun test", "SUCCESS", 1), run("typecheck", "SUCCESS", 2)], () => ran);
    expect(v[2]).toMatchObject({ name: "swift test", state: "falta", ok: false });
  });

  test("barra o pulado sem motivo: o skipped do GitHub e o passo vazio", () => {
    const empty: Step[] = [{ name: "pulado:", conclusion: "success" }];
    const v = judge([run("bun test", "SUCCESS", 1), run("typecheck", "SUCCESS", 2), run("swift test", "SKIPPED", 3)], (c) => (c.name === "bun test" ? empty : ran));
    expect(v[0]).toMatchObject({ state: "pulado sem motivo", ok: false });
    expect(v[2]).toMatchObject({ state: "pulado sem motivo", ok: false });
  });

  test("um check a mais que falhou também barra; o rodado de novo vale o último", () => {
    const v = judge(
      [
        run("bun test", "FAILURE", 1, "2026-01-01T10:00:00Z"),
        run("bun test", "SUCCESS", 4, "2026-01-01T11:00:00Z"),
        run("typecheck", "SUCCESS", 2),
        run("swift test", "SUCCESS", 3),
        run("changes", "FAILURE", 5),
      ],
      () => ran,
    );
    expect(v[0]).toMatchObject({ name: "bun test", state: "passou" });
    expect(v[3]).toMatchObject({ name: "changes", state: "vermelho", ok: false });
  });

  test("o motivo vem só de um passo pulado: que deu certo", () => {
    expect(skipReason(ran)).toBeUndefined();
    expect(skipReason(null)).toBeUndefined();
    expect(skipReason([{ name: "pulado: texto", conclusion: "failure" }])).toBeUndefined();
    expect(skipReason([{ name: "pulado:   ", conclusion: "success" }])).toBe("");
  });
});
