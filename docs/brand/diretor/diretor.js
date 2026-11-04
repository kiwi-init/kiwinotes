// A página do diretor do Kiwi-cat (T3065). O harry mexe no tempo e na curva de cada animação e marca pontos num
// frame; o Salvar grava o direcao.json, que o `aplicar.ts` passa para o SVG com os mesmos números.
//
// A prévia usa o mesmo `aplicar` que grava no arquivo (animacao.ts): o que aparece aqui é o que vai para o repo.
// O relógio é nosso: todas as animações ficam pausadas, e a cada frame o `currentTime` delas vai para o instante `t`.

import { aplicar, bezier, mesmaCurva, pontos, regras, tempo } from "/animacao.js";

const $ = (id) => document.getElementById(id);
const frame = $("frame");
const stage = $("stage");

const st = {
  original: "",
  svgPath: "",
  grupos: [], // { chave, seletor, item } de cada animação do arquivo
  mudancas: new Map(), // chave → Mudanca
  notas: [],
  t: 0,
  total: 12,
  tocando: false,
  velocidade: 1,
  filtros: true,
  sel: null,
  marcando: false,
  sujo: false,
};

const chave = (seletor, nome) => `${seletor}|${nome}`;
const SNAP = 0.05;
const arred = (v, passo = 0.01) => Math.round(v / passo) * passo;

// ---------- carregar ----------

async function carregar() {
  const r = await fetch("/api/estado");
  const { svg, direcao } = await r.json();
  st.original = svg;
  st.svgPath = direcao.svg;
  st.grupos = regras(svg).flatMap((rg) => rg.itens.map((item) => ({ chave: chave(rg.seletor, item.nome), seletor: rg.seletor, item })));
  for (const m of direcao.mudancas ?? []) {
    const g = st.grupos.find((x) => x.chave === chave(m.seletor.replace(/\s*,\s*/g, ","), m.animacao));
    if (g) st.mudancas.set(g.chave, { ...m, seletor: g.seletor });
  }
  st.notas = direcao.notas ?? [];
  const fins = st.grupos.map((g) => (g.item.partes.includes("infinite") ? g.item.atraso + 2 : g.item.atraso + g.item.duracao + 1));
  st.total = Math.ceil(Math.max(8, ...fins));
  desenharPrevia();
  desenharLinha();
  desenharInspetor();
  desenharNotas();
  desenharMudancas();
}

// ---------- a prévia ----------

function valores(g) {
  const m = st.mudancas.get(g.chave);
  return {
    duracao: m?.duracao ?? g.item.duracao,
    atraso: m?.atraso ?? g.item.atraso,
    curva: m?.curva ?? g.item.curva,
  };
}

let anims = [];
let pendente = false;

function desenharPrevia() {
  let texto = aplicar(st.original, [...st.mudancas.values()], true).svg;
  // O "reduzir movimento" do sistema desligaria tudo; no diretor a animação sempre toca.
  texto = texto.replace(/@media\s*\(prefers-reduced-motion[^{]*\{[\s\S]*?\}\s*\}/, "");
  if (!st.filtros) texto = texto.replace(/<\/svg>\s*$/, "<style>#kiwi-cat [filter]{filter:none !important}</style></svg>");
  frame.innerHTML = texto;
  anims = document.getAnimations();
  for (const a of anims) a.pause();
  buscar(st.t);
}

function agendarPrevia() {
  if (pendente) return;
  pendente = true;
  requestAnimationFrame(() => {
    pendente = false;
    desenharPrevia();
  });
}

function buscar(t) {
  st.t = Math.max(0, Math.min(st.total, t));
  for (const a of anims) a.currentTime = st.t * 1000;
  $("tempo").textContent = `${st.t.toFixed(2)} s`;
  const x = (st.t / st.total) * 100;
  for (const c of document.querySelectorAll(".cabeca")) c.style.left = `${x}%`;
  desenharPins();
}

let relogio = null;
function tocar(sim) {
  st.tocando = sim;
  $("play").textContent = sim ? "❚❚ Pausar" : "▶︎ Tocar";
  if (!sim) return;
  if (st.t >= st.total - 0.01) buscar(0);
  const inicio = performance.now() - (st.t * 1000) / st.velocidade;
  relogio = inicio;
  const passo = (agora) => {
    if (!st.tocando || relogio !== inicio) return;
    const t = ((agora - inicio) * st.velocidade) / 1000;
    if (t >= st.total) {
      buscar(st.total);
      tocar(false);
      return;
    }
    buscar(t);
    requestAnimationFrame(passo);
  };
  requestAnimationFrame(passo);
}

// ---------- mudanças ----------

function mudar(g, patch) {
  const base = g.item;
  const m = st.mudancas.get(g.chave) ?? {
    seletor: g.seletor,
    animacao: base.nome,
    de: { duracao: base.duracao, atraso: base.atraso, curva: base.curva },
  };
  Object.assign(m, patch);
  if (m.duracao !== undefined && Math.abs(m.duracao - base.duracao) < 1e-6) delete m.duracao;
  if (m.atraso !== undefined && Math.abs(m.atraso - base.atraso) < 1e-6) delete m.atraso;
  if (m.curva !== undefined && mesmaCurva(m.curva, base.curva)) delete m.curva;
  if (m.duracao === undefined && m.atraso === undefined && m.curva === undefined) st.mudancas.delete(g.chave);
  else st.mudancas.set(g.chave, m);
  st.sujo = true;
  agendarPrevia();
  desenharLinha();
  desenharMudancas();
}

// ---------- linha do tempo ----------

function desenharLinha() {
  const regua = $("regua");
  regua.innerHTML = "";
  for (let s = 0; s <= st.total; s++) {
    const d = document.createElement("div");
    d.className = "tick";
    d.style.left = `${(s / st.total) * 100}%`;
    d.textContent = `${s}s`;
    regua.appendChild(d);
  }
  for (const n of st.notas) {
    const d = document.createElement("div");
    d.className = "mpin";
    d.style.left = `${(n.t / st.total) * 100}%`;
    d.title = `${n.t.toFixed(2)} s · ${n.texto}`;
    regua.appendChild(d);
  }
  const cab = document.createElement("div");
  cab.className = "cabeca";
  regua.appendChild(cab);

  const tl = $("tl");
  const rolagem = tl.scrollTop;
  tl.innerHTML = "";
  for (const g of st.grupos) {
    const v = valores(g);
    const row = document.createElement("div");
    row.className = `row${st.sel === g.chave ? " sel" : ""}${st.mudancas.has(g.chave) ? " mudou" : ""}`;
    const nome = document.createElement("div");
    nome.className = "nome";
    nome.textContent = `${g.seletor} · ${g.item.nome}`;
    nome.title = nome.textContent;
    nome.onclick = () => selecionar(g.chave);
    const trilha = document.createElement("div");
    trilha.className = "trilha";
    const inf = g.item.partes.includes("infinite");
    const barra = document.createElement("div");
    barra.className = `barra${inf ? " inf" : ""}`;
    barra.style.left = `${(v.atraso / st.total) * 100}%`;
    barra.style.width = `${((inf ? st.total - v.atraso : v.duracao) / st.total) * 100}%`;
    barra.title = `${tempo(v.duracao)} · ${v.curva} · começa em ${tempo(v.atraso)}${inf ? " · repete" : ""}`;
    const fim = document.createElement("div");
    fim.className = "fim";
    if (!inf) barra.appendChild(fim);
    arrastar(barra, trilha, g, "atraso");
    if (!inf) arrastar(fim, trilha, g, "duracao");
    const cab2 = document.createElement("div");
    cab2.className = "cabeca";
    trilha.append(barra, cab2);
    row.append(nome, trilha);
    tl.appendChild(row);
  }
  tl.scrollTop = rolagem;
  buscar(st.t);
}

function arrastar(el, trilha, g, campo) {
  el.addEventListener("pointerdown", (e) => {
    e.stopPropagation();
    e.preventDefault();
    // A largura antes de selecionar: selecionar redesenha a linha do tempo, e esta trilha sai da página.
    const largura = trilha.getBoundingClientRect().width;
    if (!(largura > 0)) return;
    selecionar(g.chave);
    const x0 = e.clientX;
    const v0 = valores(g)[campo];
    const mover = (ev) => {
      const dt = ((ev.clientX - x0) / largura) * st.total;
      if (!Number.isFinite(dt)) return;
      // Encaixa em 0,05 s; com ⌥, livre (0,01 s).
      const passo = ev.altKey ? 0.01 : SNAP;
      const novo = Math.max(campo === "duracao" ? 0.05 : 0, arred(v0 + dt, passo));
      mudar(g, { [campo]: Number(novo.toFixed(3)) });
      if (campo === "atraso") buscar(novo);
      desenharInspetor();
    };
    const soltar = () => {
      window.removeEventListener("pointermove", mover);
      window.removeEventListener("pointerup", soltar);
    };
    window.addEventListener("pointermove", mover);
    window.addEventListener("pointerup", soltar);
  });
}

function seekRegua(e) {
  const r = $("regua").getBoundingClientRect();
  buscar(((e.clientX - r.left) / r.width) * st.total);
}
$("regua").addEventListener("pointerdown", (e) => {
  tocar(false);
  seekRegua(e);
  const mover = (ev) => seekRegua(ev);
  const soltar = () => {
    window.removeEventListener("pointermove", mover);
    window.removeEventListener("pointerup", soltar);
  };
  window.addEventListener("pointermove", mover);
  window.addEventListener("pointerup", soltar);
});

// ---------- inspetor ----------

function selecionar(k) {
  st.sel = k;
  desenharLinha();
  desenharInspetor();
}

function desenharInspetor() {
  const box = $("insp");
  const g = st.grupos.find((x) => x.chave === st.sel);
  if (!g) {
    box.className = "muted";
    box.textContent = "Clique numa barra da linha do tempo, ou numa parte do gato, para ajustar o tempo e a curva.";
    return;
  }
  const v = valores(g);
  box.className = "";
  box.innerHTML = `
    <div class="mono" style="color:var(--sel)">${g.seletor}</div>
    <div class="mono muted">@keyframes ${g.item.nome}</div>
    <div class="campo"><span>Começa em (s)</span><input type="number" id="i-atraso" step="0.05" min="0" value="${v.atraso}"></div>
    <div class="campo"><span>Duração (s)</span><input type="number" id="i-duracao" step="0.05" min="0.05" value="${v.duracao}"></div>
    <div class="campo"><span>Curva</span><span class="mono" id="i-curva-txt">${v.curva}</span></div>
    <svg id="curva" viewBox="0 0 200 200"></svg>
    <div class="presets" id="presets"></div>
    <div class="campo" style="margin-top:10px">
      <button id="i-ir">Ir para o começo dela</button>
      <button id="i-volta" ${st.mudancas.has(g.chave) ? "" : "disabled"}>Voltar ao original</button>
    </div>`;
  $("i-atraso").onchange = (e) => mudar(g, { atraso: Math.max(0, Number(e.target.value)) });
  $("i-duracao").onchange = (e) => mudar(g, { duracao: Math.max(0.05, Number(e.target.value)) });
  $("i-ir").onclick = () => buscar(valores(g).atraso);
  $("i-volta").onclick = () => {
    st.mudancas.delete(g.chave);
    st.sujo = true;
    agendarPrevia();
    desenharLinha();
    desenharInspetor();
    desenharMudancas();
  };
  desenharCurva(g);
  const usadas = [...new Set(st.grupos.map((x) => x.item.curva))];
  const presets = [...new Set(["linear", "ease", "ease-in", "ease-out", "ease-in-out", ...usadas])];
  for (const c of presets) {
    const b = document.createElement("button");
    b.textContent = c.replace("cubic-bezier", "cb");
    b.title = c;
    b.onclick = () => {
      mudar(g, { curva: c });
      desenharInspetor();
    };
    $("presets").appendChild(b);
  }
}

// O editor de curva: x de 0 a 1 em 20…180; y de 0 a 1 em 140…70, e a sobra de -0,85 a 2 fica à vista (o "passa do ponto" das curvas elásticas, como a das orelhas).
const px = (x) => 20 + x * 160;
const py = (y) => 140 - y * 70;

function desenharCurva(g) {
  const svg = $("curva");
  const p = pontos(valores(g).curva);
  if (!p) {
    svg.innerHTML = `<text x="100" y="105" fill="#8d93c4" font-size="11" text-anchor="middle">esta curva não se edita aqui</text>`;
    return;
  }
  const NS = "http://www.w3.org/2000/svg";
  const desenhar = () => {
    svg.innerHTML = `
      <rect x="20" y="70" width="160" height="70" fill="none" stroke="#262257"/>
      <line x1="20" y1="140" x2="180" y2="70" stroke="#262257" stroke-dasharray="3 3"/>
      <line x1="20" y1="140" x2="${px(p[0])}" y2="${py(p[1])}" stroke="#8d93c4"/>
      <line x1="180" y1="70" x2="${px(p[2])}" y2="${py(p[3])}" stroke="#8d93c4"/>
      <path d="M20,140 C${px(p[0])},${py(p[1])} ${px(p[2])},${py(p[3])} 180,70" fill="none" stroke="#36f0ff" stroke-width="2.5"/>
      <text x="20" y="158" fill="#8d93c4" font-size="10">0</text><text x="172" y="158" fill="#8d93c4" font-size="10">fim</text>`;
    for (const i of [0, 1]) {
      const c = document.createElementNS(NS, "circle");
      c.setAttribute("cx", px(p[i * 2]));
      c.setAttribute("cy", py(p[i * 2 + 1]));
      c.setAttribute("r", "7");
      c.setAttribute("fill", i ? "#ff5cf0" : "#ffd166");
      c.style.cursor = "grab";
      c.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        const mover = (ev) => {
          const m = svg.getScreenCTM().inverse();
          const pt = new DOMPoint(ev.clientX, ev.clientY).matrixTransform(m);
          p[i * 2] = Math.min(1, Math.max(0, arred((pt.x - 20) / 160)));
          p[i * 2 + 1] = Math.min(2, Math.max(-0.85, arred((140 - pt.y) / 70)));
          desenhar();
          $("i-curva-txt").textContent = bezier(p);
          mudar(g, { curva: bezier(p) });
        };
        const soltar = () => {
          window.removeEventListener("pointermove", mover);
          window.removeEventListener("pointerup", soltar);
          desenharInspetor();
        };
        window.addEventListener("pointermove", mover);
        window.addEventListener("pointerup", soltar);
      });
      svg.appendChild(c);
    }
  };
  desenhar();
}

// ---------- o gato: escolher e marcar ----------

/**
 * A parte do gato sob o ponteiro. A aura e o brilho ficam por cima do gato, então o elemento do clique costuma ser a
 * aura: entre tudo o que está naquele ponto, vale a primeira parte de dentro do `#cat` (orelha, olho, rabo…); sem
 * ela, o que estiver por cima.
 */
function elementoEm(x, y) {
  const todos = document.elementsFromPoint(x, y).filter((el) => frame.contains(el) && el !== frame && !el.classList.contains("pin"));
  return todos.find((el) => el.closest("#cat")) ?? todos[0] ?? null;
}

function alvoDe(el) {
  const ids = [];
  for (let e = el; e && e.id !== "kiwi-cat" && e !== frame; e = e.parentElement) if (e.id) ids.push(`#${e.id}`);
  return ids.slice(0, 3).join(" < ");
}

frame.addEventListener("mousemove", (e) => {
  $("hover").textContent = alvoDe(elementoEm(e.clientX, e.clientY)) || "";
});

frame.addEventListener("click", (e) => {
  if (st.marcando) return novaNota(e);
  for (let el = elementoEm(e.clientX, e.clientY); el && el !== frame; el = el.parentElement) {
    const g = st.grupos.find((x) => el.matches?.(x.seletor));
    if (g) return selecionar(g.chave);
  }
});

function novaNota(e) {
  tocar(false);
  const svg = frame.querySelector(":scope > svg");
  const pt = new DOMPoint(e.clientX, e.clientY).matrixTransform(svg.getScreenCTM().inverse());
  const alvo = alvoDe(elementoEm(e.clientX, e.clientY));
  document.querySelector(".nova")?.remove();
  const box = document.createElement("div");
  box.className = "nova";
  const r = stage.getBoundingClientRect();
  box.style.left = `${Math.min(e.clientX - r.left + 12, r.width - 270)}px`;
  box.style.top = `${Math.min(e.clientY - r.top + 12, r.height - 130)}px`;
  box.innerHTML = `<div class="mono muted">${st.t.toFixed(2)} s · ${alvo || "(fundo)"}</div>
    <textarea placeholder="O que mudar aqui? (ex.: esta orelha mais pontuda; entrar 0,2 s depois)"></textarea>
    <div style="display:flex;gap:6px;justify-content:flex-end"><button data-c>Cancelar</button><button class="pri" data-ok>Guardar nota</button></div>`;
  stage.appendChild(box);
  const ta = box.querySelector("textarea");
  ta.focus();
  const ok = () => {
    const texto = ta.value.trim();
    if (texto) {
      st.notas.push({ t: Number(st.t.toFixed(3)), x: Math.round(pt.x), y: Math.round(pt.y), alvo, texto, criada: new Date().toISOString() });
      st.sujo = true;
      desenharNotas();
      desenharLinha();
    }
    box.remove();
  };
  box.querySelector("[data-ok]").onclick = ok;
  box.querySelector("[data-c]").onclick = () => box.remove();
  ta.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter" && !ev.shiftKey) {
      ev.preventDefault();
      ok();
    } else if (ev.key === "Escape") box.remove();
  });
}

function desenharPins() {
  for (const p of frame.querySelectorAll(".pin")) p.remove();
  const svg = frame.querySelector(":scope > svg");
  if (!svg) return;
  const m = svg.getScreenCTM();
  const r = frame.getBoundingClientRect();
  for (const n of st.notas) {
    if (Math.abs(n.t - st.t) > 0.051) continue;
    const q = new DOMPoint(n.x, n.y).matrixTransform(m);
    const d = document.createElement("div");
    d.className = "pin";
    d.style.left = `${q.x - r.left}px`;
    d.style.top = `${q.y - r.top}px`;
    const s = document.createElement("span");
    s.textContent = n.texto;
    d.appendChild(s);
    frame.appendChild(d);
  }
}

function desenharNotas() {
  const ul = $("notas");
  ul.innerHTML = "";
  if (!st.notas.length) {
    ul.innerHTML = `<li class="muted" style="cursor:default">Nenhuma nota ainda.</li>`;
    return;
  }
  st.notas.forEach((n, i) => {
    const li = document.createElement("li");
    li.innerHTML = `<button class="x" title="Apagar">×</button><div class="mono muted"></div><div></div>`;
    li.children[1].textContent = `${n.t.toFixed(2)} s · ${n.alvo || "(fundo)"}`;
    li.children[2].textContent = n.texto;
    li.onclick = () => {
      tocar(false);
      buscar(n.t);
    };
    li.querySelector(".x").onclick = (e) => {
      e.stopPropagation();
      st.notas.splice(i, 1);
      st.sujo = true;
      desenharNotas();
      desenharLinha();
    };
    ul.appendChild(li);
  });
}

function desenharMudancas() {
  const ol = $("mudancas");
  ol.innerHTML = "";
  if (!st.mudancas.size) {
    ol.innerHTML = `<li class="muted">Nenhuma mudança de tempo.</li>`;
    return;
  }
  for (const m of st.mudancas.values()) {
    const li = document.createElement("li");
    li.className = "mono";
    const partes = [
      m.atraso !== undefined ? `começa ${tempo(m.de.atraso)} → ${tempo(m.atraso)}` : "",
      m.duracao !== undefined ? `dura ${tempo(m.de.duracao)} → ${tempo(m.duracao)}` : "",
      m.curva !== undefined ? `curva → ${m.curva}` : "",
    ].filter(Boolean);
    li.textContent = `${m.seletor} ${m.animacao}: ${partes.join(", ")}`;
    ol.appendChild(li);
  }
}

// ---------- salvar ----------

async function salvar() {
  const corpo = { svg: st.svgPath, mudancas: [...st.mudancas.values()], notas: st.notas };
  const r = await fetch("/api/direcao", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(corpo) });
  if (r.ok) {
    const { arquivo } = await r.json();
    st.sujo = false;
    $("status").textContent = `Salvo em ${arquivo} às ${new Date().toLocaleTimeString("pt-BR")}. Avise o agente no canal.`;
  } else {
    $("status").textContent = `Não salvou: ${await r.text()}`;
  }
}

// ---------- controles ----------

$("play").onclick = () => tocar(!st.tocando);
$("inicio").onclick = () => {
  tocar(false);
  buscar(0);
};
$("velocidade").onchange = (e) => {
  const era = st.tocando;
  tocar(false);
  st.velocidade = Number(e.target.value);
  if (era) tocar(true);
};
$("filtros").onchange = (e) => {
  st.filtros = e.target.checked;
  desenharPrevia();
};
$("marcar").onclick = () => marcar(!st.marcando);
$("salvar").onclick = salvar;

function marcar(sim) {
  st.marcando = sim;
  $("marcar").classList.toggle("on", sim);
  stage.classList.toggle("marcando", sim);
}

window.addEventListener("keydown", (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === "s") {
    e.preventDefault();
    salvar();
    return;
  }
  if (e.target.closest("input, textarea, select")) return;
  if (e.key === " ") {
    e.preventDefault();
    tocar(!st.tocando);
  } else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
    e.preventDefault();
    tocar(false);
    buscar(st.t + (e.key === "ArrowRight" ? 1 : -1) * (e.shiftKey ? 0.5 : 1 / 30));
  } else if (e.key === "m" || e.key === "M") marcar(!st.marcando);
  else if (e.key === "Escape") {
    marcar(false);
    document.querySelector(".nova")?.remove();
  }
});

window.addEventListener("resize", desenharPins);
window.addEventListener("beforeunload", (e) => {
  if (st.sujo) e.preventDefault();
});

carregar().catch((e) => {
  $("status").textContent = `Não carregou: ${e.message}`;
});
