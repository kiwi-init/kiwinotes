/**
 * Uma recarga por vez, e a da própria operação uma vez só (spec #20118, T20167).
 *
 * Renomear, mover, criar ou apagar pela janela pedia a lista inteira duas vezes: o `after()` da operação e o
 * `notes.changed` que o engine manda dela (o `patchListing` não acha um caminho novo). Nas operações de pasta vinham
 * ainda o 2º `notes.changed` e o `files.changed` do mesmo instante: quatro listas de ~3 MB, cada uma um quadro de até
 * 390 ms num cofre de 6 mil pastas (#20154).
 *
 * - `request()`: uma recarga que começa depois do pedido. Com uma em andamento (que pode ter saído antes da mudança),
 *   fica uma só na fila, para todos que pedirem até ela começar.
 * - `changed(paths)`: o aviso do engine. Recarrega e anota os caminhos, com a recarga que já os cobre. `track(paths,
 *   load)`, o mesmo com outra atualização (o `patchListing`).
 * - `after(paths)`: a janela terminou uma operação. O engine manda o aviso antes da resposta, então a recarga dela já
 *   saiu: devolve essa. Sem aviso (outro transporte, uma operação que não avisa), pede uma nova, como antes.
 *
 * O aviso atrasado do watcher (o 2º `notes.changed` e o `files.changed` da pasta, ~100 ms depois) não se pula: no
 * mesmo caminho pode vir uma mudança nova de verdade (a pasta criada de novo por fora). Os dois chegam juntos e entram
 * na mesma recarga da fila.
 */
export class ReloadQueue<T> {
  private running: Promise<T> | null = null;
  private queued: Promise<T> | null = null;
  private readonly echoes = new Map<string, { at: number; load: Promise<T> }>();

  constructor(
    private readonly fetch: () => Promise<T>,
    private readonly now: () => number = () => Date.now(),
    /** Por quanto tempo um aviso cobre a operação dele. */
    private readonly ttl = 3000,
  ) {}

  request(): Promise<T> {
    if (this.queued) return this.queued;
    if (!this.running) return this.start();
    const before = this.running;
    const settled = () => undefined;
    this.queued = before.then(settled, settled).then(() => {
      this.queued = null;
      return this.start();
    });
    return this.queued;
  }

  changed(paths: readonly string[]): Promise<T> {
    return this.track(paths, this.request());
  }

  /**
   * O aviso com uma atualização que não é a lista inteira (o `patchListing` troca só as notas que mudaram, e cai na
   * lista se não der): anota os caminhos com ela, na hora, antes de a resposta da operação chegar.
   */
  track(paths: readonly string[], load: Promise<T>): Promise<T> {
    const at = this.now();
    for (const p of paths) this.echoes.set(p, { at, load });
    return load;
  }

  after(paths: readonly string[]): Promise<T> {
    return this.echo(paths) ?? this.request();
  }

  private echo(paths: readonly string[]): Promise<T> | null {
    const now = this.now();
    for (const [p, e] of this.echoes) if (now - e.at > this.ttl) this.echoes.delete(p);
    for (const p of paths) {
      const e = this.echoes.get(p);
      if (!e) continue;
      // Usado, sai (nimble-heron, #20246): os caminhos do mesmo aviso também. Uma operação seguinte do mesmo caminho
      // que não avise não pega esta recarga velha.
      for (const [q, o] of this.echoes) if (o.load === e.load) this.echoes.delete(q);
      return e.load;
    }
    return null;
  }

  private start(): Promise<T> {
    const p = this.fetch();
    this.running = p;
    const clear = () => {
      if (this.running === p) this.running = null;
    };
    p.then(clear, clear);
    return p;
  }
}
