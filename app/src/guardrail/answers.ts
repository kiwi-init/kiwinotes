// O que a pessoa já respondeu sobre um trecho em dúvida (spec #9873): "Pode mandar" ou "É segredo". O Kiwi lembra para
// não perguntar de novo, em qualquer nota, e nunca guarda o trecho.
//
// - **Uma impressão digital com chave:** `HMAC-SHA256(chave, trecho)`. A chave é do app (32 bytes aleatórios, em
//   `<dados>/agent/guardrail.key`, 0600), e sem ela não dá para descobrir o trecho nem por tentativa.
// - **Fora do cofre,** nos dados do app: `<dados>/agent/guardrail-answers.json` (0600), com a resposta, a hora, o tipo
//   e a máscara do detector (o prefixo público e o tamanho, nunca um caractere do trecho).

import { createHmac, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

export type DoubtAnswer = "send" | "hold";

export interface StoredAnswer {
  fingerprint: string;
  answer: DoubtAnswer;
  at: string;
  /** A máscara do trecho (`•••• (40 caracteres)`), para a lista em Ajustes. */
  mask: string;
  kind: string;
}

export class DoubtAnswers {
  private key: Buffer | null = null;
  private cache: Record<string, Omit<StoredAnswer, "fingerprint">> | null = null;

  constructor(
    private readonly dir: string,
    private readonly now: () => number = Date.now,
  ) {}

  private get file(): string {
    return path.join(this.dir, "guardrail-answers.json");
  }

  /** A chave do app: criada na primeira vez, 0600, e nunca sai daqui. */
  private secret(): Buffer {
    if (this.key) return this.key;
    const file = path.join(this.dir, "guardrail.key");
    mkdirSync(this.dir, { recursive: true, mode: 0o700 });
    if (!existsSync(file)) writeFileSync(file, randomBytes(32), { mode: 0o600, flag: "wx" });
    this.key = readFileSync(file);
    if (this.key.length < 32) throw new Error("guardrail.key is too short");
    return this.key;
  }

  /** A impressão digital de um trecho. */
  fingerprint(value: string): string {
    return createHmac("sha256", this.secret()).update(value, "utf8").digest("hex");
  }

  private load(): Record<string, Omit<StoredAnswer, "fingerprint">> {
    if (this.cache) return this.cache;
    try {
      const raw = JSON.parse(readFileSync(this.file, "utf8")) as unknown;
      this.cache = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, Omit<StoredAnswer, "fingerprint">>) : {};
    } catch {
      this.cache = {};
    }
    return this.cache;
  }

  private save(): void {
    mkdirSync(this.dir, { recursive: true, mode: 0o700 });
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.cache ?? {}, null, 2) + "\n", { mode: 0o600 });
    renameSync(tmp, this.file);
  }

  /** A resposta guardada para esta impressão digital, se houver. */
  get(fingerprint: string): DoubtAnswer | null {
    return this.load()[fingerprint]?.answer ?? null;
  }

  set(fingerprint: string, answer: DoubtAnswer, mask: string, kind: string): void {
    if (!/^[0-9a-f]{64}$/.test(fingerprint)) throw Object.assign(new Error("bad fingerprint"), { code: "E_BAD_ARGS" });
    this.load()[fingerprint] = { answer, at: new Date(this.now()).toISOString(), mask, kind };
    this.save();
  }

  /** Esquece uma resposta: o trecho volta a ser perguntado. */
  forget(fingerprint: string): boolean {
    const all = this.load();
    if (!all[fingerprint]) return false;
    delete all[fingerprint];
    this.save();
    return true;
  }

  /** As respostas, da mais nova para a mais velha. */
  list(): StoredAnswer[] {
    return Object.entries(this.load())
      .map(([fingerprint, a]) => ({ fingerprint, ...a }))
      .sort((a, b) => b.at.localeCompare(a.at));
  }
}
