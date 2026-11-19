// O pouco do pako 1.0 que o `zip.ts` usa: compactar e abrir uma parte do zip inteira (deflate sem cabeçalho).
declare module "pako" {
  export function deflateRaw(data: Uint8Array, options?: { level?: number }): Uint8Array;
  export function inflateRaw(data: Uint8Array): Uint8Array;
}
