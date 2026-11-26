// A chave de um provedor que a pessoa ligou, no Keychain do macOS (spec #31616, T31627, ADR 0011). Hoje, a chave da API
// do ElevenLabs, a da própria pessoa.
//
// - **Só no Keychain:** a chave nunca vai para arquivo, log, settings.json nem para a UI. O main lê na hora de usar; a UI
//   só sabe se há uma chave (`hasKey`).
// - **Pelo `security` do macOS, em modo interativo (`security -i`):** o comando vai pelo stdin, e não na linha de
//   comando, que qualquer processo do Mac lê pelo `ps`. O item é criado pelo próprio `security`, que é quem o lê depois:
//   nenhum diálogo de "permitir acesso" aparece.
// - **Os erros não levam a chave:** só o que deu errado e o código do `security`.
// - **Testes:** o `memoryKeychain()`, um Keychain falso na memória, ou um `.keychain-db` temporário (`keychain`), que
//   não é o da pessoa e não entra na lista de busca do Mac.

/** Onde fica a chave do ElevenLabs (o contrato do spec #31616). */
export const ELEVENLABS_KEYCHAIN = { service: "com.kiwinotes.elevenlabs", account: "api-key" } as const;

/** O `security` não achou o item (errSecItemNotFound, -25300). */
const NOT_FOUND = 44;

/** Roda uma linha do `security -i` e devolve o código de saída e o stdout. */
export type KeychainRunner = (line: string) => Promise<{ code: number; stdout: string }>;

export class KeychainError extends Error {
  readonly code = "E_KEYCHAIN";
}

/** O `security` de verdade. O stderr fica de fora: o Kiwi não o mostra nem o grava. */
export function securityRunner(bin = "/usr/bin/security"): KeychainRunner {
  return async (line) => {
    const p = Bun.spawn([bin, "-i"], { stdin: "pipe", stdout: "pipe", stderr: "ignore" });
    p.stdin.write(`${line}\n`);
    await p.stdin.end();
    const [stdout, code] = await Promise.all([new Response(p.stdout).text(), p.exited]);
    return { code, stdout };
  };
}

/** Uma chave de API tem letras, números, `_`, `-` e `.`: o resto quebraria a linha do `security -i`. */
const KEY = /^[A-Za-z0-9_.-]{8,256}$/;
/** O serviço, a conta e o caminho do Keychain de teste vão entre aspas: sem aspas, barra invertida nem quebra dentro. */
const SAFE = /^[^"\\\n\r]+$/;

export interface KeychainSecretOptions {
  service: string;
  account: string;
  /** Um `.keychain-db` à parte (testes). Sem ele, o Keychain padrão da pessoa. */
  keychain?: string;
  run?: KeychainRunner;
}

export class KeychainSecret {
  private readonly run: KeychainRunner;
  private readonly target: string;

  constructor(private readonly o: KeychainSecretOptions) {
    for (const v of [o.service, o.account, ...(o.keychain ? [o.keychain] : [])]) {
      if (!SAFE.test(v)) throw new KeychainError("keychain: serviço, conta ou caminho inválido");
    }
    this.run = o.run ?? securityRunner();
    this.target = `-s "${o.service}" -a "${o.account}"`;
  }

  private where(): string {
    return this.o.keychain ? ` "${this.o.keychain}"` : "";
  }

  /** A chave, ou `null` se não há nenhuma. */
  async getKey(): Promise<string | null> {
    const r = await this.run(`find-generic-password ${this.target} -w${this.where()}`);
    if (r.code === NOT_FOUND) return null;
    if (r.code !== 0) throw new KeychainError(`keychain: não deu para ler a chave (security ${r.code})`);
    const key = r.stdout.replace(/\r?\n$/, "");
    return key || null;
  }

  async hasKey(): Promise<boolean> {
    return (await this.getKey()) !== null;
  }

  /** Grava (ou troca) a chave. Uma chave com caracteres fora do formato é recusada sem ir ao Keychain. */
  async setKey(key: string): Promise<void> {
    const k = key.trim();
    if (!KEY.test(k)) throw new KeychainError("keychain: isso não parece uma chave de API (só letras, números, _, - e ., de 8 a 256)");
    const r = await this.run(`add-generic-password ${this.target} -w ${k} -U${this.where()}`);
    if (r.code !== 0) throw new KeychainError(`keychain: não deu para gravar a chave (security ${r.code})`);
  }

  /** Apaga a chave. Sem chave, não faz nada. */
  async deleteKey(): Promise<void> {
    const r = await this.run(`delete-generic-password ${this.target}${this.where()}`);
    if (r.code !== 0 && r.code !== NOT_FOUND) throw new KeychainError(`keychain: não deu para apagar a chave (security ${r.code})`);
  }
}

/** A chave do ElevenLabs no Keychain padrão. */
export const elevenLabsKey = (o: Partial<KeychainSecretOptions> = {}) => new KeychainSecret({ ...ELEVENLABS_KEYCHAIN, ...o });

/**
 * Um Keychain falso, na memória, que entende as três linhas que o `KeychainSecret` manda. Para os testes deste módulo e
 * das outras partes do spec #31616 (o provedor e os Ajustes). `lines` guarda o que chegou, para o teste conferir.
 */
export function memoryKeychain(): { run: KeychainRunner; items: Map<string, string>; lines: string[] } {
  const items = new Map<string, string>();
  const lines: string[] = [];
  const run: KeychainRunner = async (line) => {
    lines.push(line);
    const service = /-s "([^"]*)"/.exec(line)?.[1];
    const account = /-a "([^"]*)"/.exec(line)?.[1];
    const id = `${service}\u0000${account}`;
    if (line.startsWith("find-generic-password ")) {
      const v = items.get(id);
      return v === undefined ? { code: NOT_FOUND, stdout: "" } : { code: 0, stdout: `${v}\n` };
    }
    if (line.startsWith("add-generic-password ")) {
      const w = /-w (\S+)/.exec(line)?.[1];
      if (!w) return { code: 1, stdout: "" };
      if (items.has(id) && !/ -U(\s|$)/.test(line)) return { code: 45, stdout: "" };
      items.set(id, w);
      return { code: 0, stdout: "" };
    }
    if (line.startsWith("delete-generic-password ")) {
      return items.delete(id) ? { code: 0, stdout: "password has been deleted.\n" } : { code: NOT_FOUND, stdout: "" };
    }
    return { code: 2, stdout: "" };
  };
  return { run, items, lines };
}
