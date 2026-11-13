// T10437: exact Canvas Path2D curves from the owner's approved reference.
// Source: docs/brand/kiwi-cat/simbolos/simbolos2.html, function sym (100x100).
// Geometry and placement are fixed; gesture timing is owned by gestures.ts.
import type { FogState } from './state';
export type SymbolBackground = 'light' | 'dark';
export interface SymbolShape { state: FogState; body: string; box: readonly [number,number,number]; pivot: readonly [number,number]; part?: number }
const path = (d:string,attrs='')=>`<path d="${d}" ${attrs}/>`;
const circle = (cx:number,cy:number,r:number,attrs='')=>`<circle cx="${cx}" cy="${cy}" r="${r}" ${attrs}/>`;
const stroke = (d:string,width:number)=>path(d,`fill="none" stroke="currentColor" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round"`);
// Reference panels draw the cat at (20,oy), 280x350. These boxes are the
// reference's exact symbol placements expressed back in 2048x2560 coordinates.
const box = (x:number,y:number,size:number):readonly[number,number,number]=>[(x-20)*2048/280,y*2560/350,size*2048/280];
const common=box(222,30,78),listen=box(246,120,62),thought=box(208,22,96),drops=box(228,70,70),lines=box(4,96,58),stars=box(214,56,84);
// Same four circles, rectangle and tail circles as sym(), in one compound paint.
// WebKit otherwise applies a partial group mask separately at overlaps.
const cloud='M50 44 A20 20 0 1 1 10 44 A20 20 0 1 1 50 44 Z M78 34 A26 26 0 1 1 26 34 A26 26 0 1 1 78 34 Z M95 46 A19 19 0 1 1 57 46 A19 19 0 1 1 95 46 Z M74 54 A22 22 0 1 1 30 54 A22 22 0 1 1 74 54 Z M30 44 H76 V64 H30 Z M31 80 A7 7 0 1 1 17 80 A7 7 0 1 1 31 80 Z M15 93 A4 4 0 1 1 7 93 A4 4 0 1 1 15 93 Z';
const star='M0 -22 Q3 -3 22 0 Q3 3 0 22 Q-3 3 -22 0 Q-3 -3 0 -22 Z';
const drop='M0 -18 C8 -6 12 1 12 7 A12 12 0 1 1 -12 7 C-12 1 -8 -6 0 -18 Z';
export const ERROR_PATH='M10 54 C16 14 44 10 46 40 S18 82 40 80 S76 16 62 20 S50 74 76 70 S96 36 84 30';
export const SYMBOL_SHAPES:readonly SymbolShape[]=[
 {state:'acordou',box:common,pivot:[50,50],body:`<g transform="rotate(11.459155902616466 50 50)">${path('M38 12 C38 5 62 5 62 12 L56 60 C55 67 45 67 44 60 Z')}${circle(50,84,9)}${stroke('M74 30 L90 20 M77 48 L95 48',7)}</g>`},
 {state:'dormindo',box:common,pivot:[50,50],body:`<g transform="rotate(-8.021409131831525 50 50)">${stroke('M14 60 H36 L14 86 H36',8)}${stroke('M46 14 H86 L46 60 H86',11)}</g>`},
 {state:'ouvindo',box:listen,pivot:[8,50],part:0,body:stroke('M23.0361145828179 36.81230656057054 A20 20 0 0 1 23.0361145828179 63.18769343942946',9)},
 {state:'ouvindo',box:listen,pivot:[8,50],part:1,body:stroke('M38.0722291656358 23.62461312114108 A40 40 0 0 1 38.0722291656358 76.37538687885892',9)},
 {state:'ouvindo',box:listen,pivot:[8,50],part:2,body:stroke('M53.1083437484537 10.43691968171162 A60 60 0 0 1 53.1083437484537 89.56308031828838',9)},
 {state:'thinking',box:thought,pivot:[50,50],body:`<defs><mask id="__THINKING_MASK__" maskUnits="userSpaceOnUse" x="-10" y="-10" width="120" height="120" style="mask-type:luminance"><rect x="-10" y="-10" width="120" height="120" fill="white"/>${[34,53,72].map((cx,i)=>circle(cx,46,5.5,`data-dot="${i}" fill="black"`)).join('')}</mask></defs><g mask="url(#__THINKING_MASK__)">${path(cloud)}</g>`},
 {state:'agindo',box:drops,pivot:[38,56.5],part:0,body:`<g transform="translate(38 34) scale(1.25)">${path(drop)}</g>`},
 {state:'agindo',box:drops,pivot:[72,84],part:1,body:`<g transform="translate(72 66)">${path(drop)}</g>`},
 {state:'agindo',box:lines,pivot:[92,50],part:2,body:stroke('M30 22 H92 M10 50 H92 M40 78 H92',8)},
 ...([[40,44,1.5],[80,20,.75],[78,78,.6]] as const).map(([cx,cy,scale]):SymbolShape=>({state:'pronto',box:stars,pivot:[cx,cy],body:`<g transform="translate(${cx} ${cy}) scale(${scale})">${path(star)}</g>`})),
 {state:'erro',box:common,pivot:[50,50],body:path(ERROR_PATH,'data-scribble="" fill="none" stroke="currentColor" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"')},
];
