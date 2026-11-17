// A posição e o tamanho do gato no overlay (spec #12949), como a página lê da URL que o helper monta
// (`CatPlacement.query` em native/Sources/KiwiHelperCore/CatOverlayModel.swift). A janela é a do helper: o gato
// (192 × 240 vezes a escala) e o espaço do balão, em cima do gato ou embaixo dele (os cantos de cima).
//
// T16754 (harry #16786): o balão fica ao lado do gato, com o rabo na quina mais perto dele e a ponta encostada no
// corpo. À esquerda do gato (o canto da direita e o centro) ou à direita dele (os cantos da esquerda). A janela fica
// mais larga do lado do balão, o quanto ele passa do quadro do gato (`overhang`): a mesma conta do Swift
// (`CatPlacement.overhang`), para a página e a janela terem a mesma largura.
import { CAT_BODY, TAIL_TIP, type TailSide } from "../kiwicat-v2/bubbleTail";

export const CAT_W = 192;
export const CAT_H = 240;
export const BUBBLE_W = 300;
export const BUBBLE_H = 112;
export const MIN_SCALE = 0.6;
export const MAX_SCALE = 1.6;

export interface OverlayPlacement {
  scale: number;
  catW: number;
  catH: number;
  winW: number;
  winH: number;
  /** De que lado da tela o gato fica. */
  lado: "left" | "center" | "right";
  /** O balão em cima do gato, ou embaixo (os cantos de cima). */
  balao: "acima" | "abaixo";
  /** Onde o quadro do gato começa na janela, da esquerda. */
  catX: number;
  /** A quina do balão de onde sai o rabo. */
  tail: TailSide;
  /** O lugar da casca na janela, em px: um lado na horizontal e um na vertical, os outros ficam `auto`. */
  bubble: { left?: number; right?: number; top?: number; bottom?: number };
}

/** Quanto o balão (300) passa do quadro do gato, para o lado dele, com a ponta encostada no corpo. */
export function overhang(catW: number, bubbleLeft: boolean): number {
  const inside = catW * (bubbleLeft ? CAT_BODY.x0 : 1 - CAT_BODY.x1) + TAIL_TIP.x;
  return Math.max(0, Math.ceil(BUBBLE_W - inside));
}

const tenth = (n: number) => Math.round(n * 10) / 10;

/** O que a URL diz; o que falta ou está fora dos limites fica como antes (1×, no centro, o balão em cima). */
export function overlayPlacement(query: URLSearchParams): OverlayPlacement {
  const raw = Number(query.get("escala") ?? "1");
  const scale = Number.isFinite(raw) ? Math.min(Math.max(raw, MIN_SCALE), MAX_SCALE) : 1;
  const catW = Math.round(CAT_W * scale);
  const catH = Math.round(CAT_H * scale);
  const l = query.get("lado");
  const lado = l === "left" || l === "right" ? l : "center";
  const balao = query.get("balao") === "abaixo" ? "abaixo" : "acima";
  // O balão à esquerda do gato, menos nos cantos da esquerda.
  const bubbleLeft = lado !== "left";
  const extra = overhang(catW, bubbleLeft);
  const catX = bubbleLeft ? extra : 0;
  const tail: TailSide = `${balao === "abaixo" ? "top" : "bottom"}-${bubbleLeft ? "right" : "left"}`;
  const bubble: OverlayPlacement["bubble"] = {
    // A ponta na borda do corpo do lado do balão, e a casca 7,5 px além dela.
    ...(bubbleLeft ? { right: tenth(catW * (1 - CAT_BODY.x0) - TAIL_TIP.x) } : { left: tenth(catW * CAT_BODY.x1 - TAIL_TIP.x) }),
    // Em cima: a ponta no alto do corpo (o gato encosta embaixo da janela); embaixo: no pé dele (o gato encosta em cima).
    ...(balao === "abaixo" ? { top: tenth(catH * CAT_BODY.y1 + TAIL_TIP.y) } : { bottom: tenth(catH * (1 - CAT_BODY.y0) + TAIL_TIP.y) }),
  };
  return { scale, catW, catH, winW: catW + extra, winH: catH + BUBBLE_H, lado, balao, catX, tail, bubble };
}
