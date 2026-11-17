// Conta os quadros desenhados e o tempo de JS de cada um (T14773). Um quadro é um callback (rAF ou timer) que chamou
// pelo menos um draw do WebGL2; o tempo é o do callback inteiro, na thread principal. A GPU (software, no headless)
// fica fora deste tempo e entra na CPU medida por processo.
let drew = false;
const frames: number[] = []; // [instante (ms), duração (ms)] intercalados
for (const name of ["drawArrays", "drawElements", "drawArraysInstanced", "drawElementsInstanced"] as const) {
  const proto = WebGL2RenderingContext.prototype as any;
  const original = proto[name];
  proto[name] = function (...args: unknown[]) { drew = true; return original.apply(this, args); };
}
const wrap = (fn: Function) => function (this: unknown, ...args: unknown[]) {
  drew = false;
  const start = performance.now();
  try { return fn.apply(this, args); } finally {
    if (drew) frames.push(start, performance.now() - start);
  }
};
const raf = window.requestAnimationFrame.bind(window);
window.requestAnimationFrame = (cb) => raf(wrap(cb) as FrameRequestCallback);
const timeout = window.setTimeout.bind(window);
(window as any).setTimeout = (cb: unknown, ms?: number, ...rest: unknown[]) =>
  typeof cb === "function" ? timeout(wrap(cb) as TimerHandler, ms, ...rest) : timeout(cb as TimerHandler, ms, ...rest);
Object.assign(window, {
  kiwiFrames: {
    reset() { frames.length = 0; },
    read() { return frames.slice(); },
  },
});
