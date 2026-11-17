// Os dados de uma tela da aba Início (T15875): pede ao main ao abrir e de novo a cada `home.changed`. Só a resposta do
// pedido mais novo entra na tela; um erro deixa o que já estava.
import { useEffect, useState } from "react";

import { api } from "../src/api.ts";

export type HomeLoad<T> = { state: "loading" } | { state: "ready"; data: T } | { state: "error" };

export function useHome<T>(fetch: () => Promise<T>): HomeLoad<T> {
  const [load, setLoad] = useState<HomeLoad<T>>({ state: "loading" });
  useEffect(() => {
    let n = 0;
    let alive = true;
    const run = () => {
      const mine = ++n;
      fetch().then(
        (data) => alive && mine === n && setLoad({ state: "ready", data }),
        (e) => {
          console.error("[home]", e);
          if (alive && mine === n) setLoad((l) => (l.state === "ready" ? l : { state: "error" }));
        },
      );
    };
    run();
    const off = api.home.onChanged(run);
    return () => {
      alive = false;
      off();
    };
  }, []);
  return load;
}
