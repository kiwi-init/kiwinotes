// T2502: o texto do composer entra no cursor do editor sem colar na palavra de antes.
import { expect, test } from "bun:test";

import { joinInsert } from "./NoteEditor.tsx";

test("um espaço só quando colaria numa palavra", () => {
  expect(joinInsert("a", "Ditado.")).toBe(" Ditado.");
  expect(joinInsert(".", "Ditado.")).toBe(" Ditado.");
  expect(joinInsert(" ", "Ditado.")).toBe("Ditado.");
  expect(joinInsert("\n", "Ditado.")).toBe("Ditado.");
  expect(joinInsert("", "Ditado.")).toBe("Ditado.");
});
