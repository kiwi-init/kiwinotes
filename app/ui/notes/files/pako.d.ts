// O pouco do pako 1.0 que o `zipSize.ts` usa: a descompressão em partes, com o `onData` de cada pedaço que sai.
declare module "pako/lib/inflate.js" {
  export class Inflate {
    constructor(options?: { raw?: boolean; chunkSize?: number });
    push(data: Uint8Array, mode?: boolean | number): boolean;
    onData(chunk: Uint8Array): void;
    onEnd(status: number): void;
    err: number;
    msg: string;
  }
}
