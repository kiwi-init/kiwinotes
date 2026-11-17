// T2399: o nome e a versão curta do Info.plist.

import { expect, test } from "bun:test";

import { identityKeys } from "./bundle-identity.ts";

test("a versão curta é só a parte numérica; o nome de exibição e a categoria entram", () => {
  expect(identityKeys("0.1.0-rc3")).toEqual({
    CFBundleDisplayName: "Kiwi Notes",
    CFBundleShortVersionString: "0.1.0",
    LSApplicationCategoryType: "public.app-category.productivity",
  });
  expect(identityKeys("0.1.0").CFBundleShortVersionString).toBe("0.1.0");
  expect(identityKeys("1.2").CFBundleShortVersionString).toBe("1.2");
  // Os releases ANO.MÊS.N (spec #13879): três inteiros, o formato que a Apple aceita.
  expect(identityKeys("2026.11.1")).toMatchObject({ CFBundleShortVersionString: "2026.11.1" });
  expect(() => identityKeys("rc")).toThrow();
});
