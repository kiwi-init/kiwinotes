// O renomear de um arquivo que não é nota guarda a extensão (T19878).
import { expect, test } from "bun:test";

import { withExt } from "./Sidebar.tsx";

test("a extensão volta no fim, uma vez só", () => {
  expect(withExt("relatorio", "pdf")).toBe("relatorio.pdf");
  expect(withExt("relatorio.pdf", "pdf")).toBe("relatorio.pdf");
  expect(withExt("relatorio.PDF", "pdf")).toBe("relatorio.pdf");
  expect(withExt("v1.2", "csv")).toBe("v1.2.csv");
  expect(withExt("LEIAME", "")).toBe("LEIAME");
  expect(withExt(null, "pdf")).toBe(null);
});
