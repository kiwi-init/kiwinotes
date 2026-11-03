// O app pede as permissões que faltam (T532). O helper sabe como pedir cada uma (o diálogo do macOS na primeira
// vez, os Ajustes depois, uma janela por vez); aqui fica quando pedir:
// - na primeira vez que o app abre, uma por vez: o Monitoramento de Entrada (sem ele o atalho não chega) e depois a
//   Acessibilidade (para colar). A próxima só sai quando a anterior foi dada, para não empilhar janelas;
// - o microfone no primeiro ditado, quando o macOS ainda não perguntou (`record.error` com `undetermined`);
// - e sempre que a pessoa clicar em "Permitir acesso…" no menu da barra, enquanto faltar alguma. Esse clique pede com
//   `reset`: se a permissão já foi pedida e segue faltando (a chave ligada nos Ajustes que não vale, T658), o helper
//   apaga a entrada e pede de novo, e depois abre os Ajustes, para o clique nunca terminar em nada (T825).
// O que já foi pedido sozinho fica em <dados>/permissions.json, para não abrir os Ajustes a cada vez que o app sobe.

import path from "node:path";

import type { Command, Event, EventMessage, Permission, Permissions, ResultMessage } from "../shared/ipc.ts";
import { readJson, writeJson } from "../store/files.ts";

/** A ordem em que o app pede: sem o atalho nada começa; sem colar, o texto fica no clipboard; o mic pede no uso. */
export const ASK_ORDER: Permission[] = ["inputMonitoring", "accessibility", "microphone"];
/** As que o app pede sozinho ao abrir. O microfone fica para o primeiro ditado. */
const ON_LAUNCH: Permission[] = ["inputMonitoring", "accessibility"];

export const PERMISSION_NAMES: Record<Permission, string> = {
  microphone: "Microfone",
  accessibility: "Acessibilidade",
  inputMonitoring: "Monitoramento de Entrada",
};

export interface PermissionsSidecar {
  send<C extends Command>(command: C): Promise<ResultMessage<C["type"]>>;
  on<T extends Event["type"]>(type: T, fn: (e: EventMessage<Extract<Event, { type: T }>>) => void): () => void;
}

/** Onde o app lembra o que já pediu sozinho. */
export interface AskedStore {
  load(): Promise<Permission[]>;
  save(asked: Permission[]): Promise<void>;
}

export function fileAskedStore(dir: string): AskedStore {
  const file = path.join(dir, "permissions.json");
  return {
    load: async () => (await readJson<{ asked?: Permission[] }>(file))?.asked ?? [],
    save: (asked) => writeJson(file, { version: 1, asked }),
  };
}

export const missing = (p: Permissions | undefined): Permission[] =>
  p ? ASK_ORDER.filter((k) => p[k] !== "granted") : [];

export class PermissionFlow {
  private current?: Permissions;
  private asked?: Permission[];
  private asking = false;
  /**
   * Um `update` por vez: com dois seguidos antes do `store.load()` terminar, os dois pediriam a mesma permissão, e o
   * segundo pedido abriria os Ajustes junto com o diálogo (review #543).
   */
  private chain: Promise<unknown> = Promise.resolve();
  private offs: (() => void)[] = [];

  /**
   * @param auto pedir sozinho (na abertura e no primeiro ditado). `false` com `KIWI_DEBUG=1`: um agente nunca faz o
   *   macOS abrir um diálogo na tela da pessoa (AGENTS.md, #537); só o item do menu pede.
   * @param resetOnClick o clique no menu pode apagar a entrada da permissão (`tccutil reset`). `false` com
   *   `KIWI_DEBUG=1`: um agente nunca mexe nas permissões da pessoa (#666).
   */
  constructor(
    private readonly sidecar: PermissionsSidecar,
    private readonly store: AskedStore,
    private readonly log: (m: string) => void = (m) => console.log(`[permissions] ${m}`),
    private readonly auto = true,
    private readonly resetOnClick = auto,
  ) {}

  attach(): void {
    this.offs.push(
      this.sidecar.on("ready", (e) => this.enqueue(e.permissions)),
      this.sidecar.on("permissions.changed", (e) => this.enqueue(e.permissions)),
      // O macOS ainda não perguntou do microfone: pergunta agora, no ditado que precisou dele.
      this.sidecar.on("record.error", (e) => {
        if (this.auto && e.microphone === "undetermined") void this.request("microphone");
      }),
    );
  }

  detach(): void {
    for (const off of this.offs.splice(0)) off();
  }

  /** O que falta agora, na ordem em que o app pede. */
  missing(): Permission[] {
    return missing(this.current);
  }

  /** O clique em "Permitir acesso…": pede a primeira que falta (o helper abre o diálogo ou os Ajustes). */
  async askNext(): Promise<Permission | undefined> {
    const next = this.missing()[0];
    if (next) await this.request(next, this.resetOnClick);
    return next;
  }

  private enqueue(permissions: Permissions) {
    this.current = permissions;
    this.chain = this.chain.then(() => this.update(permissions)).catch((e) => this.log(`update failed: ${String(e)}`));
  }

  /** A cada estado novo: na primeira vez do app, pede a próxima que falta e que ainda não foi pedida sozinha. */
  private async update(permissions: Permissions) {
    if (!this.auto) return;
    this.asked ??= await this.store.load().catch(() => []);
    if (this.asking) return;
    const next = ON_LAUNCH.find((p) => permissions[p] !== "granted" && !this.asked!.includes(p));
    if (!next) return;
    // Uma janela por vez: a próxima só depois que esta foi dada (o próximo permissions.changed).
    const earlier = ON_LAUNCH.slice(0, ON_LAUNCH.indexOf(next));
    if (earlier.some((p) => permissions[p] !== "granted" && this.asked!.includes(p))) return;
    this.asked = [...this.asked!, next];
    await this.store.save(this.asked).catch((e) => this.log(`couldn't save: ${String(e)}`));
    await this.request(next);
  }

  private async request(permission: Permission, reset = false) {
    this.asking = true;
    try {
      const result = await this.sidecar.send({ type: "permissions.request", permission, ...(reset ? { reset } : {}) });
      this.log(`${permission}: ${result.ok ? result.data.state : result.error}`);
    } catch (e) {
      this.log(`${permission}: ${String(e)}`);
    } finally {
      this.asking = false;
    }
  }
}
