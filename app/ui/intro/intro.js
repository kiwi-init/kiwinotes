// Gerado por docs/brand/intro/gerar.ts; edite docs/brand/intro/intro.js.
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

  // T3720: the same pose functions as the approved T3747 storyboard. Assets
  // are baked once; runtime changes only transform, opacity and mask position.
  const CAT_S = 8.0;
  const smooth = (a, b, value) => {
    const t = Math.min(1, Math.max(0, (value-a)/(b-a)));
    return t*t*(3-2*t);
  };
  const interpolate = (x, points) => {
    for (let i=1; i<points.length; i++) {
      if (x <= points[i][0]) {
        const [a, va] = points[i-1], [b, vb] = points[i];
        return va+(vb-va)*Math.min(1, Math.max(0, (x-a)/(b-a)));
      }
    }
    return points.at(-1)[1];
  };
  let catAnimations = [];
  const animateCat = () => {
    for (const a of catAnimations) a.cancel();
    catAnimations = [];
    const poses = (id, pose) => {
      const frames = Array.from({length:481}, (_, f) => ({offset:f/480, ...pose(f)}));
      const animation = document.getElementById(id).animate(frames, {duration:CAT_S*1000, fill:"both"});
      animation.pause();
      animation.currentTime = 0;
      catAnimations.push(animation);
    };
    const head = f => smooth(112,208,f);
    const formed = f => smooth(270,410,f);
    poses("luz-anel", f => ({opacity:smooth(6,48,f)*(1-smooth(150,340,f)), transform:`rotate(${f*.62}deg)`}));
    poses("luz-cabeca", f => ({opacity:smooth(6,48,f)*head(f)}));
    poses("fundo-cabeca", () => ({opacity:0}));
    poses("cabeca", () => ({opacity:0}));
    poses("cabeca-complemento", f => ({opacity:formed(f)}));
    // #4063: the circle IS the head. One persistent face changes shape;
    // a second head never fades in behind it.
    poses("vidro", f => {
      const p=head(f);
      return {opacity:1, transform:`translate(${2*p}px,${-11*p}px) scale(${1-p/15},${1-p*(1-354/450)})`};
    });
    // Reveal density throughout the fog, without a horizontal scan edge.
    for (const id of ["corpo", "corpo-final"]) {
      const layer=document.getElementById(id);
      layer.classList.remove("body-reveal");
      poses(id, f => ({opacity:formed(f)}));
    }
    for (const [id,start,sign] of [["orelha-esquerda",96,-1],["orelha-direita",112,1]]) {
      poses(id, f => {
        const t=Math.max(0,(f-start)/54);
        const angle=interpolate(t,[[0,20],[.72,-2],[.9,1],[1,0]]);
        const scale=.82+.18*smooth(0,1,t);
        return {opacity:smooth(0,1,t), transform:`rotate(${sign*angle}deg) scale(${scale})`};
      });
    }
    poses("cat-final", f => ({opacity:smooth(325,450,f)}));
    // #4031: drift through the formation rather than hold rigid intermediate
    // poses. Move the whole composition together, preserving body proportions.
    poses("cat-float", f => ({transform:`translateY(${-5*Math.sin(f/480*Math.PI*2)*Math.sin(f/480*Math.PI)}px)`}));
    const eyes = [[0,0],[159,0],[160,0],[163,.06],[181,.22],[196,.22],[204,.04],[212,.04],
      [228,.45],[234,.45],[239,.05],[244,.45],[248,.45],[262,1.04],[268,1],[480,1]];
    for (const id of ["olho-esq","olho-dir"]) poses(id, f => {
      const p=smooth(248,268,f), growth=.8+.2*p, open=interpolate(f,eyes);
      return {opacity:open>0 ? 1 : 0, transform:`translateY(${(1-p)*8}px) scale(${growth},${growth*open})`};
    });
  };

  function startCat() {
    cat.classList.add("ready");
    document.body.classList.add("cat-started");
    for (const a of catAnimations) {
      a.playbackRate = catSpeed;
      if (reduced) { a.pause(); a.currentTime=CAT_S*1000; }
      else a.play();
    }
  }

  function play() {
    for (const t of timers) clearTimeout(t);
    timers = [];
    ending = false;
    document.body.classList.remove("done", "cat-started");
    cat.classList.remove("ready");
    stage.classList.remove("out");
    cat.classList.add("off", "paused");
    orb.classList.remove("grow");
    stage.classList.remove("play");
    for (const el of outline.children) el.style.animation = "none";
    void stage.offsetWidth; // recomeça as animações do zero
    cat.classList.remove("off");
    animateCat();
    for (const el of outline.children) el.style.animation = el.dataset.anim;
    if (reduced) {
      document.getElementById("base").style.opacity="1";
      startCat();
      later(2.5, finish);
      return;
    }
    stage.classList.add("play");
    animatePrism();
    // 3,7 s: a emenda. A bola cresce até o círculo de vidro do gato (R 225), e os beats começam.
    later(3.7, () => { orb.classList.add("grow"); startCat(); });
    // f480: o gato está na pose final, e a intro termina.
    later(3.7 + CAT_S / catSpeed, finish);
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
