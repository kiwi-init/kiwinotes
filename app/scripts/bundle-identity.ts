// As chaves de identidade do Info.plist (T2399), fora do hook `info-plist.ts`, que roda ao ser importado.

/**
 * O nome e a versão que o Finder, o Spotlight e o LaunchServices leem (T2399, #2408). O Electrobun só grava
 * `CFBundleName` e `CFBundleVersion` (`0.1.0-rc3`); sem `CFBundleDisplayName` e `CFBundleShortVersionString`, o
 * "Obter Informações" fica sem versão e o LaunchServices tem menos com o que escolher entre cópias do mesmo bundle id.
 * A versão curta é só a parte numérica (`0.1.0`), o formato que a Apple pede; a completa segue no `CFBundleVersion`.
 */
export function identityKeys(bundleVersion: string): Record<string, string> {
  const short = /^\d+(?:\.\d+){0,2}/.exec(bundleVersion)?.[0];
  if (!short) throw new Error(`info-plist: CFBundleVersion ${JSON.stringify(bundleVersion)} has no x.y.z`);
  return {
    CFBundleDisplayName: "Kiwi Notes",
    CFBundleShortVersionString: short,
    LSApplicationCategoryType: "public.app-category.productivity",
  };
}
