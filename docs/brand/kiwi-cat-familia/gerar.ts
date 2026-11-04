// Gera as variações do Kiwi-cat na família visual do Channels (T2025), a partir dos SVGs do demo
// (docs/kiwicat-demo/kiwi-cat-demo.zip). Só a aparência muda: os ids, a estrutura e o bloco de animação do intro
// continuam os mesmos, então a animação roda igual em cada variação (#2029).
//
//   unzip docs/kiwicat-demo/kiwi-cat-demo.zip -d /tmp/kiwicat && bun docs/brand/kiwi-cat-familia/gerar.ts /tmp/kiwicat
//
// O que vem do Channels (o ícone dele não entra neste repo, que é público): a base quadrada preta com raio 224/1024,
// o conteúdo na área segura de 10% (820 px), a borda nítida de vidro (branco por dentro, escuro por fora), a faixa
// holográfica (rosa, laranja, amarelo, verde, ciano, violeta) e nenhum brilho borrado.

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const src = process.argv[2];
if (!src) throw new Error("uso: bun gerar.ts <pasta com kiwi-cat.svg e kiwi-cat-intro.svg>");
const outDir = import.meta.dirname;

// A paleta holográfica do Channels.
const HOLO = { pink: "#ff5fbf", orange: "#ffa53d", yellow: "#fff27a", green: "#5cffb0", cyan: "#45c9ff", violet: "#7b61ff" };
const GLASS = "#0b0d14"; // o vidro escuro das lâminas do Channels
const OUTLINE = "#14161f"; // o contorno escuro por fora da borda branca

/** Mistura `c` sobre o vidro escuro, com intensidade k (opaco: partes que se sobrepõem não marcam emenda). */
function onGlass(c: string, k: number): string {
  const rgb = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const [a, b] = [rgb(GLASS), rgb(c)];
  return "#" + a.map((v, i) => Math.round(v * (1 - k) + b[i]! * k).toString(16).padStart(2, "0")).join("");
}

function replaceOnce(s: string, from: string | RegExp, to: string): string {
  const hit = typeof from === "string" ? s.includes(from) : from.test(s);
  if (!hit) throw new Error(`gerar: não achei ${from}`);
  return s.replace(from, to);
}

interface Variant {
  file: string;
  title: string;
  /** Opacidade das manchas da aura final e do brilho que segue o formato (0 tira o brilho borrado). */
  aura: number;
  /** Opacidade das manchas redondas que orbitam na intro. */
  introAura: number;
  /** Intensidade da faixa holográfica no corpo (0 mantém o preto original do gato). */
  holo: number;
  /** Força da luz de borda colorida original (fx-rim), de 0 a 1. */
  rim: number;
  /** Espessura de lâmina, como as do Channels: deslocamento da face de baixo (0 = sem espessura). */
  depth: [number, number];
  /** Um risco de reflexo no alto da cabeça, como o das lâminas. */
  highlight: boolean;
}

const VARIANTS: Variant[] = [
  { file: "kiwi-cat-1-aura", title: "Kiwi-cat 1: aura (mais fiel ao gato)", aura: 1, introAura: 1, holo: 0, rim: 1, depth: [0, 0], highlight: false },
  { file: "kiwi-cat-2-vidro", title: "Kiwi-cat 2: vidro (meio-termo)", aura: 0.4, introAura: 0.8, holo: 0.38, rim: 0.45, depth: [0, 0], highlight: true },
  { file: "kiwi-cat-3-lamina", title: "Kiwi-cat 3: lâmina (mais fiel ao Channels)", aura: 0, introAura: 0.6, holo: 0.62, rim: 0, depth: [-8, 36], highlight: true },
];

/** As primitivas da borda de vidro, antes do feMerge final do fx-rim. */
function glassEdge(v: Variant): { prims: string; under: string[]; over: string[] } {
  const [dx, dy] = v.depth;
  let prims = "";
  const under: string[] = [];
  let shape = "SourceAlpha";
  if (dx || dy) {
    // A face de baixo da lâmina: a silhueta deslocada, fora da de cima, com a faixa holográfica em listras.
    prims += `
      <feOffset in="SourceAlpha" dx="${dx}" dy="${dy}" result="slabBack"/>
      <feComposite in="slabBack" in2="SourceAlpha" operator="out" result="slabSide"/>
      <feFlood flood-color="${onGlass(HOLO.cyan, 0.35)}" x="0" y="0" width="1024" height="330" result="sb1"/>
      <feFlood flood-color="${onGlass(HOLO.violet, 0.4)}" x="0" y="330" width="1024" height="230" result="sb2"/>
      <feFlood flood-color="${onGlass(HOLO.pink, 0.4)}" x="0" y="560" width="1024" height="230" result="sb3"/>
      <feFlood flood-color="${onGlass(HOLO.orange, 0.35)}" x="0" y="790" width="1024" height="234" result="sb4"/>
      <feMerge x="0" y="0" width="1024" height="1024" result="sideBands"><feMergeNode in="sb1"/><feMergeNode in="sb2"/><feMergeNode in="sb3"/><feMergeNode in="sb4"/></feMerge>
      <feGaussianBlur in="sideBands" stdDeviation="0 40" result="sideColor"/>
      <feComposite in="sideColor" in2="slabSide" operator="in" result="sideFill"/>
      <feMerge result="slabAll"><feMergeNode in="SourceAlpha"/><feMergeNode in="slabBack"/></feMerge>
      <feMorphology in="slabAll" operator="erode" radius="5" result="slabInner"/>
      <feComposite in="slabAll" in2="slabInner" operator="out" result="slabRing"/>
      <feFlood flood-color="#ffffff" flood-opacity="0.75"/>
      <feComposite in2="slabRing" operator="in" result="slabEdge"/>`;
    under.push("sideFill", "slabEdge");
    shape = "slabAll";
  }
  prims += `
      <feMorphology in="${shape}" operator="dilate" radius="12" result="outerGrow"/>
      <feComposite in="outerGrow" in2="${shape}" operator="out" result="outerRing"/>
      <feFlood flood-color="${OUTLINE}" flood-opacity="0.6"/>
      <feComposite in2="outerRing" operator="in" result="darkEdge"/>
      <feMorphology in="SourceAlpha" operator="erode" radius="6" result="faceInner"/>
      <feComposite in="SourceAlpha" in2="faceInner" operator="out" result="faceRing"/>
      <feFlood flood-color="#ffffff" flood-opacity="0.85"/>
      <feComposite in2="faceRing" operator="in" result="glassEdge"/>`;
  return { prims, under: ["darkEdge", ...under], over: ["glassEdge"] };
}

function variant(svg: string, v: Variant): string {
  let s = svg;

  // Título.
  s = replaceOnce(s, /<title id="kiwi-cat-title">[^<]*<\/title>/, `<title id="kiwi-cat-title">${v.title}</title>`);

  // A base do Channels: quadrado preto com raio 224, no lugar do fundo branco. O #bg segue com o mesmo id.
  s = replaceOnce(s, /<rect id="bg"[^>]*\/>/, `<rect id="bg" width="1024" height="1024" rx="224" fill="#000000"/>`);
  // O gato vai para a área segura de 10%, como o conteúdo do Channels, num svg aninhado: o transform-box: view-box
  // das animações passa a valer nesse viewport, então as origens (512px 1004px…) continuam certas. O brilho fica
  // recortado pela base arredondada.
  s = replaceOnce(s, `<g id="aura">`, `<g clip-path="url(#clip-base)"><svg id="safe-area" x="102" y="102" width="820" height="820" viewBox="0 0 1024 1024" overflow="visible">\n  <g id="aura">`);
  s = replaceOnce(s, /(<use id="silhouette-outline"[^>]*\/>)/, `$1\n  </svg></g>`);
  s = replaceOnce(s, "<defs>", `<defs>\n    <clipPath id="clip-base"><rect width="1024" height="1024" rx="224"/></clipPath>`);

  // A paleta do brilho e da luz de borda passa para a holográfica do Channels.
  const swap: Record<string, string> = { "#2ff6ff": HOLO.cyan, "#3cc8ff": HOLO.cyan, "#4d6bff": HOLO.violet, "#7a7dff": HOLO.violet, "#e86bff": HOLO.pink, "#5b4fd6": HOLO.orange, "#f25cff": HOLO.pink, "#b06bff": HOLO.orange, "#d070ff": HOLO.pink, "#c86bff": HOLO.pink, "#3ad8ff": HOLO.cyan, "#ff5cf0": HOLO.pink, "#7a5cff": HOLO.orange };
  s = s.replace(/#[0-9a-f]{6}\b/gi, (c) => swap[c.toLowerCase()] ?? c);

  // A aura final e o brilho que segue o formato: opacidade nos elementos de dentro (os wrappers são animados).
  s = s.replace(/(<ellipse id="aura-(?:cyan|blue|violet|magenta)"[^>]*?opacity=")([\d.]+)"/g, (_, a, o) => `${a}${(+o * v.aura).toFixed(2)}"`);
  s = replaceOnce(s, `<use id="aura-silhouette"`, `<use id="aura-silhouette" opacity="${v.aura}"`);
  s = replaceOnce(s, `<use id="aura-tail"`, `<use id="aura-tail" opacity="${v.aura}"`);
  s = replaceOnce(s, `<g id="aura-intro-spread">`, `<g id="aura-intro-spread" opacity="${v.introAura}">`);

  // O corpo: com holo > 0, vidro escuro com a faixa holográfica na diagonal, como nas lâminas (cores opacas).
  if (v.holo > 0) {
    const k = v.holo;
    const stops: [number, string][] = [
      [0, onGlass("#2a3550", 0.9)], [0.3, GLASS], [0.36, onGlass(HOLO.pink, k)], [0.42, onGlass(HOLO.orange, k)],
      [0.48, onGlass(HOLO.yellow, k)], [0.54, onGlass(HOLO.green, k)], [0.6, onGlass(HOLO.cyan, k)],
      [0.66, onGlass(HOLO.violet, k)], [0.72, onGlass("#ffffff", k * 0.7)], [0.8, GLASS], [1, onGlass("#1d2340", 0.9)],
    ];
    s = replaceOnce(
      s,
      /<linearGradient id="grad-cat-fill"[\s\S]*?<\/linearGradient>/,
      `<linearGradient id="grad-cat-fill" gradientUnits="userSpaceOnUse" x1="250" y1="150" x2="790" y2="1010">\n${stops.map(([o, c]) => `      <stop offset="${o}" stop-color="${c}"/>`).join("\n")}\n    </linearGradient>`,
    );
  }

  // A luz de borda colorida original (fx-rim) com a força da variação, e a borda de vidro do Channels por cima.
  s = replaceOnce(s, /(<feFuncA type="linear" slope=")0\.62"/, `$1${(0.62 * v.rim).toFixed(2)}"`);
  const edge = glassEdge(v);
  s = replaceOnce(
    s,
    `<feMerge><feMergeNode in="SourceGraphic"/><feMergeNode in="rimFinal"/></feMerge>`,
    `${edge.prims}
      <feMerge>${edge.under.map((n) => `<feMergeNode in="${n}"/>`).join("")}<feMergeNode in="SourceGraphic"/><feMergeNode in="rimFinal"/>${edge.over.map((n) => `<feMergeNode in="${n}"/>`).join("")}</feMerge>`,
  );

  // O reflexo no alto da cabeça (gira junto com ela, dentro do #head).
  if (v.highlight) {
    s = replaceOnce(s, `<g id="eyes-wake">`, `<path id="glass-highlight" d="M452,238 C482,229 542,229 572,238" fill="none" stroke="#ffffff" stroke-width="9" stroke-linecap="round" opacity="0.55"/>\n        <g id="eyes-wake">`);
  }
  return s;
}

const stripMetadata = (s: string) => s.replace(/<metadata>[\s\S]*?<\/metadata>/g, "");
for (const name of ["kiwi-cat", "kiwi-cat-intro"]) {
  const svg = stripMetadata(readFileSync(path.join(src, `${name}.svg`), "utf8"));
  for (const v of VARIANTS) {
    const out = path.join(outDir, `${v.file}${name.endsWith("intro") ? "-intro" : ""}.svg`);
    writeFileSync(out, variant(svg, v));
    console.log(`gerar: ${path.relative(process.cwd(), out)}`);
  }
}
