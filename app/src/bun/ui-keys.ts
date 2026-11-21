// As chaves públicas que assinam as UIs do AppEngine (T1192, ADR 0006). Só a pública fica no código: o engine aceita
// um manifest só se ele foi assinado por uma destas.
//
// A privada nunca entra no git nem na sala. Em dev ela fica em ~/.config/kiwinotes/ui-signing/<keyId>.private.pem
// (0600), no Mac de quem publica; quem tem hoje: o Mac do harry, onde os agentes rodam. Para trocar a chave: gere
// outra (`bun .hutch/devkit/api/sdks/main/appengine/cli.ts keygen --out ~/.config/kiwinotes/ui-signing`), ponha a
// pública aqui ao lado da antiga, publique com a nova e só depois tire a antiga.
//
// No CI, a mesma privada é o segredo da org `UI_SIGNING_KEY`, que o `ui-publish.yml` usa para o canal remoto (T25030).
// Quem o põe é o harry; o `ui-channel-publish.ts` recusa uma chave que não está aqui.

import type { TrustedKeys } from "electrobun/bun/appengine";

export const UI_TRUSTED_KEYS: TrustedKeys = {
  "1665a851209e3378": "ZuAf2dCwM82UNK7_dtQM3MhFQZOIiE_RTquMgsc8ads",
};
