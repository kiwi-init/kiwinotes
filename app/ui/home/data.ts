// Os dados da tela de Início (spec #15728): o `home.today` do main (T15847) e o `home.changed`, que pede de novo.
// Num app sem a capacidade (uma UI nova num engine velho), a tela mostra só o topo.
import { useEffect, useState } from "react";
import type { HomeToday } from "../../src/shared/home.ts";

/** `undefined`: ainda carregando; `null`: o app não tem a capacidade (ou ela falhou). */
export function useHomeToday(active: boolean): HomeToday | null | undefined {
  const [data, setData] = useState<HomeToday | null | undefined>(undefined);
  useEffect(() => {
    const engine = window.engine;
    if (!engine?.has("home.today")) return void setData(null);
    let alive = true;
    let seq = 0;
    const load = () => {
      const n = ++seq;
      engine.invoke("home.today", {}).then(
        (r) => alive && n === seq && setData(r as HomeToday),
        () => alive && n === seq && setData((d) => d ?? null),
      );
    };
    // Escondida, a tela não pede: na volta para a Início, pede de novo.
    if (active) load();
    const off = engine.on("home.changed", () => active && load());
    return () => {
      alive = false;
      off();
    };
  }, [active]);
  return data;
}
