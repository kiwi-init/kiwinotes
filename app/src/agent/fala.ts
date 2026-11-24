/**
 * O texto para a fala do gato (spec #26687, T26709): o que o agente mandou pelo `kiwi falar` vira palavras que a voz lê
 * bem em pt-BR. Números, datas, horas, dinheiro, porcentagens, siglas e símbolos viram palavras; Markdown, links,
 * código, emoji e o raciocínio do agente saem. Depois, o texto é cortado por frase, para a voz começar antes do fim.
 * Funções puras, sem nada do Mac.
 */

const UNIDADES = ["zero", "um", "dois", "três", "quatro", "cinco", "seis", "sete", "oito", "nove", "dez", "onze", "doze", "treze", "catorze", "quinze", "dezesseis", "dezessete", "dezoito", "dezenove"];
const DEZENAS = ["", "", "vinte", "trinta", "quarenta", "cinquenta", "sessenta", "setenta", "oitenta", "noventa"];
const CENTENAS = ["", "cento", "duzentos", "trezentos", "quatrocentos", "quinhentos", "seiscentos", "setecentos", "oitocentos", "novecentos"];

/** O feminino de um número falado: "uma", "duas", "duzentas". */
const feminino = (s: string) => s.replace(/\bum\b/g, "uma").replace(/\bdois\b/g, "duas").replace(/entos\b/g, "entas");

/** De 1 a 999. */
function ate999(n: number): string {
  if (n === 100) return "cem";
  const c = Math.floor(n / 100);
  const r = n % 100;
  const partes: string[] = [];
  if (c) partes.push(CENTENAS[c]!);
  if (r) partes.push(r < 20 ? UNIDADES[r]! : DEZENAS[Math.floor(r / 10)]! + (r % 10 ? ` e ${UNIDADES[r % 10]}` : ""));
  return partes.join(" e ");
}

const GRUPOS: [number, string, string][] = [
  [1e9, "bilhão", "bilhões"],
  [1e6, "milhão", "milhões"],
];

/**
 * Um inteiro por extenso, de 0 a 999.999.999.999 ("mil duzentos e trinta e quatro", "dois milhões e cem"). Com
 * `fem`, no feminino ("duas horas", "duzentas pessoas"): os milhões e bilhões ficam no masculino, como se fala.
 */
export function porExtenso(n: number, fem = false): string {
  if (!Number.isInteger(n) || n < 0 || n >= 1e12) throw new RangeError(`porExtenso: ${n}`);
  if (n === 0) return "zero";
  const partes: { texto: string; valor: number }[] = [];
  let resto = n;
  for (const [base, um, varios] of GRUPOS) {
    const q = Math.floor(resto / base);
    if (q) partes.push({ texto: `${ate999(q)} ${q === 1 ? um : varios}`, valor: q * base });
    resto %= base;
  }
  const mil = Math.floor(resto / 1000);
  if (mil) partes.push({ texto: mil === 1 ? "mil" : `${fem ? feminino(ate999(mil)) : ate999(mil)} mil`, valor: mil * 1000 });
  const baixo = resto % 1000;
  if (baixo) partes.push({ texto: fem ? feminino(ate999(baixo)) : ate999(baixo), valor: baixo });
  // O "e" antes da última parte quando ela é pequena ou redonda: "mil e cinco", "mil e duzentos", mas "mil duzentos e um".
  return partes
    .map((p, i) => (i > 0 && i === partes.length - 1 && (p.valor < 100 || p.valor % 100 === 0) ? `e ${p.texto}` : p.texto))
    .join(" ");
}

/** Dígito por dígito, para um número longo demais para ler inteiro (um telefone, um código). */
const digitos = (s: string) => [...s.replace(/\D/g, "")].map((d) => UNIDADES[Number(d)]).join(" ");

/** Um número escrito ("1.234", "3,5", "42") por extenso; os de mais de 12 dígitos, dígito por dígito. */
function numero(escrito: string, fem = false): string {
  const [inteiro = "", decimal] = escrito.split(",");
  const limpo = inteiro.replace(/\./g, "");
  if (limpo.length > 12 || (limpo.length > 1 && limpo.startsWith("0"))) return digitos(escrito);
  const base = porExtenso(Number(limpo), fem);
  if (decimal === undefined) return base;
  // "3,50" é "três vírgula cinquenta"; "3,05", "três vírgula zero cinco".
  const zeros = /^0+/.exec(decimal)?.[0].length ?? 0;
  const resto = decimal.slice(zeros);
  const dec = [...Array(zeros).fill("zero"), ...(resto ? [resto.length > 3 ? digitos(resto) : porExtenso(Number(resto))] : [])].join(" ");
  return `${base} vírgula ${dec}`;
}

/** "de reais" depois de um milhão redondo ("um milhão de reais"), como se fala. */
const comDe = (s: string) => (/(milhão|milhões|bilhão|bilhões)$/.test(s) ? `${s} de` : s);

function dinheiro(inteiro: string, centavos: string | undefined): string {
  const n = Number(inteiro.replace(/\./g, ""));
  const c = centavos ? Number(centavos.padEnd(2, "0").slice(0, 2)) : 0;
  const reais = n ? `${comDe(porExtenso(n))} ${n === 1 ? "real" : "reais"}` : "";
  const cents = c ? `${porExtenso(c)} ${c === 1 ? "centavo" : "centavos"}` : "";
  if (reais && cents) return `${reais} e ${cents}`;
  return reais || cents || "zero reais";
}

const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

function data(dia: number, mes: number, ano?: number): string | null {
  if (dia < 1 || dia > 31 || mes < 1 || mes > 12) return null;
  const d = dia === 1 ? "primeiro" : porExtenso(dia);
  return `${d} de ${MESES[mes - 1]}${ano !== undefined ? ` de ${porExtenso(ano)}` : ""}`;
}

function hora(h: number, m: number): string | null {
  if (h > 23 || m > 59) return null;
  const hs = h === 0 ? "meia-noite" : h === 12 && m === 0 ? "meio-dia" : feminino(porExtenso(h));
  if (m === 0) return h === 0 || h === 12 ? hs : `${hs} ${h === 1 ? "hora" : "horas"}`;
  return `${hs} e ${porExtenso(m)}`;
}

/** As unidades que se falam por extenso depois de um número: o singular e o plural. */
const UNIDADES_MEDIDA: Record<string, [string, string]> = {
  km: ["quilômetro", "quilômetros"],
  kg: ["quilo", "quilos"],
  cm: ["centímetro", "centímetros"],
  mm: ["milímetro", "milímetros"],
  ml: ["mililitro", "mililitros"],
  KB: ["quilobyte", "quilobytes"],
  MB: ["megabyte", "megabytes"],
  GB: ["gigabyte", "gigabytes"],
  TB: ["terabyte", "terabytes"],
  min: ["minuto", "minutos"],
};

const ORDINAIS_M = ["", "primeiro", "segundo", "terceiro", "quarto", "quinto", "sexto", "sétimo", "oitavo", "nono", "décimo"];

/** As letras como se falam, para as siglas soletradas ("PDF" é "pê dê efe"). */
const LETRAS: Record<string, string> = {
  A: "a", B: "bê", C: "cê", D: "dê", E: "é", F: "efe", G: "gê", H: "agá", I: "i", J: "jota", K: "cá", L: "ele", M: "eme",
  N: "ene", O: "ó", P: "pê", Q: "quê", R: "erre", S: "esse", T: "tê", U: "u", V: "vê", W: "dáblio", X: "xis", Y: "ípsilon", Z: "zê",
};
/** As siglas que se leem como palavra, não letra por letra. */
const SIGLAS_PALAVRA = new Set(["ONU", "OTAN", "UNESCO", "FIFA", "NASA", "PIX", "CEP", "INSS", "OK"]);
const SIGLA_LIDA: Record<string, string> = { OK: "ok", PIX: "pix", CEP: "cep", INSS: "inss" };

/** As abreviações comuns, por extenso. */
const ABREVIACOES: [RegExp, string][] = [
  [/\bSr\.(?=\s)/g, "senhor"],
  [/\bSra\.(?=\s)/g, "senhora"],
  [/\bDr\.(?=\s)/g, "doutor"],
  [/\bDra\.(?=\s)/g, "doutora"],
  [/\bProf\.(?=\s)/g, "professor"],
  [/\bProfa\.(?=\s)/g, "professora"],
  [/\betc\./g, "etcétera."],
  [/\bex\.:?/gi, "por exemplo"],
  [/\bp\. ?ex\./gi, "por exemplo"],
  [/\bnº\s?/gi, "número "],
  [/\bn\.º\s?/gi, "número "],
];

/** Tira o que nunca é falado: o raciocínio, o código, o Markdown, os links e os emoji. */
export function semMarkdown(texto: string): string {
  return (
    texto
      .replace(/\r\n?/g, "\n")
      // O raciocínio e as chamadas que um agente às vezes deixa no texto.
      .replace(/<(thinking|think|reasoning|tool_call|function_calls)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
      .replace(/<\/?[a-z][^>\n]*>/gi, " ")
      // O código: o bloco inteiro e o trecho entre crases.
      .replace(/```[\s\S]*?(```|$)/g, " ")
      .replace(/~~~[\s\S]*?(~~~|$)/g, " ")
      .replace(/`[^`\n]*`/g, " ")
      // As imagens saem; o link fica só com o texto.
      .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
      .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, "$2")
      .replace(/\[\[([^\]]+)\]\]/g, (_, nota: string) => nota.replace(/\.md$/i, "").split("/").pop()!)
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
      .replace(/<?\bhttps?:\/\/[^\s>)]+>?/gi, " ")
      .replace(/\bwww\.[^\s)]+/gi, " ")
      // As marcas de linha: títulos, citações, listas, tabelas e réguas.
      .replace(/^[ \t]*#{1,6}[ \t]+(.*)$/gm, "$1.")
      .replace(/^[ \t]*>[ \t]?/gm, "")
      .replace(/^[ \t]*(?:[-*+]|\d+[.)])[ \t]+\[[ xX]\][ \t]+/gm, "")
      .replace(/^[ \t]*[-*+][ \t]+/gm, "")
      .replace(/^[ \t]*\d+[.)][ \t]+/gm, "")
      .replace(/^[ \t]*\|?[ \t]*:?-{3,}:?[ \t]*(\|[ \t]*:?-{3,}:?[ \t]*)*\|?[ \t]*$/gm, "")
      .replace(/^[ \t]*([-*_])([ \t]*\1){2,}[ \t]*$/gm, "")
      // Uma linha de tabela: as células, separadas por vírgula, sem as barras das pontas.
      .replace(/^[ \t]*\|?(.*\|.*?)\|?[ \t]*$/gm, (_, linha: string) => linha.split("|").map((c) => c.trim()).filter(Boolean).join(", "))
      // A ênfase: o texto fica, as marcas saem.
      .replace(/(\*\*|__)(.+?)\1/g, "$2")
      .replace(/(^|[^\p{L}\p{N}])[*_](?=\S)(.+?)(?<=\S)[*_](?=[^\p{L}\p{N}]|$)/gu, "$1$2")
      .replace(/~~(.+?)~~/g, "$1")
      .replace(/==(.+?)==/g, "$1")
      // Os emoji e os pictogramas.
      .replace(/[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}\u{FE0F}\u{200D}\u{20E3}]/gu, "")
  );
}

/**
 * O texto que a voz lê: sem Markdown, e com números, datas, horas, dinheiro, porcentagens, siglas e símbolos por
 * extenso em pt-BR. Linhas viram frases.
 */
export function textoParaFala(texto: string): string {
  let t = semMarkdown(texto);
  // Cada linha que não fecha uma frase fecha aqui: um item de lista é uma frase.
  t = t
    .split(/\n+/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => (/[.!?…:;,]$/.test(l) ? l : `${l}.`))
    .join(" ");
  for (const [re, por] of ABREVIACOES) t = t.replace(re, por);

  const N = String.raw`\d{1,3}(?:\.\d{3})+|\d+`;
  // Dinheiro: "R$ 1.234,50", "R$12", "US$ 30".
  t = t.replace(new RegExp(String.raw`(-)?R\$\s?(${N})(?:,(\d{1,2}))?`, "g"), (_, menos: string | undefined, i: string, c?: string) => `${menos ? "menos " : ""}${dinheiro(i, c)}`);
  t = t.replace(new RegExp(String.raw`US\$\s?(${N})(?:,(\d{1,2}))?`, "g"), (_, i: string, c?: string) => {
    const n = Number(i.replace(/\./g, ""));
    const cents = c ? Number(c.padEnd(2, "0")) : 0;
    return `${comDe(porExtenso(n))} ${n === 1 ? "dólar" : "dólares"}${cents ? ` e ${porExtenso(cents)} ${cents === 1 ? "centavo" : "centavos"}` : ""}`;
  });
  // Datas: "24/11/2026", "2026-11-24", "24/11".
  t = t.replace(/\b(\d{4})-(\d{2})-(\d{2})\b/g, (m, a: string, me: string, d: string) => data(Number(d), Number(me), Number(a)) ?? m);
  t = t.replace(/\b(\d{1,2})\/(\d{1,2})\/(\d{4}|\d{2})\b/g, (m, d: string, me: string, a: string) => data(Number(d), Number(me), a.length === 2 ? 2000 + Number(a) : Number(a)) ?? m);
  t = t.replace(/\b(\d{1,2})\/(\d{1,2})\b(?!\/)/g, (m, d: string, me: string) => data(Number(d), Number(me)) ?? m);
  // Horas: "14:30", "14h30", "9h", "9 h".
  t = t.replace(/\b(\d{1,2}):(\d{2})(?::\d{2})?\b/g, (m, h: string, mi: string) => hora(Number(h), Number(mi)) ?? m);
  t = t.replace(/\b(\d{1,2}) ?h ?(\d{2})(?:min)?\b/g, (m, h: string, mi: string) => hora(Number(h), Number(mi)) ?? m);
  t = t.replace(/\b(\d{1,2}) ?h\b/g, (m, h: string) => hora(Number(h), 0) ?? m);
  // Intervalos: "10-20", "9h–11h" já virou palavras; "2 a 3".
  t = t.replace(/(\d)\s?[-–]\s?(?=\d)/g, "$1 a ");
  // Porcentagem e graus.
  t = t.replace(new RegExp(String.raw`(-)?(${N}(?:,\d+)?) ?%`, "g"), (_, menos: string | undefined, n: string) => `${menos ? "menos " : ""}${numero(n)} por cento`);
  t = t.replace(new RegExp(String.raw`(-)?(${N}(?:,\d+)?) ?°C\b`, "g"), (_, menos: string | undefined, n: string) => `${menos ? "menos " : ""}${numero(n)} ${n === "1" ? "grau" : "graus"}`);
  t = t.replace(new RegExp(String.raw`(${N}(?:,\d+)?) ?°`, "g"), (_, n: string) => `${numero(n)} ${n === "1" ? "grau" : "graus"}`);
  // As unidades comuns depois de um número: "3 km", "2,5 GB", "40 min".
  t = t.replace(new RegExp(String.raw`(${N}(?:,\d+)?) ?(${Object.keys(UNIDADES_MEDIDA).join("|")})(?![\p{L}\d])`, "gu"), (_, n: string, u: string) => {
    const [um, varios] = UNIDADES_MEDIDA[u]!;
    return `${numero(n)} ${n === "1" ? um : varios}`;
  });
  // Ordinais: "1º", "2ª", "3o lugar" não (só com o sinal).
  t = t.replace(/\b(\d{1,2})([ºª])/g, (m, n: string, s: string) => {
    const i = Number(n);
    const o = ORDINAIS_M[i];
    if (!o) return m;
    return s === "ª" ? o.replace(/o$/, "a") : o;
  });
  // Os símbolos que se falam.
  t = t
    .replace(/\s&\s/g, " e ")
    .replace(/\s\+\s/g, " mais ")
    .replace(/\s=\s/g, " igual a ")
    .replace(/\s(?:->|→)\s/g, " para ")
    .replace(/\s(?:<-|←)\s/g, " de ")
    .replace(/\be\/ou\b/g, "e ou")
    .replace(/([\p{L}\d.]+)@([\p{L}\d-]+(?:\.[\p{L}\d-]+)+)/gu, (_, u: string, d: string) => `${u} arroba ${d.replace(/\./g, " ponto ")}`)
    .replace(/(^|\s)#(\d+)\b/g, "$1número $2")
    .replace(/\s[x×]\s(?=\d)/g, " vezes ");
  // Os números que sobraram: "-3", "1.234", "3,5".
  t = t.replace(new RegExp(String.raw`(^|[^\p{L}\d])(-(?=\d))?(${N})(,\d+)?(?![\p{L}\d])`, "gu"), (_, antes: string, menos: string | undefined, i: string, d?: string) => `${antes}${menos ? "menos " : ""}${numero(i + (d ?? ""))}`);
  // Um número colado a letras ("3D", "mp3") fica dígito por dígito, separado.
  t = t.replace(/\d+/g, (d) => ` ${d.length > 3 ? digitos(d) : porExtenso(Number(d))} `);
  // Siglas: duas a cinco maiúsculas soltas viram letras ("PDF"); as que se leem como palavra ficam.
  t = t.replace(/(?<![\p{L}\d])[A-Z]{2,5}s?(?![\p{L}\d])/gu, (s) => {
    const plural = s.length > 2 && s.endsWith("s") && /^[A-Z]+s$/.test(s);
    const base = plural ? s.slice(0, -1) : s;
    if (SIGLAS_PALAVRA.has(base)) return (SIGLA_LIDA[base] ?? base) + (plural ? "s" : "");
    return [...base].map((l) => LETRAS[l] ?? l).join(" ") + (plural ? "s" : "");
  });
  // O que sobrou de símbolo solto sai; os espaços se ajeitam.
  return t
    .replace(/[*_~^`|<>{}[\]\\#]/g, " ")
    .replace(/\s+([,.!?;:…])/g, "$1")
    .replace(/([,.!?;:])(?=[^\s\d.,!?;:…)"'»”])/g, "$1 ")
    .replace(/,(\s*,)+/g, ",")
    .replace(/\.{2,}/g, (m) => (m.length >= 3 ? "…" : "."))
    .replace(/([.!?…])\s*[.,;:]+/g, "$1")
    .replace(/\s{2,}/g, " ")
    .trim()
    .replace(/^[,.;:\s]+/, "");
}

/** O tamanho em que uma frase longa demais se corta numa vírgula ou num ponto e vírgula, para a voz não esperar. */
export const FRASE_MAX = 220;

/** Corta um texto já falável em frases, na ordem. Uma frase longa demais se corta onde houver pausa. */
export function cortarFrases(falavel: string): string[] {
  const frases = falavel
    .split(/(?<=[.!?…])\s+(?=[^\s])/u)
    .map((f) => f.trim())
    .filter((f) => /[\p{L}\d]/u.test(f));
  const out: string[] = [];
  for (const f of frases) {
    if (f.length <= FRASE_MAX) {
      out.push(f);
      continue;
    }
    let atual = "";
    for (const pedaco of f.split(/(?<=[;:,])\s+/)) {
      if (atual && atual.length + pedaco.length + 1 > FRASE_MAX) {
        out.push(atual);
        atual = pedaco;
      } else atual = atual ? `${atual} ${pedaco}` : pedaco;
    }
    if (atual) out.push(atual);
  }
  return out;
}

/** O que a voz recebe: as frases do texto, já por extenso, na ordem. Vazio quando não sobra nada para falar. */
export const frasesParaFala = (texto: string): string[] => cortarFrases(textoParaFala(texto));
