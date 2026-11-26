/**
 * A fala do gato em inglês (T31029, harry #31028): números, datas, horas, dinheiro, porcentagens, unidades, ordinais,
 * siglas e símbolos de uma frase inglesa viram palavras em inglês, como o `fala.ts` faz no pt-BR. Recebe o texto já
 * sem Markdown e com as linhas viradas frases; a limpeza final é a do `fala.ts`. Funções puras, sem nada do Mac.
 */

const ONES = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];

/** De 1 a 99, com hífen: "twenty-one". */
function upTo99(n: number): string {
  if (n < 20) return ONES[n]!;
  return TENS[Math.floor(n / 10)]! + (n % 10 ? `-${ONES[n % 10]}` : "");
}

/** De 1 a 999: "one hundred five", "two hundred thirty-four" (o inglês americano, sem "and"). */
function upTo999(n: number): string {
  const h = Math.floor(n / 100);
  const r = n % 100;
  return [h ? `${ONES[h]} hundred` : "", r ? upTo99(r) : ""].filter(Boolean).join(" ");
}

const SCALES: [number, string][] = [
  [1e9, "billion"],
  [1e6, "million"],
  [1e3, "thousand"],
];

/** Um inteiro por extenso em inglês, de 0 a 999,999,999,999. */
export function numberWords(n: number): string {
  if (!Number.isInteger(n) || n < 0 || n >= 1e12) throw new RangeError(`numberWords: ${n}`);
  if (n === 0) return "zero";
  const parts: string[] = [];
  let rest = n;
  for (const [base, name] of SCALES) {
    const q = Math.floor(rest / base);
    if (q) parts.push(`${upTo999(q)} ${name}`);
    rest %= base;
  }
  if (rest) parts.push(upTo999(rest));
  return parts.join(" ");
}

const ORDINAL_END: Record<string, string> = { one: "first", two: "second", three: "third", five: "fifth", eight: "eighth", nine: "ninth", twelve: "twelfth" };

/** O ordinal por extenso: "first", "twenty-fourth", "one hundredth". */
export function ordinalWords(n: number): string {
  const words = numberWords(n);
  return words.replace(/[a-z]+$/, (last) => ORDINAL_END[last] ?? (last.endsWith("y") ? `${last.slice(0, -1)}ieth` : `${last}th`));
}

/** Um ano como se fala: "twenty twenty-six", "two thousand five", "nineteen oh five", "nineteen hundred". */
export function yearWords(y: number): string {
  if (y < 1100 || y > 2099 || (y >= 2000 && y < 2010)) return numberWords(y);
  const hi = Math.floor(y / 100);
  const lo = y % 100;
  if (lo === 0) return `${upTo99(hi)} hundred`;
  return `${upTo99(hi)} ${lo < 10 ? `oh ${ONES[lo]}` : upTo99(lo)}`;
}

/** Dígito por dígito, para um número longo demais (um telefone, um código). */
const digits = (s: string) => [...s.replace(/\D/g, "")].map((d) => ONES[Number(d)]).join(" ");

/** Um número escrito em inglês ("1,234", "3.5", "42"); o decimal se lê dígito por dígito ("three point zero five"). */
function number(written: string): string {
  const [int = "", dec] = written.split(".");
  const clean = int.replace(/,/g, "");
  if (clean.length > 12 || (clean.length > 1 && clean.startsWith("0"))) return digits(written);
  const base = numberWords(Number(clean));
  return dec === undefined ? base : `${base} point ${digits(dec)}`;
}

/** O inteiro com milhar por vírgula ("1,234") ou sem nada ("1234"). */
const N = String.raw`\d{1,3}(?:,\d{3})+|\d+`;

const CURRENCY: Record<string, [string, string]> = {
  "US$": ["dollar", "dollars"],
  $: ["dollar", "dollars"],
  "R$": ["real", "reais"],
  "€": ["euro", "euros"],
  "£": ["pound", "pounds"],
};

function money(symbol: string, int: string, cents: string | undefined, scale: string | undefined): string {
  const [one, many] = CURRENCY[symbol]!;
  if (scale) return `${number(`${int}${cents ? `.${cents}` : ""}`)} ${scale} ${many}`;
  const clean = int.replace(/,/g, "");
  // Longo demais para ler inteiro: dígito por dígito, e a moeda depois (harry não perde a fala por um valor enorme).
  if (clean.length > 12) return `${number(int)} ${many}`;
  const n = Number(clean);
  const c = cents ? Number(cents.padEnd(2, "0").slice(0, 2)) : 0;
  const whole = n ? `${numberWords(n)} ${n === 1 ? one : many}` : "";
  const sub = c ? `${numberWords(c)} ${c === 1 ? "cent" : "cents"}` : "";
  if (whole && sub) return `${whole} and ${sub}`;
  return whole || sub || `zero ${many}`;
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function date(month: number, day: number, year?: number): string | null {
  if (day < 1 || day > 31 || month < 1 || month > 12) return null;
  return `${MONTHS[month - 1]} ${ordinalWords(day)}${year !== undefined ? `, ${yearWords(year)}` : ""}`;
}

/** "11/24/2026" é o mês antes (como nos EUA); "24/11/2026", com o primeiro acima de 12, é o dia antes. */
function slashDate(a: number, b: number, year?: number): string | null {
  return a > 12 ? date(b, a, year) : date(a, b, year);
}

const DENOMINATORS: Record<number, [string, string]> = { 2: ["half", "halves"], 3: ["third", "thirds"], 4: ["quarter", "quarters"] };

/** "one half", "two thirds", "three quarters". */
function fraction(a: number, b: number): string {
  const [one, many] = DENOMINATORS[b]!;
  return `${ONES[a]} ${a === 1 ? one : many}`;
}

/** A hora em 12 horas, como se fala: "two thirty PM", "nine oh five", "noon", "midnight", "nine o'clock". */
function time(h: number, m: number, ampm?: string): string | null {
  if (h > 23 || m > 59 || (ampm && (h < 1 || h > 12))) return null;
  if (!ampm && m === 0 && h === 0) return "midnight";
  if (!ampm && m === 0 && h === 12) return "noon";
  const suffix = ampm ? ampm.toUpperCase() : h > 12 ? "PM" : h === 0 ? "AM" : "";
  const h12 = h > 12 ? h - 12 : h === 0 ? 12 : h;
  const mins = m === 0 ? (suffix ? "" : "o'clock") : m < 10 ? `oh ${ONES[m]}` : upTo99(m);
  return [numberWords(h12), mins, suffix].filter(Boolean).join(" ");
}

const UNITS: Record<string, [string, string]> = {
  km: ["kilometer", "kilometers"],
  kg: ["kilogram", "kilograms"],
  cm: ["centimeter", "centimeters"],
  mm: ["millimeter", "millimeters"],
  ml: ["milliliter", "milliliters"],
  mi: ["mile", "miles"],
  lb: ["pound", "pounds"],
  lbs: ["pound", "pounds"],
  KB: ["kilobyte", "kilobytes"],
  MB: ["megabyte", "megabytes"],
  GB: ["gigabyte", "gigabytes"],
  TB: ["terabyte", "terabytes"],
  ms: ["millisecond", "milliseconds"],
  min: ["minute", "minutes"],
  h: ["hour", "hours"],
};

const ABBREVIATIONS: [RegExp, string][] = [
  [/\bMr\.(?=\s)/g, "mister"],
  [/\bMrs\.(?=\s)/g, "missus"],
  [/\bMs\.(?=\s)/g, "miz"],
  [/\bDr\.(?=\s)/g, "doctor"],
  [/\bProf\.(?=\s)/g, "professor"],
  [/\be\.g\.,?/gi, "for example"],
  [/\bi\.e\.,?/gi, "that is"],
  [/\betc\./g, "et cetera."],
  [/\bvs\.?(?=\s)/g, "versus"],
  [/\b[Nn]o\.\s?(?=\d)/g, "number "],
];

/** As siglas que se leem como palavra, não letra por letra. */
const WORD_ACRONYMS: Record<string, string> = { NASA: "NASA", NATO: "NATO", UNESCO: "UNESCO", UNICEF: "UNICEF", FIFA: "FIFA", OK: "okay", PIN: "pin", GIF: "gif", JPEG: "jay peg" };

/** Uma frase inglesa (já sem Markdown) com tudo o que é número, data, hora, sigla e símbolo por extenso. */
export function convertEnglish(input: string): string {
  let t = input;
  for (const [re, by] of ABBREVIATIONS) t = t.replace(re, by);
  // Uma versão ou um IP ("2026.11.13", "192.168.0.1"): "dot" entre as partes, antes do decimal.
  t = t.replace(/(?<![\d.,])\d+(?:\.\d+){2,}(?!\d|,\d)/g, (m) => m.split(".").join(" dot "));

  // Dinheiro: "$1,250.50", "US$ 30", "R$ 12", "€5", "$2 million", "-$3".
  t = t.replace(
    new RegExp(String.raw`(-)?(US\$|R\$|\$|€|£)\s?(${N})(?:\.(\d{1,2}))?(?:\s?(million|billion|thousand)\b)?`, "g"),
    (_, minus: string | undefined, sym: string, i: string, c: string | undefined, scale: string | undefined) => `${minus ? "minus " : ""}${money(sym, i, c, scale)}`,
  );
  // Datas: "2026-11-24", "11/24/2026", "11/24", "Nov 24, 2026", "November 24th".
  t = t.replace(/\b(\d{4})-(\d{2})-(\d{2})\b/g, (m, y: string, mo: string, d: string) => date(Number(mo), Number(d), Number(y)) ?? m);
  t = t.replace(/\b(\d{1,2})\/(\d{1,2})\/(\d{4}|\d{2})\b/g, (m, a: string, b: string, y: string) => slashDate(Number(a), Number(b), y.length === 2 ? 2000 + Number(y) : Number(y)) ?? m);
  // A fração simples ("1/2 cup", "3/4") antes da data sem ano: em inglês, é mais comum que o "January second".
  t = t.replace(/(?<![\d/])([1-3])\/([2-4])(?![\d/])/g, (m, a: string, b: string) => (Number(a) < Number(b) ? fraction(Number(a), Number(b)) : m));
  t = t.replace(/\b(\d{1,2})\/(\d{1,2})\b(?!\/)/g, (m, a: string, b: string) => slashDate(Number(a), Number(b)) ?? m);
  const monthRe = MONTHS.map((mo) => `${mo.slice(0, 3)}(?:${mo.slice(3)}|\\.)?`).join("|");
  t = t.replace(new RegExp(String.raw`\b(${monthRe})\s(\d{1,2})(?:st|nd|rd|th)?\b(?:,?\s(\d{4})\b)?`, "g"), (m, mo: string, d: string, y: string | undefined) => {
    const month = MONTHS.findIndex((x) => x.startsWith(mo.slice(0, 3))) + 1;
    return date(month, Number(d), y ? Number(y) : undefined) ?? m;
  });
  // Horas: "2:30 PM", "14:30", "9am", "9 p.m.". O ponto do "p.m." só sai no meio da frase; no fim, ele a fecha.
  t = t.replace(/\b(\d{1,2}):(\d{2})(?::\d{2})?(?:\s?([AaPp])\.?[Mm]\b(?:\.(?=\s+\p{Ll}))?)?/gu, (m, h: string, mi: string, ap: string | undefined) => time(Number(h), Number(mi), ap ? `${ap}M` : undefined) ?? m);
  t = t.replace(/\b(\d{1,2})\s?([AaPp])\.?[Mm]\b(?:\.(?=\s+\p{Ll}))?/gu, (m, h: string, ap: string) => time(Number(h), 0, `${ap}M`) ?? m);
  // O ano depois de uma preposição: "in 2025", "since 1999".
  t = t.replace(/\b(in|since|from|until|by|of|before|after|year)\s(1[1-9]\d\d|20\d\d)\b(?![.,]\d)/gi, (_, w: string, y: string) => `${w} ${yearWords(Number(y))}`);
  // Intervalos: "10-20" é "ten to twenty".
  t = t.replace(/(\d)\s?[-–]\s?(?=\d)/g, "$1 to ");
  // Porcentagem, graus e unidades.
  t = t.replace(new RegExp(String.raw`(-)?(${N}(?:\.\d+)?) ?%`, "g"), (_, minus: string | undefined, n: string) => `${minus ? "minus " : ""}${number(n)} percent`);
  t = t.replace(new RegExp(String.raw`(-)?(${N}(?:\.\d+)?) ?°([CF])?\b`, "g"), (_, minus: string | undefined, n: string, scale: string | undefined) =>
    `${minus ? "minus " : ""}${number(n)} ${n === "1" ? "degree" : "degrees"}${scale === "C" ? " Celsius" : scale === "F" ? " Fahrenheit" : ""}`,
  );
  t = t.replace(new RegExp(String.raw`(${N}(?:\.\d+)?) ?(${Object.keys(UNITS).join("|")})(?![\p{L}\d])`, "gu"), (_, n: string, u: string) => {
    const [one, many] = UNITS[u]!;
    return `${number(n)} ${n === "1" ? one : many}`;
  });
  // Ordinais: "1st", "22nd", "3rd", "4th".
  t = t.replace(/\b(\d{1,4})(?:st|nd|rd|th)\b/g, (_, n: string) => ordinalWords(Number(n)));
  // Os símbolos que se falam.
  t = t
    .replace(/\s&\s/g, " and ")
    .replace(/\s\+\s/g, " plus ")
    .replace(/\s=\s/g, " equals ")
    .replace(/\s(?:->|→)\s/g, " to ")
    .replace(/\s(?:<-|←)\s/g, " from ")
    .replace(/\band\/or\b/g, "and or")
    .replace(/([\p{L}\d.]+)@([\p{L}\d-]+(?:\.[\p{L}\d-]+)+)/gu, (_, u: string, d: string) => `${u} at ${d.replace(/\./g, " dot ")}`)
    .replace(/(^|\s)#(\d+)\b/g, "$1number $2")
    .replace(/\s[x×]\s(?=\d)/g, " times ");
  // Os números que sobraram: "-3", "1,234", "3.5".
  t = t.replace(new RegExp(String.raw`(^|[^\p{L}\d])(-(?=\d))?(${N})(\.\d+)?(?![\p{L}\d])`, "gu"), (_, before: string, minus: string | undefined, i: string, d: string | undefined) =>
    `${before}${minus ? "minus " : ""}${number(i + (d ?? ""))}`,
  );
  // Um número colado a letras ("3D", "mp3") fica separado, por extenso.
  t = t.replace(/\d+/g, (d) => ` ${d.length > 3 ? digits(d) : numberWords(Number(d))} `);
  // Maiúsculas soltas: a sigla de até 3 letras ou sem vogal ("PDF", "HTML", "AI", "PM") vai letra por letra; a que se
  // lê como palavra fica; o resto é palavra em ênfase ("TODAY") e se lê em minúsculas.
  return t.replace(/(?<![\p{L}\d])\p{Lu}{2,}s?(?![\p{L}\d'’])/gu, (s) => {
    const plural = s.length > 2 && /^\p{Lu}+s$/u.test(s);
    const base = plural ? s.slice(0, -1) : s;
    const end = plural ? "s" : "";
    if (WORD_ACRONYMS[base]) return WORD_ACRONYMS[base] + end;
    if (/^[A-Z]+$/.test(base) && (base.length <= 3 || !/[AEIOU]/.test(base))) return [...base].join(" ") + end;
    return base.toLowerCase() + end;
  });
}
