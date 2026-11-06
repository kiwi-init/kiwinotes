// Um modelo de mentira para os testes da busca pelo sentido (T6013): cada palavra conhecida liga uma dimensão de
// "assunto", então frases com palavras diferentes e o mesmo assunto ficam perto, como no e5, sem baixar nada.

import { fold } from "../../store/text.ts";
import type { Embedder, EmbedKind } from "./embedder.ts";

export const TOPICS: Record<string, number> = {
  backup: 0, copia: 0, seguranca: 0, servidor: 0, storage: 0, pacs: 0, imagens: 0,
  bolo: 1, receita: 1, doce: 1, cenoura: 1, cozinha: 1, chocolate: 1,
  viagem: 2, ferias: 2, praia: 2, passagens: 2,
  vendas: 3, meta: 3, trimestre: 3, comerciais: 3, objetivos: 3, clientes: 3,
  login: 4, autenticacao: 4, token: 4, sessao: 4, senha: 4,
};

export const DIM = 8;

export function fakeVector(text: string): Float32Array {
  const v = new Float32Array(DIM);
  for (const w of fold(text).match(/[a-z0-9]+/g) ?? []) {
    const t = TOPICS[w];
    if (t !== undefined) v[t]! += 1;
  }
  v[DIM - 1] = 0.01;
  const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
  return v.map((x) => x / norm);
}

export function fakeEmbedder(): Embedder & { calls: { texts: readonly string[]; kind: EmbedKind }[] } {
  const calls: { texts: readonly string[]; kind: EmbedKind }[] = [];
  return {
    dim: DIM,
    calls,
    embed: async (texts, kind) => {
      calls.push({ texts, kind });
      return texts.map(fakeVector);
    },
    close: async () => {},
  };
}
