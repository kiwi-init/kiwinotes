// As chaves públicas que assinam as UIs do AppEngine (T1192, ADR 0006). Só a pública fica no código: o engine aceita
// um manifest só se ele foi assinado por uma destas.
//
// A privada nunca entra no git nem na sala. Em dev ela fica em ~/.config/kiwinotes/ui-signing/<keyId>.private.pem
// (0600), no Mac de quem publica; quem tem hoje: o Mac do harry, onde os agentes rodam. Para trocar a chave: gere
// outra (`bun .hutch/devkit/api/sdks/main/appengine/cli.ts keygen --out ~/.config/kiwinotes/ui-signing`), ponha a
// pública aqui ao lado da antiga, publique com a nova e só depois tire a antiga.
//
// O canal remoto tem a chave dele (T25030, harry #25117): c68953676add986c, gerada direto no segredo do repo
// `UI_SIGNING_KEY`, que só o `ui-publish.yml` lê; a privada não existe em nenhum Mac. Para trocá-la: gere outra direto
// no segredo, ponha a pública aqui, solte um release, e só então publique com ela.

import type { TrustedKeys } from "electrobun/bun/appengine";

export const UI_TRUSTED_KEYS: TrustedKeys = {
  "1665a851209e3378": "ZuAf2dCwM82UNK7_dtQM3MhFQZOIiE_RTquMgsc8ads",
  "c68953676add986c": "QtBp4X9G52yaUJqqlB9BFQCCxNXmDm3g3oEbrb5mxcA",
};
