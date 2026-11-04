// Gerado por docs/brand/intro/gerar.ts a partir de docs/brand/intro/intro.js: edite lá.
// A linha do tempo da intro (T2113, T2308). O gerar.ts põe este script dentro do intro.html (o protótipo, que abre
// sozinho no navegador) e copia para app/ui/intro/intro.js (a janela `intro` do app, onde a CSP das views não deixa
// script inline). No app há o `window.engine` do AppEngine: o script avisa que subiu (`ready`) e, no fim, chama o
// `intro.done`, e o main fecha a janela e abre o hub.
(() => {
  const params = new URLSearchParams(location.search);
  const stage = document.getElementById("stage");
  const fit = document.getElementById("fit");
  const cat = document.getElementById("cat-layer");
  // O "Reduzir movimento" do macOS, ou o Movimento "Reduzido" da Aparência do app (T2503): a cópia que as janelas
  // guardam, na hora, e o valor do engine antes de a linha do tempo começar.
  let reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  try {
    if (JSON.parse(localStorage.getItem("kn-appearance") || "null")?.motion === "reduced") reduced = true;
  } catch {}
  // No app: a UI subiu (o AppEngine conta o boot como bom; sem isso, em 5 s ele volta para a UI anterior).
  const engine = window.engine;
  engine?.ready();

  const resize = () => fit.style.transform = `scale(${Math.min(innerWidth, innerHeight) * 0.86 / 1024})`;
  addEventListener("resize", resize);
  resize();

  // A borda desenhada: 4 lados e 4 cantos em sequência, como um traço (cada pedaço só muda transform e opacity).
  const W = 520, H = 320, R = 52, S = 3, T0 = 0.2, TOTAL = 0.62;
  const arc = (Math.PI * R) / 2;
  const pieces = [
    { cls: "h", len: W - 2 * R, css: { left: R, top: 0, width: W - 2 * R, height: S }, origin: "left", anim: "edgeX" },
    { cls: "c", len: arc, css: { right: 0, top: 0, borderTopWidth: S, borderRightWidth: S, borderTopRightRadius: R } },
    { cls: "v", len: H - 2 * R, css: { right: 0, top: R, width: S, height: H - 2 * R }, origin: "top", anim: "edgeY" },
    { cls: "c", len: arc, css: { right: 0, bottom: 0, borderBottomWidth: S, borderRightWidth: S, borderBottomRightRadius: R } },
    { cls: "h", len: W - 2 * R, css: { left: R, bottom: 0, width: W - 2 * R, height: S }, origin: "right", anim: "edgeX" },
    { cls: "c", len: arc, css: { left: 0, bottom: 0, borderBottomWidth: S, borderLeftWidth: S, borderBottomLeftRadius: R } },
    { cls: "v", len: H - 2 * R, css: { left: 0, top: R, width: S, height: H - 2 * R }, origin: "bottom", anim: "edgeY" },
    { cls: "c", len: arc, css: { left: 0, top: 0, borderTopWidth: S, borderLeftWidth: S, borderTopLeftRadius: R } },
  ];
  const perimeter = pieces.reduce((n, p) => n + p.len, 0);
  const outline = document.getElementById("outline");
  let at = T0;
  for (const p of pieces) {
    const el = document.createElement("i");
    el.className = p.cls;
    for (const [k, v] of Object.entries(p.css)) el.style[k] = typeof v === "number" ? `${v}px` : v;
    const dur = (TOTAL * p.len) / perimeter;
    if (p.anim) {
      el.style.transformOrigin = p.origin;
      el.dataset.anim = `${p.anim} ${dur.toFixed(3)}s linear ${at.toFixed(3)}s both, outlineOut .3s ease-out 1.0s forwards`;
    } else {
      el.dataset.anim = `fade ${(dur * 0.8).toFixed(3)}s linear ${at.toFixed(3)}s both, outlineOut .3s ease-out 1.0s forwards`;
    }
    at += dur;
    outline.append(el);
  }

  // O prisma em 3D. A pose de cada instante: a virada para cima (rotateX), o giro no plano (rotateZ) e a distância
  // de cada lâmina na pilha (translateZ), com as curvas de easing do roteiro. Amostrada a 60 por segundo.
  const bezier = (x1, y1, x2, y2) => (x) => {
    if (x <= 0 || x >= 1) return Math.min(1, Math.max(0, x));
    let lo = 0, hi = 1, u = x;
    for (let i = 0; i < 30; i++) {
      const bx = 3 * x1 * u * (1 - u) ** 2 + 3 * x2 * u * u * (1 - u) + u ** 3;
      if (bx < x) lo = u; else hi = u;
      u = (lo + hi) / 2;
    }
    return 3 * y1 * u * (1 - u) ** 2 + 3 * y2 * u * u * (1 - u) + u ** 3;
  };
  const ease = bezier(.45, 0, .2, 1), pop = bezier(.3, 1.35, .5, 1);
  const seg = (t, from, dur, f) => f(Math.min(1, Math.max(0, (t - from) / dur)));
  // As três lâminas abrem como o logo da Kiwi Init (T3898, roteiro.md › "A emenda com o prisma"): em escada na
  // diagonal para a direita e para cima (14 e 17 unidades por lâmina, no viewBox de 96 do logo, uns 51° da
  // horizontal), em leque (a borda longa a 17°, 21° e 24° da horizontal, de baixo para cima) e com a borda curta
  // encurtando (27,7 → 24,9 → 22,2), como páginas abrindo. A lâmina 2 é a de baixo, a 0 a de cima. UNIT converte
  // as unidades do logo para o palco (medido no ícone do Channels: o degrau é ~17% do comprimento da lâmina; a face aqui tem 520 px).
  // A lâmina do logo é comprida e fina (a borda curta é ~1/4 da longa); a face aqui é 520×320, então ela afina
  // (FINA) enquanto a pilha abre. A pilha fica centrada na lâmina do meio.
  // O harry quer 1:1 com o ícone do Channels (#3988): nele as três lâminas são paralelas, com a borda longa descendo
  // para a direita a ~28° na tela, e finas (uns 4,5:1). ANG é o ângulo na tela (negativo = desce para a direita).
  const GAP = 26, DEPTH = 11, END = 3.4, UNIT = 520 / 80, FINA = 0.45;
  const STEP = { x: 14 * UNIT, y: 17 * UNIT }, ANG = [-28, -28, -28], SHORT = [22.2 / 27.7, 24.9 / 27.7, 1];
  const pose = (t, slab, k) => {
    const up = seg(t, 1.55, 0.5, ease), turn = seg(t, 2.0, 0.6, ease);
    // Sem implosão (#4240): depois de abrir, a pilha se expande no ícone do Channels (2,6–3,1 s) e fica; a intro
    // termina nela, e o app abre.
    const out = seg(t, 2.0, 0.6, pop);
    const expand = 1 + 0.22 * seg(t, 2.6, 0.5, pop);
    const degrau = (1 - slab) * out;
    const sy = 1 + (FINA * SHORT[slab] - 1) * out;
    // O leque é o ângulo NA TELA. A rotação em X (58°·up) deita a pilha e achata o ângulo aplicado no plano (y vira
    // y·cos φ), então o ângulo no plano é atan(tan(alvo) / cos φ) (#3973: 17/21/24 saíam como 7/8/11).
    // A vista do ícone: a pilha menos deitada (40° em X) e virada um pouco em Y, para a espessura sair para baixo e
    // para a esquerda; e maior na tela (o logo ocupa ~60% do ícone).
    const TILT = 40, YAW = -16;
    // O ângulo da borda longa NA TELA, projetando os dois cantos de cima pela mesma cadeia do transform (rotateZ,
    // depois rotateY, depois rotateX, depois a perspectiva de 1700), e o giro no plano achado por bissecção para
    // dar o alvo: a inclinação em X e em Y achatam e torcem o que se aplica no plano (#3973).
    const rad = (d) => (d * Math.PI) / 180;
    const sc = 1 - 0.06 * up;
    const proj = (giroDeg) => {
      const tx = rad(TILT * up), ty = rad(YAW * up), tz = rad(-giroDeg);
      const pt = (x0, y0) => {
        const x = x0 * sc, y = y0 * sc * sy; // o scale(sx, sy) age antes do rotateZ
        let [X, Y, Z] = [x * Math.cos(tz) - y * Math.sin(tz), x * Math.sin(tz) + y * Math.cos(tz), 0];
        [X, Z] = [X * Math.cos(ty) + Z * Math.sin(ty), -X * Math.sin(ty) + Z * Math.cos(ty)];
        [Y, Z] = [Y * Math.cos(tx) - Z * Math.sin(tx), Y * Math.sin(tx) + Z * Math.cos(tx)];
        const wq = 1 - Z / 1700;
        return [X / wq, Y / wq];
      };
      const a = pt(-260, -160), c = pt(260, -160);
      return (Math.atan2(-(c[1] - a[1]), c[0] - a[0]) * 180) / Math.PI;
    };
    const alvo = ANG[slab] * turn;
    let lo = -80, hi = 80;
    for (let i = 0; i < 40; i++) { const mid = (lo + hi) / 2; if (proj(mid) < alvo) lo = mid; else hi = mid; }
    const giro = (lo + hi) / 2;
    const z = (slab === 0 ? GAP * out : slab === 2 ? -1 - (GAP - 1) * out : 0) - DEPTH * k;
    return `scale(${expand.toFixed(4)}) translate(${(STEP.x * degrau).toFixed(2)}px, ${(-STEP.y * degrau).toFixed(2)}px) perspective(1700px) translateY(${(30 * up).toFixed(2)}px) rotateX(${(TILT * up).toFixed(3)}deg) rotateY(${(YAW * up).toFixed(3)}deg) rotateZ(${(-giro).toFixed(3)}deg) scale(${(1 - 0.06 * up).toFixed(4)}, ${((1 - 0.06 * up) * sy).toFixed(4)}) translateZ(${z.toFixed(2)}px) translateX(${(-2 * k).toFixed(1)}px)`;
  };
  const scene = document.getElementById("scene");
  const layers = [];
  for (const slab of [2, 1, 0]) {
    for (const k of [4, 3, 2, 1, 0]) {
      const el = document.createElement("b");
      el.className = `ly s${slab} ${k ? `side k${k}` : "face"}`;
      if (!k) el.innerHTML = '<i class="band"></i><i class="shine"></i>';
      el.style.transform = pose(0, slab, k);
      scene.append(el);
      layers.push({ el, slab, k });
    }
  }
  let prism = [];
  const animatePrism = () => {
    for (const a of prism) a.cancel();
    prism = layers.map(({ el, slab, k }) => {
      const frames = [{ offset: 0, transform: pose(0, slab, k) }];
      for (let t = 1.5; t < END; t += 1 / 60) frames.push({ offset: t / END, transform: pose(t, slab, k) });
      frames.push({ offset: 1, transform: pose(END, slab, k) });
      return el.animate(frames, { duration: END * 1000, fill: "both" });
    });
  };

  // Os frames, para o medir.ts: o intervalo entre cada requestAnimationFrame.
  if (params.has("medir")) {
    const frames = (window.__frames = []);
    const tick = (t) => { frames.push(t); requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  }

  let timers = [];
  const later = (s, fn) => timers.push(setTimeout(fn, s * 1000));

  // A intro é só a do Kiwi Init (#4240): o prisma abre e se expande no ícone do Channels, e o app abre. O gato
  // (o #cat-layer que o gerar.ts embute) fica desligado; a intro dele está pausada (T3720).
  const FIM = 3.6;

  function play() {
    for (const t of timers) clearTimeout(t);
    timers = [];
    ending = false;
    document.body.classList.remove("done");
    stage.classList.remove("out");
    cat.classList.add("off", "paused");
    stage.classList.remove("play", "reduced");
    for (const el of outline.children) el.style.animation = "none";
    void stage.offsetWidth; // recomeça as animações do zero
    for (const el of outline.children) el.style.animation = el.dataset.anim;
    animatePrism();
    if (reduced) {
      // Reduzir movimento (do macOS ou da Aparência do app): o ícone pronto (a pose final do prisma), com o fade do
      // palco, e o app abre.
      stage.classList.add("reduced");
      for (const a of prism) { a.pause(); a.currentTime = END * 1000; }
      later(1.5, finish);
      return;
    }
    stage.classList.add("play");
    // O prisma termina expandido no ícone, e a intro acaba nele.
    later(FIM, finish);
  }

  let finished = false;
  // O fim vem uma vez por vez que toca: do último frame ou do clique para pular.
  let ending = false;
  function finish() {
    if (ending) return;
    ending = true;
    stage.classList.add("out");
    later(0.4, () => {
      document.body.classList.add("done");
      window.__done = true;
      // No app, o fim (o último frame, o clique para pular ou o "Reduzir movimento") abre o hub. Uma vez só.
      if (engine && !finished) {
        finished = true;
        engine.invoke("intro.done", {}).catch(() => {});
      }
    });
  }

  stage.addEventListener("click", () => { for (const t of timers) clearTimeout(t); timers = []; finish(); });
  document.getElementById("again").addEventListener("click", play);
  // A linha do tempo começa depois do 1º frame: a carga (pintar o gato parado, decodificar os bitmaps) não come o
  // começo da animação.
  // No app, pergunta antes ao engine pelo Movimento (no máximo 300 ms: a intro nunca espera mais que isso).
  const prefs = engine && engine.has && engine.has("settings.get")
    ? Promise.race([
        engine.invoke("settings.get", {}).then((s) => { if (s && s.appearance && s.appearance.motion === "reduced") reduced = true; }, () => {}),
        new Promise((r) => setTimeout(r, 300)),
      ])
    : Promise.resolve();
  if (params.has("t")) play();
  else prefs.then(() => requestAnimationFrame(() => requestAnimationFrame(play)));

  // ?t=2.4: congela o frame daquele instante (para a prancha), sem depender do relógio.
  if (params.has("t")) {
    const t = Number(params.get("t"));
    for (const x of timers) clearTimeout(x);
    timers = [];
    for (const a of document.getAnimations()) {
      a.pause();
      a.currentTime = Math.max(0, t * 1000);
    }
  }
})();
