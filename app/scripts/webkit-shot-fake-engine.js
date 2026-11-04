(() => {
  const now = Date.now();
  const entries = [
    { id: "1", at: new Date(now - 6e5).toISOString(), raw: "hum então a reunião é amanhã às dez", text: "Então a reunião é amanhã às dez.", app: { name: "Slack" } },
    { id: "2", at: new Date(now - 3.6e6).toISOString(), raw: "lembrar de pedir o acesso ao bucket de homologação", text: "Lembrar de pedir o acesso ao bucket de homologação.", app: { name: "Notas" } },
    { id: "3", at: new Date(now - 8.64e7).toISOString(), raw: "git status", text: "git status", app: { name: "Terminal" } },
  ];
  const caps = {
    "history.search": () => ({ entries }),
    "dictionary.get": () => [{ term: "Kiwi Notes" }, { term: "kubectl", aliases: ["cube control"] }, { term: "PACS" }],
    "dictionary.check": () => [],
    "snippets.get": () => [{ trigger: "meu email", text: "ana@example.com" }],
  };
  window.engine = { has: (c) => c in caps, invoke: async (c) => caps[c]?.(), ready() {}, reportError() {}, on: () => () => {} };
})();
