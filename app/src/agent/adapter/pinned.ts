// O adaptador do Claude Code (spec #8368, ADR 0012): a versão fixa e a lista fixa de pacotes que o Kiwi baixa.
//
// - **Só estes cinco pacotes.** O adaptador e as dependências dele, com o `integrity` que o npm publica. Um pacote que
//   chega diferente é recusado e apagado.
// - **Sem a cópia do Claude Code.** O `@anthropic-ai/claude-agent-sdk` declara, como dependências opcionais, um Claude
//   Code inteiro para cada plataforma (`…-darwin-arm64` tem 324 MB). Um `npm install` comum baixaria esse e o adaptador
//   usaria ele. O Kiwi não instala pelo npm: ele baixa só esta lista, e nenhum `…-darwin-*` está nela (ADR 0011).
// - **As dependências "peer" do SDK** (`@anthropic-ai/sdk`, `@modelcontextprotocol/sdk`) ficam de fora: o adaptador só
//   importa o `sdk.mjs` do SDK, que só usa módulos do próprio Node/Bun.
// - **Trocar de versão** é uma versão nova do Kiwi: atualizar esta lista (`npm view <pacote>@<versão> dist.integrity`),
//   o `CLAUDE_CODE_FOR_ADAPTER` e rodar a prova (`KIWI_ADAPTER_PROOF=1 bun test src/agent/adapter`).

export interface PinnedPackage {
  name: string;
  version: string;
  /** O `dist.integrity` do npm (SRI, sha512 em base64). */
  integrity: string;
  /** A licença, como o npm diz. O SDK do Claude é fechado: ele fica na pasta de dados, nunca dentro do app. */
  license: string;
}

export const ADAPTER_PACKAGE = "@agentclientprotocol/claude-agent-acp";
export const ADAPTER_VERSION = "0.106.0";

/**
 * A versão do Claude Code para a qual o adaptador foi feito: a do `manifest.json` do `@anthropic-ai/claude-agent-sdk`
 * 0.3.322, que é o que o adaptador 0.106.0 usa. A régua de versão (`version.ts`) compara o Claude Code instalado com ela.
 */
export const CLAUDE_CODE_FOR_ADAPTER = "2.1.322";

export const ADAPTER_PACKAGES: readonly PinnedPackage[] = [
  {
    name: ADAPTER_PACKAGE,
    version: ADAPTER_VERSION,
    integrity: "sha512-jfwcUc7J+KTIOqsPPSDzCgh4WI+QgvbPEACPtibMV1e41spmsR2Wb5xEeO1lh0el/kLxi7nF3zqZ1RYpdoVw7Q==",
    license: "Apache-2.0",
  },
  {
    name: "@anthropic-ai/claude-agent-sdk",
    version: "0.3.322",
    integrity: "sha512-r88ij7R3SPV2j3BtFuavgrbWZNE8SVVS42AOQ1KxlS+QnSwNNnUhmVXV3Es2dniZySBYX8ENebL43ffhiB0azw==",
    license: "SEE LICENSE IN README.md",
  },
  {
    name: "@agentclientprotocol/sdk",
    version: "2.6.0",
    integrity: "sha512-3FtL6MkAV5F9qxg0FQV8wmBszIm2xuVPoDWOILIFSDQ+Vq3Twdh7Cw6Hk2GOPUbevgrTUpUAqZXQy7Geaj79mw==",
    license: "Apache-2.0",
  },
  {
    name: "diff",
    version: "9.0.0",
    integrity: "sha512-svtcdpS8CgJyqAjEQIXdb3OjhFVVYjzGAPO8WGCmRbrml64SPw/jJD4GoE98aR7r25A0XcgrK3F02yw9R/vhQw==",
    license: "BSD-3-Clause",
  },
  {
    name: "zod",
    version: "4.6.7",
    integrity: "sha512-g8W2D2kU6a8untc053fX1uVBKzM7yqAxW/3zwk83+6RyF2+SKOuV+c0wBDhUwzV1PaGapmZH+rmcUzPf+3CGwg==",
    license: "MIT",
  },
];

export const NPM_REGISTRY = "https://registry.npmjs.org";

/** O endereço do .tgz de um pacote no registro: `<registro>/<nome>/-/<nome sem escopo>-<versão>.tgz`. */
export function tarballUrl(pkg: Pick<PinnedPackage, "name" | "version">, registry = NPM_REGISTRY): string {
  const base = pkg.name.includes("/") ? pkg.name.split("/")[1]! : pkg.name;
  return `${registry.replace(/\/+$/, "")}/${pkg.name}/-/${base}-${pkg.version}.tgz`;
}
