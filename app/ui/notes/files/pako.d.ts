// O pouco do pako 1.0 que o `zipSize.ts` usa: a descompressão em partes, com o `onData` de cada pedaço que sai. E o
// `inflateRaw` de uma vez, para a página do `.drawio` que o `checkDrawio` já mediu (T22217).
declare module "pako/lib/inflate.js" {
  export class Inflate {
    constructor(options?: { raw?: boolean; chunkSize?: number });
    push(data: Uint8Array, mode?: boolean | number): boolean;
    onData(chunk: Uint8Array): void;
    onEnd(status: number): void;
    err: number;
    msg: string;
  }
  /** Lança, ou devolve `undefined`, num deflate quebrado. */
  export function inflateRaw(data: Uint8Array): Uint8Array | undefined;
}
