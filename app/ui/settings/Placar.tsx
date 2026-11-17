// O placar de hoje (ADR 0013, "O placar"; T14671), em Ajustes › Agente, junto do gasto: as idas, os tokens nas cinco
// partes, quantas vezes a Bússola achou o alvo de primeira e quanto do limite de 5 horas o dia gastou. Só no Mac.

import type { AgentPlacarView } from "../../src/shared/ui-contract.ts";
import { Section } from "../src/kit/index.tsx";
import { acharLerLine, cartoes, curto, PARTES, porcentos, seloFaro } from "./placarText.ts";
import { at } from "./usageText.ts";

export function Placar({ v, now }: { v: AgentPlacarView; now: number }) {
  const pc = porcentos(v.partes);
  return (
    <Section title="O placar de hoje">
      <div className="kn-placar" data-testid="placar">
        {/* Num dia sem pedido (revisão do T14671), só a lista: os cartões e a barra em zero não dizem nada. */}
        {v.pedidos > 0 ? (
          <>
            <div className="kn-placar-cards">
              {cartoes(v).map((c) => (
                <div className="kn-placar-card" key={c.label}>
                  <div className="kn-placar-valor">{c.valor}</div>
                  <div className="kn-placar-label">{c.label}</div>
                  {c.sub ? <div className="kn-placar-sub">{c.sub}</div> : null}
                </div>
              ))}
            </div>
            <div className="kn-placar-barra" role="img" aria-label={PARTES.map((p) => `${p.label} ${pc[p.key]} %`).join(", ")}>
              {PARTES.map((p) => (pc[p.key] ? <span key={p.key} data-parte={p.key} style={{ flexGrow: v.partes[p.key] }} /> : null))}
            </div>
            <ul className="kn-placar-legenda">
              {PARTES.map((p) => (
                <li key={p.key}>
                  <i data-parte={p.key} />
                  <b>{p.label}</b> {pc[p.key]} %<span>{p.hint}</span>
                </li>
              ))}
            </ul>
            <p className="kn-placar-nota">{acharLerLine(v.partes)}</p>
          </>
        ) : null}
        {v.ultimos.length ? (
          <table className="kn-placar-tabela">
            <thead>
              <tr>
                <th>Os últimos pedidos</th>
                <th>A Bússola</th>
                <th>Idas</th>
                <th>Tokens</th>
                <th>Partes</th>
              </tr>
            </thead>
            <tbody>
              {v.ultimos.map((u) => {
                const selo = seloFaro(u.faro);
                const upc = porcentos(u.partes);
                return (
                  <tr key={u.request}>
                    <td>
                      <span className="kn-usage-q">{u.question || "(sem texto)"}</span>
                      <span className="kn-usage-meta">{at(u.at, now)}</span>
                    </td>
                    <td>
                      <span className="kn-placar-selo" data-tom={selo.tom}>
                        {selo.texto}
                      </span>
                    </td>
                    <td className="kn-placar-num">{u.idas}</td>
                    <td className="kn-placar-num">{curto(u.tokens)}</td>
                    <td>
                      <div className="kn-placar-mini" title={PARTES.map((p) => `${p.label} ${upc[p.key]} %`).join(", ")}>
                        {PARTES.map((p) => (upc[p.key] ? <span key={p.key} data-parte={p.key} style={{ flexGrow: u.partes[p.key] }} /> : null))}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : null}
      </div>
    </Section>
  );
}
