// Os textos da seção Sobre (T2386), fora do componente: assim os testes não carregam o CSS nem o ícone.

import type { AppChannel, UpdatesView } from "../../src/shared/ui-contract.ts";

export const CHANNEL: Record<AppChannel, string> = {
  rc: "versões de teste (rc)",
  stable: "estável",
  dev: "desenvolvimento",
};

const time = (iso: string) => new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

/** A linha do estado das atualizações, dita para a pessoa. */
export function statusLine(v: UpdatesView): string {
  switch (v.state) {
    case "off":
      return `As atualizações estão desligadas neste build (${v.reason}).`;
    case "checking":
      return "Verificando…";
    case "downloading":
      return `Baixando a ${v.version}…`;
    case "ready":
      // Pronta, mas a troca já falhou uma vez (o "Atualizar e reiniciar" voltou): diz o porquê, e o botão segue lá.
      return v.lastCheck?.result === "error" ? v.lastCheck.message : `A ${v.version} está pronta.`;
    case "applying":
      return "Atualizando: o Kiwi Notes vai fechar e abrir de novo.";
    case "idle": {
      const last = v.lastCheck;
      if (!last) return "Ainda não verificado.";
      if (last.result === "latest") return `Você está na última versão. Verificado às ${time(last.at)}.`;
      if (last.result === "error") return `${last.message} (às ${time(last.at)})`;
      return `A ${last.version} está disponível.`;
    }
  }
}

