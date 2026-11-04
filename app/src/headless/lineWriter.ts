// Escrever uma linha inteira num socket do Bun (T2594). O `socket.write` escreve só o que cabe no buffer e devolve
// quantos bytes foram: com uma linha grande (um anexo em base64, o `data:` URL de volta), o resto se perdia, a linha
// chegava sem o "\n" e o pedido ficava esperando para sempre. Aqui o resto espera o `drain` e sai na ordem.

interface Writable {
  write(data: Uint8Array): number;
}

const encoder = new TextEncoder();

export class LineWriter {
  private pending: Uint8Array[] = [];

  constructor(private readonly socket: Writable) {}

  /** Põe a linha na fila e manda o que der agora. */
  line(text: string): void {
    this.pending.push(encoder.encode(`${text}\n`));
    this.flush();
  }

  /** Chamado no `drain` do socket: manda o que ficou. */
  flush(): void {
    while (this.pending.length) {
      const head = this.pending[0]!;
      const n = this.socket.write(head);
      if (n >= head.length) this.pending.shift();
      else {
        if (n > 0) this.pending[0] = head.subarray(n);
        return;
      }
    }
  }

  /** Quantos bytes ainda esperam (para os testes). */
  get waiting(): number {
    return this.pending.reduce((s, b) => s + b.length, 0);
  }
}
