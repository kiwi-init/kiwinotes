// A linha do tempo da intro (T2113, T2308). O gerar.ts põe este script dentro do intro.html (o protótipo, que abre
// sozinho no navegador) e copia para app/ui/intro/intro.js (a janela `intro` do app, onde a CSP das views não deixa
// script inline). No app há o `window.engine` do AppEngine: o script avisa que subiu (`ready`) e, no fim, chama o
// `intro.done`, e o main fecha a janela e abre o hub.
(() => {
  const params = new URLSearchParams(location.search);
  const stage = document.getElementById("stage");
  const fit = document.getElementById("fit");
  const cat = document.getElementById("cat-layer");
  const orb = document.getElementById("orb");
  // O "Reduzir movimento" do macOS, ou o Movimento "Reduzido" da Aparência do app (T2503): a cópia que as janelas
  // guardam, na hora, e o valor do engine antes de a linha do tempo começar.
  let reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  try {
    if (JSON.parse(localStorage.getItem("kn-appearance") || "null")?.motion === "reduced") reduced = true;
  } catch {}
  // No app: a UI subiu (o AppEngine conta o boot como bom; sem isso, em 5 s ele volta para a UI anterior).
  const engine = window.engine;
  engine?.ready();
  const catSpeed = Number(params.get("gato")) || 1;

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
  const ease = bezier(.45, 0, .2, 1), pop = bezier(.3, 1.35, .5, 1), implode = bezier(.6, 0, .9, .4);
  const seg = (t, from, dur, f) => f(Math.min(1, Math.max(0, (t - from) / dur)));
  const GAP = 78, DEPTH = 8, END = 3.35;
  const pose = (t, slab, k) => {
    const up = seg(t, 1.55, 0.5, ease), turn = seg(t, 2.0, 0.6, ease);
    const out = seg(t, 2.0, 0.6, pop) * (1 - seg(t, 2.68, 0.28, implode));
    const z = (slab === 0 ? GAP * out : slab === 2 ? -1 - (GAP - 1) * out : 0) - DEPTH * k;
    return `perspective(1700px) translateY(${(30 * up).toFixed(2)}px) rotateX(${(58 * up).toFixed(3)}deg) rotateZ(${(-34 * turn).toFixed(3)}deg) scale(${(1 - 0.18 * up).toFixed(4)}) translateZ(${z.toFixed(2)}px)`;
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

  // O Kiwi-cat do Rive (T3154): na janela do app, com o `kiwi-cat.riv` no pack, o app/ui/intro/rive.ts põe aqui o gato
  // do Rive, que toca no lugar do gato em SVG e avisa quando acaba. Sem ele (o protótipo, ou o pack sem o .riv), nada
  // muda. No "Reduzir movimento" e no `?t=` fica o SVG.
  const riveCat = !params.has("t") && window.kiwiRiveCat;

  function startCat() {
    cat.classList.remove("paused");
    if (catSpeed !== 1) for (const a of cat.getAnimations({ subtree: true })) a.playbackRate = catSpeed;
  }

  function play() {
    for (const t of timers) clearTimeout(t);
    timers = [];
    document.body.classList.remove("done");
    stage.classList.remove("out");
    cat.classList.add("off", "paused");
    orb.classList.remove("grow");
    stage.classList.remove("play");
    for (const el of outline.children) el.style.animation = "none";
    void stage.offsetWidth; // recomeça as animações do zero
    cat.classList.remove("off");
    for (const el of outline.children) el.style.animation = el.dataset.anim;
    if (reduced) {
      startCat();
      later(2.5, finish);
      return;
    }
    stage.classList.add("play");
    animatePrism();
    // 3,7 s: a bola cresce junto com o círculo do gato (o circleIn dele), e o gato começa.
    if (riveCat) {
      later(3.7, () => {
        orb.classList.add("grow");
        riveCat.start(finish).then((ok) => {
          if (ok) { cat.classList.add("off"); return; }
          // O Rive não carregou: fica o gato em SVG, no tempo dele.
          startCat();
          later(8.4 / catSpeed, finish);
        });
      });
      return;
    }
    later(3.7, () => { orb.classList.add("grow"); startCat(); });
    // O gato termina a abertura em ~7,8 s (no ritmo dele) e fica um instante pronto.
    later(3.7 + 8.4 / catSpeed, finish);
  }

  let finished = false;
  function finish() {
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
    if (t >= 3.7 && !reduced) { orb.classList.add("grow"); startCat(); }
    for (const a of document.getAnimations()) {
      a.pause();
      const target = a.effect && a.effect.target;
      const inCat = cat.contains(target);
      const late = t >= 3.7 && (inCat || target === orb);
      a.currentTime = inCat && t < 3.7 ? 0 : Math.max(0, (late ? (t - 3.7) * (inCat ? catSpeed : 1) : t) * 1000);
    }
  }
})();
