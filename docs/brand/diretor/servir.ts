// O diretor do Kiwi-cat (T3065): serve a página só nesta máquina (127.0.0.1) e grava o `direcao.json` ao lado do SVG.
//
//   bun docs/brand/diretor/servir.ts [--svg docs/brand/kiwi-cat-familia/kiwi-cat-1-aura-intro.svg] [--porta 4790]
//
// Não abre o navegador sozinho: abra o endereço que ele mostra (Safari ou Chrome). Nada vai para a rede: a página não
// carrega nada de fora, e o servidor só escuta no 127.0.0.1.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import type { Direcao } from "./animacao.ts";

const aqui = import.meta.dir;
const raiz = path.resolve(aqui, "../../..");
const arg = (nome: string, padrao: string) => {
  const i = process.argv.indexOf(nome);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1]! : padrao;
};
const svgRel = arg("--svg", "docs/brand/kiwi-cat-familia/kiwi-cat-1-aura-intro.svg");
const svgAbs = path.resolve(raiz, svgRel);
if (!svgAbs.startsWith(raiz + path.sep) || !existsSync(svgAbs)) throw new Error(`diretor: não achei ${svgRel} no repo`);
const direcaoAbs = path.join(path.dirname(svgAbs), "direcao.json");
const porta = Number(arg("--porta", "4790"));

const transpilar = new Bun.Transpiler({ loader: "ts" });
const vazia = (): Direcao => ({ svg: path.relative(raiz, svgAbs), mudancas: [], notas: [] });

function lerDirecao(): Direcao {
  if (!existsSync(direcaoAbs)) return vazia();
  const d = JSON.parse(readFileSync(direcaoAbs, "utf8")) as Direcao;
  return { ...vazia(), ...d };
}

/** O que a página manda tem que ter esta forma; o resto é jogado fora. */
function validar(x: unknown): Direcao {
  const d = x as Partial<Direcao>;
  if (!d || !Array.isArray(d.mudancas) || !Array.isArray(d.notas)) throw new Error("direcao: falta mudancas ou notas");
  const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.round(v * 1000) / 1000 : undefined);
  const s = (v: unknown) => (typeof v === "string" ? v.slice(0, 2000) : "");
  return {
    svg: path.relative(raiz, svgAbs),
    mudancas: d.mudancas.map((m) => ({
      seletor: s(m.seletor),
      animacao: s(m.animacao),
      ...(n(m.duracao) !== undefined ? { duracao: n(m.duracao) } : {}),
      ...(n(m.atraso) !== undefined ? { atraso: n(m.atraso) } : {}),
      ...(m.curva ? { curva: s(m.curva) } : {}),
      ...(m.de ? { de: { duracao: n(m.de.duracao) ?? 0, atraso: n(m.de.atraso) ?? 0, curva: s(m.de.curva) } } : {}),
    })),
    notas: d.notas.map((x) => ({ t: n(x.t) ?? 0, x: n(x.x) ?? 0, y: n(x.y) ?? 0, alvo: s(x.alvo), texto: s(x.texto), criada: s(x.criada) })),
  };
}

const arquivo = (nome: string, tipo: string) => new Response(readFileSync(path.join(aqui, nome)), { headers: { "content-type": tipo, "cache-control": "no-store" } });

const servidor = Bun.serve({
  hostname: "127.0.0.1",
  port: porta,
  async fetch(req) {
    const url = new URL(req.url);
    if (req.method === "GET" && url.pathname === "/") return arquivo("index.html", "text/html; charset=utf-8");
    if (req.method === "GET" && url.pathname === "/diretor.js") return arquivo("diretor.js", "text/javascript; charset=utf-8");
    if (req.method === "GET" && url.pathname === "/animacao.js") {
      return new Response(transpilar.transformSync(readFileSync(path.join(aqui, "animacao.ts"), "utf8")), {
        headers: { "content-type": "text/javascript; charset=utf-8", "cache-control": "no-store" },
      });
    }
    if (req.method === "GET" && url.pathname === "/api/estado") {
      return Response.json({ svg: readFileSync(svgAbs, "utf8"), direcao: lerDirecao() }, { headers: { "cache-control": "no-store" } });
    }
    if (req.method === "PUT" && url.pathname === "/api/direcao") {
      // Só a própria página grava: outro site aberto no navegador não consegue mandar um PUT para cá.
      if (req.headers.get("origin") !== url.origin) return new Response("origem errada", { status: 403 });
      try {
        const d = validar(await req.json());
        writeFileSync(direcaoAbs, `${JSON.stringify(d, null, 2)}\n`);
        return Response.json({ ok: true, arquivo: path.relative(raiz, direcaoAbs) });
      } catch (e) {
        return new Response(String((e as Error).message), { status: 400 });
      }
    }
    return new Response("não achei", { status: 404 });
  },
});

console.log(`Diretor do Kiwi-cat: http://127.0.0.1:${servidor.port}/`);
console.log(`  SVG:     ${path.relative(raiz, svgAbs)}`);
console.log(`  Direção: ${path.relative(raiz, direcaoAbs)} (o Salvar grava aqui)`);
console.log("Ctrl-C para parar.");
