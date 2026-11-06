// T6013: com o modelo de verdade (KIWI_MODELS_DIR apontando para um já baixado), o e5 acha pelo sentido em PT e o
// critério de "perto" deixa de fora as buscas sem nota certa. Sem o modelo (o CI), o teste é pulado: nada é baixado.
import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { SemanticEngine } from "./engine.ts";
import { SemanticIndex } from "./index.ts";
import { E5_SMALL, modelPresent } from "./model.ts";

const models = process.env.KIWI_MODELS_DIR ?? "";
const ready = !!models && (await modelPresent(models, E5_SMALL));
const dir = mkdtempSync(path.join(tmpdir(), "kn-e5-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const NOTES: Record<string, string> = {
  "Vendas.md": "Revisar a meta do trimestre e o pipeline de clientes.",
  "Bolo de cenoura.md": "Receita com cobertura de chocolate, assa por 40 minutos.",
  "Mercado.md": "Lista de compras: leite, ovos, pão, café e frutas.",
  "Férias.md": "Ideias para a viagem: praia no nordeste, passagens em janeiro.",
  "Bug do login.md": "O token expira antes do tempo e o usuário cai da sessão.",
  "Treino.md": "5 km leves na segunda, intervalado na quarta.",
  "Leituras.md": "Livros para ler: Dom Casmurro, Grande Sertão e O Cortiço.",
  "Carro.md": "Trocar o óleo e revisar os freios antes da viagem longa.",
  "Plantas.md": "Regar a samambaia duas vezes por semana e adubar no mês que vem.",
  "Backup.md": "Configurar o backup do servidor toda noite às 2h para o storage na nuvem.",
};

test.skipIf(!ready)("o e5 acha a nota pelo sentido, sem palavra em comum, e não inventa", async () => {
  const engine = new SemanticEngine({ modelsDir: models, enabled: async () => true, download: false });
  const index = new SemanticIndex({ dir, engine, pause: async () => {} });
  index.sync(Object.entries(NOTES).map(([p, content]) => ({ path: p, title: p.replace(/\.md$/, ""), version: "1", content })));
  await index.idle();
  expect(index.status()).toEqual({ notes: 10, indexed: 10 });
  const cases: [string, string][] = [
    ["objetivos comerciais", "Vendas.md"],
    ["como fazer um doce", "Bolo de cenoura.md"],
    ["o que comprar no supermercado", "Mercado.md"],
    ["planejar as férias", "Férias.md"],
    ["problema de autenticação", "Bug do login.md"],
    ["manutenção do automóvel", "Carro.md"],
    ["cuidar do jardim", "Plantas.md"],
    ["cópia de segurança dos dados", "Backup.md"],
  ];
  for (const [q, want] of cases) {
    const [top] = await index.query(q, 3);
    expect([q, top?.path, top?.near]).toEqual([q, want, true]);
  }
  for (const q of ["física quântica de partículas", "impostos de renda e declaração", "música clássica de Bach"]) {
    const hits = await index.query(q, 10);
    expect([q, hits.filter((h) => h.near).map((h) => h.path)]).toEqual([q, []]);
  }
  await engine.close();
}, 60_000);
