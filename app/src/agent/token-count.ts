// Um contador de tokens local (spec #12137): aproximado e estável, sem rede e sem o tokenizador do agente. Serve para a
// bateria de tokens comparar um item com ele mesmo ao longo do tempo, não para prever a conta do plano.
//
// A regra, fixa: cada palavra (letras ou dígitos seguidos) conta 1 token a cada 4 caracteres, arredondando para cima;
// cada sinal (pontuação, símbolo, colchete, aspas) conta 1; o espaço não conta. Os tokenizadores de verdade ficam perto
// disso no português e no JSON; o que importa aqui é que o mesmo texto dá sempre o mesmo número, e que um texto maior
// dá um número maior.

const PIECE = /[\p{L}\p{M}\p{N}_]+|[^\s\p{L}\p{M}\p{N}_]/gu;

export function countTokens(text: string): number {
  let n = 0;
  for (const m of text.normalize("NFC").matchAll(PIECE)) {
    const piece = m[0];
    n += /^[\p{L}\p{M}\p{N}_]/u.test(piece) ? Math.ceil([...piece].length / 4) : 1;
  }
  return n;
}
