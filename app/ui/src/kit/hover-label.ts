// O nome do hover que cresce por cima (T26124, spec #26101): o botão guarda a largura de só ícone, e o nome abre numa
// camada por cima dos vizinhos, para o lado com espaço. Aqui só a medida; o movimento é todo do kit.css.

export type GrowSide = "left" | "right";

/**
 * Para que lado a camada cresce. `left` e `right` são o espaço livre de cada lado, da borda oposta do botão até a borda
 * de quem corta (a barra que rola, ou a janela); `width` é a largura da camada aberta. A direita, se cabe; senão a
 * esquerda, se cabe; se não cabe em nenhum, o lado com mais espaço.
 */
export function growSide(left: number, right: number, width: number): GrowSide {
  if (width <= right) return "right";
  if (width <= left) return "left";
  return left > right ? "left" : "right";
}

/** O primeiro ancestral que corta na horizontal (a barra lateral rola, e o overflow dela corta dos lados também). */
function clipBox(el: HTMLElement): { left: number; right: number } {
  for (let at = el.parentElement; at && at !== document.body; at = at.parentElement) {
    if (getComputedStyle(at).overflowX !== "visible") return at.getBoundingClientRect();
  }
  return { left: 0, right: document.documentElement.clientWidth };
}

/**
 * Antes de abrir (no `pointerenter` e no foco, dentro da espera de entrada): a largura de só ícone e o raio do botão,
 * que o recorte da camada usa, e o lado (`data-grow`). O `:hover` já vale quando o evento chega; se o lado ou a medida
 * mudam, a transição sairia do recorte velho (do outro lado). Então a camada fica fechada, sem transição, no lado novo
 * (`data-placing`), o estilo se assenta, e só aí ela abre.
 */
export function placeHoverLabel(button: HTMLElement, label: HTMLElement): void {
  const b = button.getBoundingClientRect();
  const base = `${b.width}px`;
  const radius = getComputedStyle(button).borderTopLeftRadius || "0px";
  button.dataset.placing = "";
  button.style.setProperty("--kn-expand-base", base);
  button.style.setProperty("--kn-expand-r", radius);
  const clip = clipBox(button);
  const side = growSide(b.right - clip.left, clip.right - b.left, label.offsetWidth);
  if (button.dataset.grow === side && label.dataset.base === base && label.dataset.radius === radius) {
    delete button.dataset.placing;
    return;
  }
  button.dataset.grow = side;
  label.dataset.base = base;
  label.dataset.radius = radius;
  void getComputedStyle(label).clipPath; // assenta o fechado no lado novo
  delete button.dataset.placing;
}
