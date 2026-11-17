// O texto de fora do editor (o `/modelo`; antes, o composer do T2502) entra no cursor sem colar na palavra de antes.
import { expect, test } from "bun:test";

import { joinInsert } from "./NoteEditor.tsx";

test("um espaço só quando colaria numa palavra", () => {
  expect(joinInsert("a", "Ditado.")).toBe(" Ditado.");
  expect(joinInsert(".", "Ditado.")).toBe(" Ditado.");
  expect(joinInsert(" ", "Ditado.")).toBe("Ditado.");
  expect(joinInsert("\n", "Ditado.")).toBe("Ditado.");
  expect(joinInsert("", "Ditado.")).toBe("Ditado.");
});
