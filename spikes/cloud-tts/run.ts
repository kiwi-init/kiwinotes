// A rodada do laboratório (spec #30991): cada fala inventada, pelo filtro e pelo fala.ts, em cada voz de cada provedor,
// N rodadas; a tabela no fim e o áudio numa pasta ao lado de docs/design/voices/ (sem commit).
//
//   bun run.ts [--providers google,elevenlabs,local] [--rounds 3] [--only pt01,en01] [--out <pasta>]
//              [--voices <id>[:nome],<id>…]   (as vozes do ElevenLabs no lugar das fixas; ou ELEVENLABS_VOICES)
//
// As credenciais vêm só do ambiente (veja google.ts, elevenlabs.ts e local.ts). No fim, a rodada confere que nenhum valor
// delas aparece no que ela imprimiu nem nos arquivos que gravou; se aparecer, diz onde (nunca o valor) e sai com 1.

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";

import { measure, type Measure, prepare, table } from "./core.ts";
import { elevenLabs } from "./elevenlabs.ts";
import { FALAS } from "./falas.ts";
import { googleProvider } from "./google.ts";
import { localProvider, realVoices } from "./local.ts";
import type { TtsProvider } from "./provider.ts";

/** As variáveis com credencial: os valores delas não podem sair. */
export const SECRET_ENV = ["GOOGLE_TTS_API_KEY", "ELEVENLABS_API_KEY"];

/** Onde um valor secreto aparece: `saída` ou o caminho do arquivo. Nunca devolve o valor. */
export function leaks(values: string[], printed: string, dir: string): string[] {
  const vs = values.filter((v) => v.length >= 8);
  if (!vs.length) return [];
  const where: string[] = [];
  if (vs.some((v) => printed.includes(v))) where.push("saída");
  for (const f of readdirSync(dir, { recursive: true }) as string[]) {
    const full = path.join(dir, f);
    let body: string;
    try {
      body = readFileSync(full).toString("latin1");
    } catch {
      continue; // uma pasta
    }
    if (vs.some((v) => body.includes(v))) where.push(f);
  }
  return where;
}

export async function main(argv = process.argv.slice(2), env = process.env): Promise<number> {
  const { values: a } = parseArgs({
    args: argv,
    options: { providers: { type: "string", default: "google,elevenlabs,local" }, rounds: { type: "string", default: "3" }, only: { type: "string" }, out: { type: "string" }, voices: { type: "string" } },
  });
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
  const out = path.resolve(a.out ?? path.join(import.meta.dir, "../../docs/design/voices-cloud", stamp));
  mkdirSync(out, { recursive: true });
  let printed = "";
  const say = (s: string) => {
    printed += `${s}\n`;
    console.log(s);
  };

  const stops: (() => Promise<void>)[] = [];
  const providers: TtsProvider[] = [];
  for (const name of a.providers!.split(",").map((s) => s.trim())) {
    try {
      if (name === "google") providers.push(googleProvider(env));
      else if (name === "elevenlabs") providers.push(elevenLabs({ env, log: say, voices: a.voices }));
      else if (name === "local") {
        const v = realVoices(env);
        stops.push(v.stop);
        providers.push(localProvider(v.synth));
      } else say(`provedor desconhecido: ${name}`);
    } catch (e) {
      say(`${name}: fora desta rodada (${(e as Error).message.split("\n")[0]})`);
    }
  }

  const only = a.only ? new Set(a.only.split(",")) : null;
  const rows: Measure[] = [];
  try {
    // A conferência de cada conta antes da primeira fala: um problema para a rodada sem gastar crédito.
    for (const p of providers) {
      try {
        await p.check?.();
      } catch (e) {
        say(`${p.name}: ${(e as Error).message.split("\n")[0]}`);
        say("nada foi gerado; acerte a chave ou a voz e rode de novo");
        return 2;
      }
    }
    for (const fala of FALAS.filter((f) => !only || only.has(f.id))) {
      const { text, held } = prepare(fala.text, fala.lang);
      if (held) say(`${fala.id}: o filtro tirou ${held} segredo(s) antes de enviar`);
      for (const p of providers) {
        for (const voice of p.voices(fala.lang)) {
          const m = await measure(p, voice, { id: fala.id, text }, { rounds: Number(a.rounds), out });
          rows.push(m);
          say(
            m.error
              ? `${p.name} ${voice.name} ${fala.id}: erro: ${m.error}`
              : `${p.name} ${voice.name} ${fala.id}: primeiro som ${Math.round(m.firstMs)} ms, total ${Math.round(m.totalMs)} ms, ${m.chars} caracteres${m.deleted !== undefined ? `, ${m.deleted} geração(ões) apagada(s)` : ""}`,
          );
        }
      }
    }
  } finally {
    for (const s of stops) await s();
  }

  say("");
  say(table(rows));
  writeFileSync(path.join(out, "medidas.json"), JSON.stringify(rows, null, 2));
  writeFileSync(path.join(out, "tabela.md"), `${table(rows)}\n`);
  say(`\náudio e medidas em ${out}`);

  const where = leaks(SECRET_ENV.map((k) => env[k] ?? ""), printed, out);
  if (where.length) {
    console.error(`credencial encontrada em: ${where.join(", ")}`);
    return 1;
  }
  console.log("credenciais: nenhuma na saída nem nos arquivos");
  return 0;
}

if (import.meta.main) process.exit(await main());
