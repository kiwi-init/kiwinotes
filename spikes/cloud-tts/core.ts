// O núcleo do laboratório (spec #30991, T31095): o texto sai como no app, e cada fala é medida.
//
// - **O texto:** o filtro de segredos do guardrail (`SecretGuard.request`, o mesmo do pedido da pessoa), os marcadores
//   `‹segredo…›` fora, e o `fala.ts`: em pt, o `frasesParaFala` inteiro (números, datas e siglas por extenso); em en,
//   só o `semMarkdown` e o corte por frase, porque o resto do `fala.ts` escreve os números em português.
// - **As medidas:** o tempo até o primeiro pedaço de áudio e o total, a mediana de N rodadas, os caracteres e o custo.
// - **O áudio** da última rodada vai para um arquivo, por provedor e voz. O `pcm16` vira .wav.

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { cortarFrases, frasesParaFala, semMarkdown } from "../../app/src/agent/fala.ts";
import { MARKER, SecretGuard } from "../../app/src/guardrail/filter.ts";
import type { Lang, Synthesis, TtsProvider, Voice } from "./provider.ts";

export interface Prepared {
  /** O que vai ao provedor. */
  text: string;
  /** Quantos segredos o filtro segurou (e saíram). */
  held: number;
}

/** O texto como o app o falaria, sem segredo nenhum. Vazio quando não sobra nada para falar. */
export function prepare(raw: string, lang: Lang): Prepared {
  const filtered = new SecretGuard().request(raw);
  const semMarcador = filtered.text.replace(MARKER, " ");
  const frases =
    lang === "pt-BR"
      ? frasesParaFala(semMarcador)
      : cortarFrases(
          semMarkdown(semMarcador)
            .split(/\n+/)
            .map((l) => l.trim())
            .filter(Boolean)
            .map((l) => (/[.!?…:;,]$/.test(l) ? l : `${l}.`))
            .join(" ")
            .replace(/\s{2,}/g, " "),
        );
  return { text: frases.join(" "), held: filtered.held };
}

export interface Round {
  firstMs: number;
  totalMs: number;
  bytes: number;
}

export interface Measure {
  provider: string;
  voice: string;
  fala: string;
  lang: Lang;
  /** Medianas das rodadas. */
  firstMs: number;
  totalMs: number;
  rounds: Round[];
  chars: number;
  costUsd: number;
  deleted?: number;
  /** Rodadas cuja geração ficou no histórico do provedor (o apagar falhou ou não achou). */
  notDeleted?: number;
  file?: string;
  error?: string;
}

export const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};

/** Uma rodada: lê o áudio inteiro, marca o primeiro pedaço e o fim, e espera a limpeza do provedor. */
export async function oneRound(s: () => Synthesis, now = () => performance.now()): Promise<{ round: Round; chunks: Uint8Array[]; syn: Synthesis; done: { chars: number; deleted?: number } }> {
  const t0 = now();
  const syn = s();
  let first = -1;
  const chunks: Uint8Array[] = [];
  try {
    for await (const c of syn.audio) {
      if (first < 0) first = now() - t0;
      chunks.push(c);
    }
  } catch (e) {
    // Espera a limpeza do provedor antes de subir o erro: sem isso o `done` rejeita solto, e o que ela marca no
    // erro (as gerações que ficaram na conta) não chega ao aviso da tabela.
    await syn.done.catch(() => {});
    throw e;
  }
  const total = now() - t0;
  const done = await syn.done;
  return { round: { firstMs: first < 0 ? total : first, totalMs: total, bytes: chunks.reduce((n, c) => n + c.length, 0) }, chunks, syn, done };
}

/** O .wav de um PCM 16 bits mono. */
export function wav(pcm: Uint8Array, sampleRate: number): Uint8Array {
  const out = new Uint8Array(44 + pcm.length);
  const v = new DataView(out.buffer);
  const s = (o: number, t: string) => [...t].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  s(0, "RIFF");
  v.setUint32(4, 36 + pcm.length, true);
  s(8, "WAVE");
  s(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  s(36, "data");
  v.setUint32(40, pcm.length, true);
  out.set(pcm, 44);
  return out;
}

const join = (chunks: Uint8Array[]) => {
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
};

/** Um nome de arquivo sem nada estranho. */
const slug = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9-]+/g, "-").replace(/^-|-$/g, "");

/**
 * Mede uma fala numa voz: N rodadas, a mediana, e o áudio da última em `out/<provedor>/<voz>/<fala>.<ext>`. Um erro do
 * provedor vira a linha com `error`, sem derrubar as outras falas.
 */
export async function measure(p: TtsProvider, voice: Voice, fala: { id: string; text: string }, o: { rounds: number; out?: string }): Promise<Measure> {
  const base: Measure = { provider: p.name, voice: voice.name, fala: fala.id, lang: voice.lang, firstMs: 0, totalMs: 0, rounds: [], chars: 0, costUsd: 0 };
  let notDeleted = 0;
  try {
    let last: Awaited<ReturnType<typeof oneRound>> | null = null;
    let deleted = 0;
    let chars = 0;
    for (let i = 0; i < o.rounds; i++) {
      last = await oneRound(() => p.synthesize(fala.text, voice));
      base.rounds.push(last.round);
      chars += last.done.chars;
      deleted += last.done.deleted ?? 0;
      if (last.done.deleted === 0) notDeleted++;
    }
    base.firstMs = median(base.rounds.map((r) => r.firstMs));
    base.totalMs = median(base.rounds.map((r) => r.totalMs));
    // Os caracteres e o custo de uma fala (uma rodada); as N rodadas gastam N vezes isso.
    base.chars = Math.round(chars / o.rounds);
    base.costUsd = base.chars * p.costPerChar;
    if (last && last.done.deleted !== undefined) {
      base.deleted = deleted;
      base.notDeleted = notDeleted;
    }
    if (o.out && last) {
      const dir = path.join(o.out, p.name, slug(voice.name));
      mkdirSync(dir, { recursive: true });
      const audio = join(last.chunks);
      const ext = last.syn.format === "pcm16" ? "wav" : last.syn.format;
      const file = path.join(dir, `${fala.id}.${ext}`);
      writeFileSync(file, last.syn.format === "pcm16" ? wav(audio, last.syn.sampleRate ?? 24_000) : audio);
      base.file = path.relative(o.out, file);
    }
  } catch (e) {
    base.error = (e as Error).message.split("\n")[0]!.slice(0, 200);
    // As rodadas que já ficaram na conta, mais a que falhou sem conseguir apagar, entram no aviso da tabela.
    const left = notDeleted + ((e as { notDeleted?: number }).notDeleted ?? 0);
    if (left) base.notDeleted = left;
  }
  return base;
}

const ms = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(2)} s` : `${Math.round(n)} ms`);

/** A tabela do canal: uma linha por provedor e língua, com as medianas de todas as falas e vozes. */
export function table(rows: Measure[]): string {
  const groups = new Map<string, Measure[]>();
  for (const r of rows) {
    const k = `${r.provider}\u0000${r.lang}`;
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  const out = ["| Provedor | Língua | Primeiro som (mediana) | Total (mediana) | Caracteres por fala | Custo por fala | Falhas |", "|---|---|---|---|---|---|---|"];
  for (const [k, rs] of groups) {
    const [provider, lang] = k.split("\u0000");
    const ok = rs.filter((r) => !r.error);
    const chars = ok.length ? Math.round(median(ok.map((r) => r.chars))) : 0;
    const cost = ok.length ? median(ok.map((r) => r.costUsd)) : 0;
    out.push(
      `| ${provider} | ${lang} | ${ok.length ? ms(median(ok.map((r) => r.firstMs))) : "-"} | ${ok.length ? ms(median(ok.map((r) => r.totalMs))) : "-"} | ${chars} | US$ ${cost.toFixed(5)} | ${rs.length - ok.length} de ${rs.length} |`,
    );
  }
  // O aviso das gerações que ficaram na conta: o áudio está salvo, mas falta apagar à mão.
  const left = new Map<string, number>();
  for (const r of rows) if (r.notDeleted) left.set(r.provider, (left.get(r.provider) ?? 0) + r.notDeleted);
  for (const [provider, n] of left) out.push("", `Aviso: ${n} ${n === 1 ? "fala não apagada" : "falas não apagadas"} do histórico do ${provider}.`);
  return out.join("\n");
}
