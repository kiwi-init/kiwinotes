import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { request } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";

import { criarServidor } from "./servir.ts";

// O servidor de verdade, numa pasta temporária (o direcao.json do repo nunca é tocado), numa porta livre.
const dir = mkdtempSync(path.join(tmpdir(), "diretor-"));
const svgAbs = path.join(dir, "gato.svg");
const direcaoAbs = path.join(dir, "direcao.json");
copyFileSync(path.join(import.meta.dir, "../kiwi-cat-familia/kiwi-cat-1-aura-intro.svg"), svgAbs);
let servidor: ReturnType<typeof criarServidor>;
let porta = 0;

beforeAll(() => {
  servidor = criarServidor({ svgAbs, svgRel: "gato.svg", direcaoAbs, porta: 0 });
  porta = servidor.port!;
});
afterAll(() => {
  servidor.stop(true);
  rmSync(dir, { recursive: true, force: true });
});

/** Um pedido com o Host e o Origin que quisermos (o fetch não deixa trocar o Host; o node:http deixa). */
function pedir(metodo: string, caminho: string, cab: Record<string, string>, corpo?: unknown): Promise<{ status: number; texto: string }> {
  return new Promise((ok, falha) => {
    const dados = corpo === undefined ? undefined : JSON.stringify(corpo);
    const req = request({ host: "127.0.0.1", port: porta, method: metodo, path: caminho, headers: { ...cab, ...(dados ? { "content-type": "application/json" } : {}) } }, (res) => {
      let texto = "";
      res.on("data", (c) => (texto += c));
      res.on("end", () => ok({ status: res.statusCode ?? 0, texto }));
    });
    req.on("error", falha);
    if (dados) req.write(dados);
    req.end();
  });
}

const boa = { mudancas: [{ seletor: "#ear-left-pop", animacao: "earPopL", atraso: 2.3 }], notas: [] };

describe("o servidor do diretor (T3065, revisão do #110)", () => {
  test("a página e o estado respondem pelo 127.0.0.1", async () => {
    const host = `127.0.0.1:${porta}`;
    expect((await pedir("GET", "/", { host })).status).toBe(200);
    const estado = JSON.parse((await pedir("GET", "/api/estado", { host })).texto);
    expect(estado.svg).toContain("earPopL");
  });

  test("DNS rebinding: Host e Origin de outro site, que batem entre si, dão 403 e não gravam", async () => {
    const evil = `evil.example:${porta}`;
    const put = await pedir("PUT", "/api/direcao", { host: evil, origin: `http://${evil}` }, boa);
    expect(put.status).toBe(403);
    expect((await pedir("GET", "/api/estado", { host: evil })).status).toBe(403);
    expect(existsSync(direcaoAbs)).toBe(false);
  });

  test("o PUT sem o Origin da própria página dá 403", async () => {
    const host = `127.0.0.1:${porta}`;
    expect((await pedir("PUT", "/api/direcao", { host, origin: "http://evil.example" }, boa)).status).toBe(403);
    expect((await pedir("PUT", "/api/direcao", { host }, boa)).status).toBe(403);
    expect(existsSync(direcaoAbs)).toBe(false);
  });

  test("uma curva que não é curva (injeção de CSS) é recusada, com 400, e nada é gravado", async () => {
    const host = `127.0.0.1:${porta}`;
    const ruim = { mudancas: [{ seletor: "#intro-circle", animacao: "circleIn", curva: "ease;} svg{background:url(https://example.com/x.png)} .z{x:y" }], notas: [] };
    const r = await pedir("PUT", "/api/direcao", { host, origin: `http://${host}` }, ruim);
    expect(r.status).toBe(400);
    expect(r.texto).toContain("curva inválida");
    const neg = await pedir("PUT", "/api/direcao", { host, origin: `http://${host}` }, { mudancas: [{ seletor: "#tail", animacao: "tailDraw", duracao: -1 }], notas: [] });
    expect(neg.status).toBe(400);
    expect(existsSync(direcaoAbs)).toBe(false);
  });

  test("a página de verdade grava", async () => {
    const host = `127.0.0.1:${porta}`;
    const r = await pedir("PUT", "/api/direcao", { host, origin: `http://${host}` }, boa);
    expect(r.status).toBe(200);
    expect(JSON.parse(readFileSync(direcaoAbs, "utf8")).mudancas).toEqual([{ seletor: "#ear-left-pop", animacao: "earPopL", atraso: 2.3 }]);
  });
});
