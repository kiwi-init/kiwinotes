// O detector de segredos do guardrail (spec #9690, T9701): olha um texto e diz, trecho por trecho, o que é segredo, o
// que é dúvida e (por exclusão) o que é limpo. É a peça que o filtro (o spec seguinte) vai usar antes de o texto ir ao
// agente; aqui ele ainda não é ligado a nada.
//
// - **Todo local e sem IA** (ADR 0011): regras fixas, que dão sempre o mesmo resultado para o mesmo texto.
// - **O trecho é só o valor:** em "senha: Kiwi#2024", o segredo é `Kiwi#2024`; o "senha:" fica, para quem lê saber que ali
//   havia uma senha. Num token pelo formato, o trecho é o token inteiro.
// - **O que ele segura** (#4717): tokens e chaves pelo formato, senhas pelo contexto (português e inglês, e as linhas de
//   configuração), e CPF e cartão válidos.
// - **O que passa de propósito:** IP, nome de máquina, VPN, CSV de trabalho, nome de unidade, nome de pessoa, e-mail,
//   telefone e endereço (#4717 e a aprovação do #9690). E, mesmo parecendo aleatório: UUID, hash em hexadecimal, UID de
//   DICOM, nomes de recurso e de bucket do Google Cloud, imagem em base64 (`data:`) e endereço sem usuário e senha.
// - **Dúvida** é o que parece segredo sem nada que confirme: uma sequência longa e aleatória solta no texto, ou um rótulo
//   de senha seguido de uma palavra comum ("senha: trocar").
// - **O desenho** aproveita o filtro de segredos das permissões do Kiwi Channels (`packages/core/src/permission.ts`,
//   lido, sem copiar código: a licença é outra): os prefixos dos tokens, o nome da chave decidindo pelo valor, as chaves
//   que não são segredo (`public_key`, `sort_key`…), os valores de liga/desliga e de tipo, e a sequência aleatória medida
//   pelas trocas entre letra e número. Lá a resposta é sim ou não; aqui cada trecho tem posição, tipo e veredito.
// - **Nunca promete 100%:** nenhum detector pega tudo.

/** O veredito de um trecho. O resto do texto é limpo. */
export type Verdict = "secret" | "doubt";

/** O tipo de um trecho seguro. */
export type SecretKind =
  | "private-key"
  | "aws"
  | "github"
  | "gitlab"
  | "anthropic"
  | "openai"
  | "stripe"
  | "slack"
  | "slack-webhook"
  | "google"
  | "npm"
  | "huggingface"
  | "pypi"
  | "jwt"
  | "bearer"
  | "basic"
  | "auth-header"
  | "url-password"
  | "url-token"
  | "config"
  | "password"
  | "cpf"
  | "card"
  | "random";

/** O nome de cada tipo, como a pessoa lê. */
export const KIND_LABELS: Record<SecretKind, string> = {
  "private-key": "chave privada",
  aws: "chave da AWS",
  github: "token do GitHub",
  gitlab: "token do GitLab",
  anthropic: "chave da Anthropic",
  openai: "chave da OpenAI",
  stripe: "chave da Stripe",
  slack: "token do Slack",
  "slack-webhook": "webhook do Slack",
  google: "chave do Google",
  npm: "token do npm",
  huggingface: "token do Hugging Face",
  pypi: "token do PyPI",
  jwt: "JWT",
  bearer: "token Bearer",
  basic: "senha do Authorization: Basic",
  "auth-header": "cabeçalho de autenticação",
  "url-password": "senha num endereço",
  "url-token": "token num endereço",
  config: "valor secreto de configuração",
  password: "senha",
  cpf: "CPF",
  card: "número de cartão",
  random: "sequência aleatória",
};

/** Um trecho seguro: onde ele está (`start` e `end`, em unidades de `string.length`), a linha (1 é a primeira), o tipo. */
export interface Finding {
  start: number;
  end: number;
  line: number;
  kind: SecretKind;
  verdict: Verdict;
}

/** O resultado de um texto: os trechos, do primeiro ao último, sem sobreposição, e o veredito do texto inteiro. */
export interface Scan {
  findings: Finding[];
  secrets: number;
  doubts: number;
  verdict: Verdict | "clean";
}

// ------------------------------------------------------------------------------------------------- as regras

/** Uma regra: a expressão (com `g` e `d`), o grupo `v` do valor quando o trecho não é o casamento inteiro. */
interface Rule {
  kind: SecretKind;
  /** Quem ganha quando dois trechos se sobrepõem: o formato (3), o contexto (2), o dado pessoal (1), a dúvida (0). */
  rank: number;
  re: RegExp;
  /** Confere o valor; devolve o veredito, ou null para descartar. Sem ela, é segredo. */
  check?: (value: string, text: string, start: number) => Verdict | null;
}

const hasDigit = (s: string) => /\d/.test(s);

/** O formato: um token que se reconhece sozinho, pelo prefixo ou pela forma. */
const FORMAT: Rule[] = [
  { kind: "private-key", rank: 3, re: /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY-----[\s\S]*?(?:-----END (?:[A-Z0-9]+ )*PRIVATE KEY-----|$)/dg },
  { kind: "aws", rank: 3, re: /(?<![A-Za-z0-9])(?:AKIA|ASIA|ABIA|ACCA)[0-9A-Z]{16}(?![A-Za-z0-9])/dg },
  { kind: "github", rank: 3, re: /(?<![A-Za-z0-9_])(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,})/dg },
  { kind: "gitlab", rank: 3, re: /(?<![A-Za-z0-9_-])glpat-[0-9A-Za-z_-]{20,}/dg },
  { kind: "anthropic", rank: 3, re: /(?<![A-Za-z0-9_-])sk-ant-[A-Za-z0-9_-]{20,}/dg },
  {
    kind: "openai",
    rank: 3,
    re: /(?<![A-Za-z0-9_-])sk-(?!ant-)(?:proj-|svcacct-|admin-)?[A-Za-z0-9_-]{20,}/dg,
    // "sk-learn-pipeline-de-exemplo" não é chave: a chave tem número e maiúscula.
    check: (v) => (hasDigit(v) && /[A-Z]/.test(v) ? "secret" : null),
  },
  { kind: "stripe", rank: 3, re: /(?<![A-Za-z0-9])(?:(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}|whsec_[A-Za-z0-9]{24,})/dg },
  { kind: "slack", rank: 3, re: /(?<![A-Za-z0-9])xox[abposr]-[A-Za-z0-9-]{10,}/dg },
  { kind: "slack-webhook", rank: 3, re: /https:\/\/hooks\.slack\.com\/(?:services|workflows|triggers)\/[A-Za-z0-9/_-]+/dg },
  { kind: "google", rank: 3, re: /(?<![A-Za-z0-9_-])(?:AIza[0-9A-Za-z_-]{35}|GOCSPX-[A-Za-z0-9_-]{20,}|ya29\.[A-Za-z0-9_-]{20,})(?![A-Za-z0-9_-])/dg },
  { kind: "npm", rank: 3, re: /(?<![A-Za-z0-9_])npm_[A-Za-z0-9]{30,}/dg },
  { kind: "huggingface", rank: 3, re: /(?<![A-Za-z0-9_])hf_[A-Za-z0-9]{30,}/dg },
  { kind: "pypi", rank: 3, re: /(?<![A-Za-z0-9_-])pypi-AgE[A-Za-z0-9_-]{20,}/dg },
  // O cabeçalho e o corpo de um JWT são JSON em base64: os dois começam com "eyJ".
  { kind: "jwt", rank: 3, re: /(?<![A-Za-z0-9_-])eyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/dg },
  {
    kind: "bearer",
    rank: 3,
    re: /\bbearer[ \t]+(?<v>[A-Za-z0-9._~+/=-]{12,})/dgi,
    // "Bearer" no meio de uma frase não é cabeçalho: o token tem número, ou vem depois de "Authorization".
    check: (v, text, start) =>
      hasDigit(v) || /authorization\s*[:=]\s*["']?\s*bearer[ \t]+$/i.test(text.slice(Math.max(0, start - 40), start)) ? "secret" : null,
  },
  { kind: "basic", rank: 3, re: /\bauthorization\s*[:=]\s*["']?basic[ \t]+(?<v>[A-Za-z0-9+/]{8,}={0,2})/dgi },
  {
    kind: "auth-header",
    rank: 3,
    re: /(?<![\w-])(?:x-api-key|api-key|x-auth-token|x-access-token|private-token|cookie|set-cookie)[ \t]*:[ \t]*(?<v>\S[^\n]*)/dgi,
    check: (v) => (placeholder(v.trim()) ? null : "secret"),
  },
  // `--password=…` e `--token …` numa linha de comando.
  {
    kind: "password",
    rank: 2,
    re: /(?<![\w-])--(?:password|passwd|pass|token|secret|api-?key|api_key|access-token|auth-token|client-secret)(?:=|[ \t]+)(?<v>[^\s-]\S*)/dgi,
    check: (v) => (placeholder(v) ? null : "secret"),
  },
  // `postgres://usuario:senha@host`: só a senha é o segredo; o usuário e o host passam.
  { kind: "url-password", rank: 3, re: /(?<![a-z0-9+.-])[a-z][a-z0-9+.-]*:\/\/[^\s/?#@:]+:(?<v>[^\s/?#@]+)@/dgi, check: (v) => (placeholder(v) ? null : "secret") },
  // `https://ghp_…@github.com`: um token no lugar do usuário.
  { kind: "url-token", rank: 3, re: /(?<![a-z0-9+.-])https?:\/\/(?<v>[^\s/?#@:]{20,})@/dgi },
  {
    kind: "url-token",
    rank: 3,
    re: /[?&](?<k>access_token|api_key|apikey|token|sig|signature|x-amz-signature|x-amz-security-token|x-amz-credential|x-goog-signature|x-goog-credential|key|code|password|secret)=(?<v>[^&\s#"'<>)]+)/dgi,
    // Um `?key=` ou `?code=` curto e sem número é parâmetro comum (`?key=valor`).
    check: (v, text, start) => {
      const k = /[?&]([\w-]+)=$/.exec(text.slice(Math.max(0, start - 30), start))?.[1]?.toLowerCase();
      return (k === "key" || k === "code") && !hasDigit(v) && v.length < 20 ? null : "secret";
    },
  },
];

// ------------------------------------------------------------------------------------------------- o contexto

/** As palavras que fazem uma chave de configuração ser segredo, já em minúsculas. */
const SECRET_WORDS = new Set(["password", "passwd", "pwd", "pass", "passphrase", "secret", "secrets", "token", "senha", "segredo", "credential", "credentials", "auth", "apikey"]);
/** `KEY` só é segredo depois de uma destas (`API_KEY`, `SECRET_KEY`, `PRIVATE_KEY`…). */
const KEY_SECRET_BEFORE = new Set(["api", "secret", "private", "access", "client", "signing", "encryption", "master", "auth", "service", "app", "account", "license", "chave"]);
/** Chaves que não são segredo, mesmo com a palavra (`public_key`, `sort_key`, `token_type`, `secret_name`…). */
const PLAIN_BEFORE_KEY = new Set(["public", "sort", "primary", "partition", "cache", "foreign", "range", "row", "unique", "composite", "routing", "idempotency", "s3", "object", "dedup", "lookup", "map", "hash"]);
const PLAIN_LAST = new Set(["type", "types", "count", "limit", "url", "uri", "endpoint", "path", "file", "dir", "name", "names", "id", "ids", "expires", "expiry", "expiration", "ttl", "length", "size", "len", "format", "header", "prefix", "field", "label", "hint", "policy", "rotation", "version", "required", "enabled", "env", "var", "ref", "arn", "location", "store", "manager"]);

/** Os pedaços de uma chave: `apiKey`, `API_KEY`, `api-key` e `api.key` dão ["api", "key"]. */
function keyWords(key: string): string[] {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/** A chave guarda um segredo? (`DB_PASSWORD`, `client_secret`, `apiKey` sim; `public_key`, `token_type`, `secret_name` não.) */
export function secretKey(key: string): boolean {
  const w = keyWords(key);
  if (!w.length || w.includes("public")) return false;
  if (PLAIN_LAST.has(w.at(-1)!) && w.length > 1) return false;
  return w.some((x, i) => {
    if (SECRET_WORDS.has(x)) return true;
    if (x === "key" || x === "keys") return i > 0 && KEY_SECRET_BEFORE.has(w[i - 1]!) && !PLAIN_BEFORE_KEY.has(w[i - 1]!);
    return false;
  });
}

const SWITCHES = new Set(["true", "false", "yes", "no", "on", "off", "none", "null", "nil", "undefined", "0", "1", "sim", "não", "nao"]);
const TYPES = new Set(["string", "number", "boolean", "str", "bytes", "int", "bool", "text", "secret", "secretstr", "optional"]);

/** Um valor que não é segredo de verdade: vazio, liga/desliga, tipo, referência a variável, exemplo mascarado. */
export function placeholder(v: string): boolean {
  const s = v.replace(/^["'`]|["'`]$/g, "").trim();
  if (!s) return true;
  const l = s.toLowerCase().replace(/[,;.]$/, "");
  if (SWITCHES.has(l) || TYPES.has(l)) return true;
  return /^(?:\$\{?[\w.:-]+\}?|%[\w]+%|<[^>]*>|\{\{[^}]*\}\}|\[[^\]]*\]|x{3,}|\*{3,}|•+|\.{3,}|…|-+|redacted|removed|omitted|hidden|example|exemplo|your[_-]?[\w-]*|sua[_-]?[\w-]*|seu[_-]?[\w-]*|(?:process\.env|os\.environ|env)\b.*|secrets?\.[\w.]+|vault:.*|arn:aws:secretsmanager:.*|projects\/[\w-]+\/secrets\/.*)$/i.test(
    s,
  );
}

/** O valor tem cara de senha: número, símbolo ou maiúscula no meio. "trocar" não tem; "Kiwi#2024" tem. */
const passwordLike = (v: string) => v.length >= 4 && (hasDigit(v) || /[^A-Za-z0-9À-ÿ]/.test(v) || /.[A-Z]/.test(v));

/** O valor que começa em `at`: entre aspas, até a aspa que fecha; senão, até o espaço, sem a pontuação do fim. */
function valueAt(text: string, at: number): { start: number; end: number } | null {
  // `<sua chave>` e `{{ token }}` são um valor só, com o espaço dentro: o exemplo, não a senha.
  for (const [open, close] of [["<", ">"], ["{{", "}}"]] as const) {
    if (!text.startsWith(open, at)) continue;
    const end = text.indexOf(close, at + open.length);
    const nl = text.indexOf("\n", at);
    if (end > 0 && (nl < 0 || end < nl)) return { start: at, end: end + close.length };
  }
  const q = text[at];
  if (q === '"' || q === "'" || q === "`") {
    const close = text.indexOf(q, at + 1);
    const nl = text.indexOf("\n", at + 1);
    if (close < 0 || (nl >= 0 && nl < close)) return null;
    return close > at + 1 ? { start: at + 1, end: close } : null;
  }
  let end = at;
  while (end < text.length && !/\s/.test(text[end]!)) end++;
  while (end > at && /[.,;:)\]}>"'`]/.test(text[end - 1]!)) end--;
  return end > at ? { start: at, end } : null;
}

/**
 * Chave = valor e chave: valor, de configuração e de código (`.env`, YAML, JSON, `export`, argumentos). O `:` só vale
 * no começo da linha, depois de um `- ` de lista, ou com a chave entre aspas: no meio de uma frase ele é texto.
 */
const KEY_VALUE = /(?<![\w.-])(?<q>["']?)(?<k>[A-Za-z_][A-Za-z0-9_.-]{1,60})\k<q>[ \t]*(?<op>:|=(?!=))[ \t]*/dg;

function configFindings(text: string, out: Raw[]): void {
  for (const m of text.matchAll(KEY_VALUE)) {
    const g = m.groups!;
    if (!secretKey(g.k!)) continue;
    if (g.op === ":") {
      // `chave: valor` só é configuração no começo da linha, depois de `{ , ; (`, ou com a chave entre aspas. E uma
      // palavra só ("Senha: …") é prosa: quem cuida é a regra da senha pelo contexto, que separa senha de dúvida.
      const before = text.slice(text.lastIndexOf("\n", m.index! - 1) + 1, m.index!);
      const structured = g.q || /^[ \t]*(?:-[ \t]+|export[ \t]+)?$/.test(before) || /[{,;(][ \t]*$/.test(before);
      if (!structured || (!g.q && keyWords(g.k!).length === 1)) continue;
    }
    const v = valueAt(text, m.index! + m[0].length);
    if (!v) continue;
    const value = text.slice(v.start, v.end);
    if (placeholder(value) || /^[[{]/.test(value)) continue;
    out.push({ start: v.start, end: v.end, kind: "config", verdict: "secret", rank: 2 });
  }
}

/** As palavras de senha em prosa, em português e em inglês. */
const LABEL = String.raw`(?:senha|palavra-passe|password|passwd|passphrase|pwd|token|api[ _-]?key|chave(?:[ \t]+(?:de|da)[ \t]+api|[ \t]+secreta|[ \t]+privada|[ \t]+de[ \t]+acesso)|secret[ \t]+key|access[ \t]+key|client[ \t]+secret|c[oó]digo[ \t]+de[ \t]+acesso)`;
/** "senha: X" e "password = X" no meio do texto. */
const QUALIFIER = String.raw`(?:[ \t]+(?:do|da|de|dos|das|of|for|to)[ \t]+[^\n.:=]{1,40}?)?`;
const LABEL_SEP = new RegExp(String.raw`(?<![\w-])${LABEL}${QUALIFIER}[ \t]*(?::|=(?!=))[ \t]*`, "dgi");
/** "a senha é X", "a senha do wifi é X", "the password is X". */
const LABEL_IS = new RegExp(String.raw`(?<![\w-])${LABEL}${QUALIFIER}[ \t]+(?:é|eh|is|was|era|vai[ \t]+ser|will[ \t]+be)(?:[ \t]*:)?[ \t]+`, "dgi");

function proseFindings(text: string, out: Raw[]): void {
  for (const m of text.matchAll(LABEL_SEP)) {
    const v = valueAt(text, m.index! + m[0].length);
    if (!v) continue;
    const value = text.slice(v.start, v.end);
    if (placeholder(value)) continue;
    const quoted = /["'`]/.test(text[v.start - 1] ?? "");
    // "senha: Kiwi#2024" é segredo; "senha: trocar" pode ser senha ou não: dúvida.
    out.push({ start: v.start, end: v.end, kind: "password", verdict: quoted || passwordLike(value) ? "secret" : "doubt", rank: 2 });
  }
  for (const m of text.matchAll(LABEL_IS)) {
    const v = valueAt(text, m.index! + m[0].length);
    if (!v) continue;
    const value = text.slice(v.start, v.end);
    const quoted = /["'`]/.test(text[v.start - 1] ?? "");
    // "a senha é forte" é prosa; "a senha é Kiwi#2024" não.
    if (placeholder(value) || !(quoted || passwordLike(value))) continue;
    out.push({ start: v.start, end: v.end, kind: "password", verdict: "secret", rank: 2 });
  }
}

// ------------------------------------------------------------------------------------------------- o dado pessoal

function cpfValid(d: string): boolean {
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
  const digit = (n: number) => {
    let sum = 0;
    for (let i = 0; i < n; i++) sum += Number(d[i]) * (n + 1 - i);
    const r = (sum * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return digit(9) === Number(d[9]) && digit(10) === Number(d[10]);
}

function luhn(d: string): boolean {
  let sum = 0;
  for (let i = 0; i < d.length; i++) {
    let x = Number(d[d.length - 1 - i]);
    if (i % 2 === 1) {
      x *= 2;
      if (x > 9) x -= 9;
    }
    sum += x;
  }
  return sum % 10 === 0;
}

/** O começo de um número de cartão das bandeiras de verdade (Visa, Master, Amex, Discover, JCB, Diners, Elo, Hipercard). */
const CARD_IIN = /^(?:4|5[1-5]|2(?:2[2-9]|[3-6]\d|7[01]|720)|3[47]|6011|65|64[4-9]|35(?:2[89]|[3-8]\d)|3(?:0[0-5]|[68])|636368|438935|504175|451416|636297|5067|4576|4011|606282|3841)/;
const cardValid = (d: string) => d.length >= 13 && d.length <= 19 && CARD_IIN.test(d) && luhn(d) && !/^(\d)\1+$/.test(d);

const CPF_FORMATTED = /(?<![\d.])\d{3}\.\d{3}\.\d{3}-\d{2}(?![\d])/dg;
const CPF_PLAIN = /(?<![\d.-])\d{3}\.?\d{3}\.?\d{3}-?\d{2}(?![\d])/dg;
const CARD_GROUPED = /(?<![\d-])(?:\d{4}[ -]){3}\d{1,7}(?![\d-])|(?<![\d-])\d{4}[ -]\d{6}[ -]\d{4,5}(?![\d-])/dg;
const CARD_PLAIN = /(?<![\d.,-])\d{13,19}(?![\d.,-])/dg;
const CPF_CONTEXT = /\bcpf\b[^\n]{0,24}$/i;
const CARD_CONTEXT = /\b(?:cart[aã]o|card|cr[eé]dito|credit|d[eé]bito|debit|visa|master(?:card)?|amex|elo|hipercard|cvv|validade|n[uú]mero do cart)\b[^\n]{0,40}$/i;

function personalFindings(text: string, out: Raw[]): void {
  for (const m of text.matchAll(CPF_FORMATTED)) {
    if (cpfValid(m[0].replace(/\D/g, ""))) out.push({ start: m.index!, end: m.index! + m[0].length, kind: "cpf", verdict: "secret", rank: 1 });
  }
  // Onze dígitos soltos também são telefone e código: só com "CPF" perto.
  for (const m of text.matchAll(CPF_PLAIN)) {
    if (!CPF_CONTEXT.test(text.slice(Math.max(0, m.index! - 40), m.index!))) continue;
    if (cpfValid(m[0].replace(/\D/g, ""))) out.push({ start: m.index!, end: m.index! + m[0].length, kind: "cpf", verdict: "secret", rank: 1 });
  }
  for (const m of text.matchAll(CARD_GROUPED)) {
    if (cardValid(m[0].replace(/\D/g, ""))) out.push({ start: m.index!, end: m.index! + m[0].length, kind: "card", verdict: "secret", rank: 1 });
  }
  // Um número longo sem separador é, quase sempre, um código (de exame, de pedido): só com a palavra do cartão perto.
  for (const m of text.matchAll(CARD_PLAIN)) {
    if (!CARD_CONTEXT.test(text.slice(Math.max(0, m.index! - 60), m.index!))) continue;
    if (cardValid(m[0])) out.push({ start: m.index!, end: m.index! + m[0].length, kind: "card", verdict: "secret", rank: 1 });
  }
}

// ------------------------------------------------------------------------------------------------- a dúvida

const RUN = /[A-Za-z0-9+/=_-]{32,}/dg;
const HEX = /^(?:0x)?[0-9a-fA-F]+$/;
const FOLDER = /^[A-Za-z][a-z]+$/;
/** "sha256:", "integrity=", "md5 -": o rótulo diz que é um resumo, não um segredo. */
const DIGEST_LABEL = /(?:sha(?:1|224|256|384|512)|sha3-(?:224|256|384|512)|blake2[bs]?|md5|digest|integrity|checksum|hash|etag)\s*[:=-]?\s*["']?$/i;
const SRI = /^(?:sha(?:256|384|512)|sha3-(?:256|384|512)|blake2[bs]?)-/i;

const charClass = (c: number) => (c >= 48 && c <= 57 ? 0 : c >= 65 && c <= 90 ? 1 : c >= 97 && c <= 122 ? 2 : 3);

/** Parece sorteado: tem número, mistura classes e troca muito entre elas. Os pedaços em hexadecimal não contam. */
function readsRandom(run: string): boolean {
  const pieces = run.split(/[+/=_-]+/).filter((p) => p && !(p.length >= 8 && HEX.test(p)));
  const seen = new Set<number>();
  let chars = 0;
  let pairs = 0;
  let switches = 0;
  for (const p of pieces) {
    chars += p.length;
    for (let i = 0; i < p.length; i++) {
      const c = charClass(p.charCodeAt(i));
      seen.add(c);
      if (i === 0) continue;
      pairs++;
      if (c !== charClass(p.charCodeAt(i - 1))) switches++;
    }
  }
  return chars >= 32 && seen.has(0) && seen.size >= 2 && switches >= pairs * 0.3;
}

function doubtFindings(text: string, out: Raw[]): void {
  for (const m of text.matchAll(RUN)) {
    const start = m.index!;
    if (DIGEST_LABEL.test(text.slice(Math.max(0, start - 24), start))) continue;
    const run = m[0];
    if (SRI.test(run) || HEX.test(run.replace(/-/g, ""))) continue;
    // Um caminho (`/Users/ana/Documentos/…`) se olha pedaço por pedaço.
    const parts = run.split("/");
    if (parts.filter((p) => FOLDER.test(p)).length >= 2) {
      let at = start;
      for (const p of parts) {
        if (p.length >= 32 && !HEX.test(p) && readsRandom(p)) out.push({ start: at, end: at + p.length, kind: "random", verdict: "doubt", rank: 0 });
        at += p.length + 1;
      }
      continue;
    }
    if (readsRandom(run)) out.push({ start, end: start + run.length, kind: "random", verdict: "doubt", rank: 0 });
  }
}

// ------------------------------------------------------------------------------------------------- o que passa sempre

/**
 * Regiões em que nada é procurado, porque são públicas por natureza: a imagem em base64 (`data:…;base64,…`), a chave
 * pública de SSH e os blocos de certificado e de chave pública.
 */
const PUBLIC = /data:[\w.+-]+\/[\w.+-]+(?:;[\w=.-]+)*;base64,[A-Za-z0-9+/=]*|(?:ssh-(?:rsa|ed25519|dss)|ecdsa-sha2-nistp\d+|sk-ssh-ed25519@openssh\.com)[ \t]+AAAA[A-Za-z0-9+/=]+|-----BEGIN (?:CERTIFICATE|TRUSTED CERTIFICATE|PUBLIC KEY|RSA PUBLIC KEY|PGP PUBLIC KEY BLOCK|CERTIFICATE REQUEST|X509 CRL)-----[\s\S]*?(?:-----END [A-Z0-9 ]+-----|$)/g;
/** Endereços: a dúvida não olha dentro deles (as senhas e os tokens de um endereço têm regra própria). */
const URL = /\b[a-z][a-z0-9+.-]*:\/\/[^\s<>"'`)\]]+/gi;

function regions(text: string, re: RegExp): [number, number][] {
  return [...text.matchAll(re)].map((m) => [m.index!, m.index! + m[0].length] as [number, number]);
}

/** O trecho [s, e) cabe numa das regiões (em ordem, sem sobreposição)? Busca binária: um CSV tem milhares delas. */
function inside(spans: [number, number][], s: number, e: number): boolean {
  let lo = 0;
  let hi = spans.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const [a, b] = spans[mid]!;
    if (s < a) hi = mid - 1;
    else if (s >= b) lo = mid + 1;
    else return e <= b;
  }
  return false;
}

// ------------------------------------------------------------------------------------------------- juntando

interface Raw {
  start: number;
  end: number;
  kind: SecretKind;
  verdict: Verdict;
  rank: number;
}

/** Os trechos seguros de um texto, do primeiro ao último, sem sobreposição. O mesmo texto dá sempre o mesmo resultado. */
export function detect(text: string): Finding[] {
  const raw: Raw[] = [];
  for (const r of FORMAT) {
    r.re.lastIndex = 0;
    for (const m of text.matchAll(r.re)) {
      const [s, e] = m.indices?.groups?.v ?? m.indices![0]!;
      if (e <= s) continue;
      const verdict = r.check ? r.check(text.slice(s, e), text, s) : "secret";
      if (verdict) raw.push({ start: s, end: e, kind: r.kind, verdict, rank: r.rank });
    }
  }
  configFindings(text, raw);
  proseFindings(text, raw);
  personalFindings(text, raw);
  const data = regions(text, PUBLIC);
  const urls = regions(text, URL);
  const kept = raw.filter((f) => !inside(data, f.start, f.end));
  const doubts: Raw[] = [];
  doubtFindings(text, doubts);
  for (const d of doubts) if (!inside(data, d.start, d.end) && !inside(urls, d.start, d.end)) kept.push(d);

  // Na sobreposição ganha o segredo sobre a dúvida, depois o formato, depois o trecho mais longo. Uma varredura na
  // ordem do texto: cada trecho só pode encostar no último escolhido.
  kept.sort((a, b) => a.start - b.start || b.end - a.end);
  const chosen: Raw[] = [];
  for (const f of kept) {
    const last = chosen.at(-1);
    if (!last || f.start >= last.end) chosen.push(f);
    else if (better(f, last)) chosen[chosen.length - 1] = f;
  }

  const lines = lineStarts(text);
  return chosen.map((f) => ({ start: f.start, end: f.end, line: lineOf(lines, f.start), kind: f.kind, verdict: f.verdict }));
}

/** `a` ganha de `b` na sobreposição? */
function better(a: Raw, b: Raw): boolean {
  if (a.verdict !== b.verdict) return a.verdict === "secret";
  if (a.rank !== b.rank) return a.rank > b.rank;
  return a.end - a.start > b.end - b.start;
}

/** O texto inteiro: os trechos e o veredito (segredo se há algum segredo; dúvida se só há dúvida; senão limpo). */
export function scan(text: string): Scan {
  const findings = detect(text);
  const secrets = findings.filter((f) => f.verdict === "secret").length;
  const doubts = findings.length - secrets;
  return { findings, secrets, doubts, verdict: secrets ? "secret" : doubts ? "doubt" : "clean" };
}

function lineStarts(text: string): number[] {
  const out = [0];
  for (let i = text.indexOf("\n"); i >= 0; i = text.indexOf("\n", i + 1)) out.push(i + 1);
  return out;
}

function lineOf(starts: number[], at: number): number {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid]! <= at) lo = mid;
    else hi = mid - 1;
  }
  return lo + 1;
}

/** O começo público de um token (o prefixo do formato), que pode aparecer na máscara: não é parte do segredo. */
const PUBLIC_PREFIX =
  /^(?:-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY-----|gh[pousr]_|github_pat_|glpat-|sk-ant-|sk-(?:proj-|svcacct-|admin-)?|(?:sk|rk)_(?:live|test)_|whsec_|xox[abposr]-|AKIA|ASIA|ABIA|ACCA|AIza|GOCSPX-|ya29\.|npm_|hf_|pypi-|eyJ|https:\/\/hooks\.slack\.com\/)/;

/**
 * O trecho mascarado, para mostrar à pessoa: o prefixo público do formato, se houver, e o tamanho. Nunca um caractere
 * do segredo em si.
 */
export function mask(text: string, f: Pick<Finding, "start" | "end" | "kind">): string {
  const v = text.slice(f.start, f.end);
  const prefix = f.kind === "random" || f.kind === "password" || f.kind === "config" ? "" : (PUBLIC_PREFIX.exec(v)?.[0] ?? "");
  return `${prefix}•••• (${v.length} ${v.length === 1 ? "caractere" : "caracteres"})`;
}
