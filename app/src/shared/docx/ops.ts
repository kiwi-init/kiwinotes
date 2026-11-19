// As mudanças que o Kiwi fez num docx (T21231, spec #21155), para o Kiwi ao vivo: o `docx_edit` grava os bytes novos e
// manda estas operações no `agent.wrote`, e o docx aberto toca cada uma na frente da pessoa (o texto entrando, o realce).
//
// O parágrafo vai pelo id dele, o `w14:paraId` do arquivo: o mesmo na leitura do agente e no motor da tela, que é o mesmo
// pacote. Num arquivo sem ele, os dois derivam o mesmo id a cada abertura, e a gravação o escreve. As posições são as
// do texto do parágrafo no modelo do motor (a projeção `model`), cada operação sobre o resultado da anterior.

export type DocxOp =
  /** Troca `[from, to)` do parágrafo por `text` (vazio apaga o trecho). */
  | { op: "replace"; paragraphId: string; from: number; to: number; text: string }
  /** Um parágrafo novo com `text`, depois de `after` (null: no início do documento). `paragraphId` é o id que ele ganhou. */
  | { op: "insert"; after: string | null; paragraphId: string; text: string }
  /** Apaga o parágrafo inteiro. */
  | { op: "delete"; paragraphId: string }
  /**
   * Uma linha nova numa tabela, logo abaixo da linha de `after` (um parágrafo de uma célula dela), com um parágrafo por
   * célula: `cells`, na ordem, com o id que cada um ganhou e o texto (T23627).
   */
  | { op: "insertRow"; after: string; cells: { paragraphId: string; text: string }[] };

/**
 * Onde as operações deixam o documento: `touched`, os parágrafos que ficam com o texto do gato (trocados ou novos), e
 * `gone`, os que ele apagou. O realce vai nos primeiros; a conferência com o disco olha os dois.
 */
export function docxOpsResult(ops: readonly DocxOp[]): { touched: string[]; gone: string[] } {
  const touched = new Set<string>();
  const gone = new Set<string>();
  for (const o of ops) {
    if (o.op === "insertRow") {
      for (const c of o.cells) touched.add(c.paragraphId);
    } else if (o.op === "delete") {
      touched.delete(o.paragraphId);
      gone.add(o.paragraphId);
    } else {
      gone.delete(o.paragraphId);
      touched.add(o.paragraphId);
    }
  }
  return { touched: [...touched], gone: [...gone] };
}

/** Os parágrafos que as operações mudam ou apagam: a pessoa escrevendo num deles faz o gato esperar. */
export function docxOpsTouch(ops: readonly DocxOp[]): Set<string> {
  const out = new Set<string>();
  for (const o of ops) if (o.op === "replace" || o.op === "delete") out.add(o.paragraphId);
  return out;
}
