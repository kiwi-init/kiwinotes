// O diretor do Kiwi-cat (T3065): serve a página só nesta máquina (127.0.0.1) e grava o `direcao.json` ao lado do SVG.
//
//   bun docs/brand/diretor/servir.ts [--svg docs/brand/kiwi-cat-familia/kiwi-cat-1-aura-intro.svg] [--porta 4790]
//
// Não abre o navegador sozinho: abra o endereço que ele mostra (Safari ou Chrome). Nada vai para a rede: a página não
// carrega nada de fora, e o servidor só escuta no 127.0.0.1.
//
// As travas (revisão do #110):
// - **DNS rebinding:** um site pode apontar o próprio nome para 127.0.0.1 e mandar `Host` e `Origin` dele, que batem
//   entre si. Então toda requisição tem que vir com `Host: 127.0.0.1:<porta>`, e o PUT, com esse mesmo `Origin`.
// - **O que se grava:** só mudanças que o `animacao.ts` aceita (a curva num formato conhecido, tempos válidos).

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { type Direcao, problema } from "./animacao.ts";

const aqui = import.meta.dir;
const raiz = path.resolve(aqui, "../../..");

/** O que a página manda tem que ter esta forma; o resto é jogado fora, e uma mudança inválida recusa o pedido inteiro. */
export function validar(x: unknown, svgRel: string): Direcao {
  const d = x as Partial<Direcao>;
  if (!d || !Array.isArray(d.mudancas) || !Array.isArray(d.notas)) throw new Error("direcao: falta mudancas ou notas");
  if (d.mudancas.length > 200 || d.notas.length > 500) throw new Error("direcao: grande demais");
  const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.round(v * 1000) / 1000 : undefined);
  const s = (v: unknown, max = 2000) => (typeof v === "string" ? v.slice(0, max) : "");
  const mudancas = d.mudancas.map((m) => ({
    seletor: s(m.seletor, 200),
    animacao: s(m.animacao, 100),
    ...(m.duracao !== undefined ? { duracao: n(m.duracao) ?? Number.NaN } : {}),
    ...(m.atraso !== undefined ? { atraso: n(m.atraso) ?? Number.NaN } : {}),
    ...(m.curva !== undefined ? { curva: m.curva } : {}),
    ...(m.de ? { de: { duracao: n(m.de.duracao) ?? 0, atraso: n(m.de.atraso) ?? 0, curva: s(m.de.curva, 80) } } : {}),
  }));
  for (const m of mudancas) {
    const ruim = problema(m);
    if (ruim) throw new Error(`direcao: ${m.seletor} ${m.animacao}: ${ruim}`);
  }
  return {
    svg: svgRel,
    mudancas,
    notas: d.notas.map((x) => ({ t: n(x.t) ?? 0, x: n(x.x) ?? 0, y: n(x.y) ?? 0, alvo: s(x.alvo, 200), texto: s(x.texto), criada: s(x.criada, 40) })),
  };
}

export interface Opcoes {
  svgAbs: string;
  /** Como o SVG aparece no `direcao.json` (relativo à raiz do repo). */
  svgRel: string;
  direcaoAbs: string;
  /** 0 escolhe uma porta livre (nos testes). */
  porta: number;
}

export function criarServidor(o: Opcoes) {
  const transpilar = new Bun.Transpiler({ loader: "ts" });
  const vazia = (): Direcao => ({ svg: o.svgRel, mudancas: [], notas: [] });
  const lerDirecao = (): Direcao => (existsSync(o.direcaoAbs) ? { ...vazia(), ...(JSON.parse(readFileSync(o.direcaoAbs, "utf8")) as Direcao) } : vazia());
  const semCache = { "cache-control": "no-store" };
  const arquivo = (nome: string, tipo: string) => new Response(readFileSync(path.join(aqui, nome)), { headers: { "content-type": tipo, ...semCache } });

  const servidor = Bun.serve({
    hostname: "127.0.0.1",
    port: o.porta,
    async fetch(req) {
      const host = `127.0.0.1:${servidor.port}`;
      // O Host vem do cliente: com DNS rebinding, é o nome do outro site. Só serve quem chamou pelo 127.0.0.1.
      if (req.headers.get("host") !== host) return new Response("host errado", { status: 403 });
      const url = new URL(req.url);
      if (req.method === "GET" && url.pathname === "/") return arquivo("index.html", "text/html; charset=utf-8");
      if (req.method === "GET" && url.pathname === "/diretor.js") return arquivo("diretor.js", "text/javascript; charset=utf-8");
      if (req.method === "GET" && url.pathname === "/animacao.js") {
        return new Response(transpilar.transformSync(readFileSync(path.join(aqui, "animacao.ts"), "utf8")), {
          headers: { "content-type": "text/javascript; charset=utf-8", ...semCache },
        });
      }
      if (req.method === "GET" && url.pathname === "/api/estado") {
        return Response.json({ svg: readFileSync(o.svgAbs, "utf8"), direcao: lerDirecao() }, { headers: semCache });
      }
      if (req.method === "PUT" && url.pathname === "/api/direcao") {
        // Só a própria página grava, comparando com o endereço fixo (e não com o que veio no pedido).
        if (req.headers.get("origin") !== `http://${host}`) return new Response("origem errada", { status: 403 });
        try {
          const d = validar(await req.json(), o.svgRel);
          writeFileSync(o.direcaoAbs, `${JSON.stringify(d, null, 2)}\n`);
          return Response.json({ ok: true, arquivo: path.relative(raiz, o.direcaoAbs) });
        } catch (e) {
          return new Response(String((e as Error).message), { status: 400 });
        }
      }
      return new Response("não achei", { status: 404 });
    },
  });
  return servidor;
}

if (import.meta.main) {
  const arg = (nome: string, padrao: string) => {
    const i = process.argv.indexOf(nome);
    return i > 0 && process.argv[i + 1] ? process.argv[i + 1]! : padrao;
  };
  const svgRel = arg("--svg", "docs/brand/kiwi-cat-familia/kiwi-cat-1-aura-intro.svg");
  const svgAbs = path.resolve(raiz, svgRel);
  if (!svgAbs.startsWith(raiz + path.sep) || !existsSync(svgAbs)) throw new Error(`diretor: não achei ${svgRel} no repo`);
  const direcaoAbs = path.join(path.dirname(svgAbs), "direcao.json");
  const servidor = criarServidor({ svgAbs, svgRel: path.relative(raiz, svgAbs), direcaoAbs, porta: Number(arg("--porta", "4790")) });
  console.log(`Diretor do Kiwi-cat: http://127.0.0.1:${servidor.port}/`);
  console.log(`  SVG:     ${path.relative(raiz, svgAbs)}`);
  console.log(`  Direção: ${path.relative(raiz, direcaoAbs)} (o Salvar grava aqui)`);
  console.log("Ctrl-C para parar.");
}
