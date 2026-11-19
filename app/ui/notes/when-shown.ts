import { useEffect, useRef } from "react";

/**
 * Carrega só o que está na tela (spec #20118, U4, T20249): a Lixeira, as tags e os projetos aparecem só na árvore, e
 * antes se reliam a cada mudança no cofre, com ela aberta ou não. Agora, com `shown` e numa `version` que ainda não
 * carregou: abrir a árvore depois de três renomes pede uma vez, e abrir de novo sem mudança nenhuma não pede. A
 * primeira vez carrega mesmo escondido, para a árvore não abrir vazia e encher na frente da pessoa.
 */
export function useWhenShown(shown: boolean, version: number, load: () => void): void {
  const loaded = useRef<number | null>(null);
  const latest = useRef(load);
  latest.current = load;
  useEffect(() => {
    if ((!shown && loaded.current !== null) || loaded.current === version) return;
    loaded.current = version;
    latest.current();
  }, [shown, version]);
}
