import { expect, test } from "bun:test";

import { fogSurface } from "./surface";

test("só o fundo preto (ou quase) é escuro; o claro, as cores e o cinza são claros", () => {
  expect(fogSurface("rgb(0, 0, 0)")).toBe("dark");
  expect(fogSurface("rgb(10, 10, 12)")).toBe("dark");
  expect(fogSurface("rgb(255, 255, 255)")).toBe("light");
  expect(fogSurface("rgb(54, 122, 142)")).toBe("light");
  expect(fogSurface("rgb(40, 40, 44)")).toBe("light");
  expect(fogSurface("rgba(0, 0, 0, 0)")).toBe("dark");
  expect(fogSurface("")).toBe("dark");
});
