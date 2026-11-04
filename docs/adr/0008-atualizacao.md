# ADR 0008: atualização automática pelo Updater do Electrobun

- Status: aceito (T1969, decisão do @harry em #1934 e #1966).
- Código:
  - [`app/src/bun/updates.ts`](../../app/src/bun/updates.ts): checa, baixa, confere e oferece;
  - [`app/scripts/update-feed.ts`](../../app/scripts/update-feed.ts): o feed e o manifesto;
  - [`app/scripts/release.ts`](../../app/scripts/release.ts): o .tar.zst do app assinado;
  - [`.github/workflows/release.yml`](../../.github/workflows/release.yml): o publish.

## Contexto
Até a rc1, cada versão era um .dmg baixado à mão. O harry escolheu (#1966) que o app inteiro (a UI, o ditado e o helper) se atualize sozinho pelo `Updater` do Electrobun, assinado e notarizado, a partir do GitHub Releases.

Esta é a **única** coisa que o app busca na rede (AGENTS.md, Privacidade), e é exceção decidida pelo harry. São só `GET` de arquivos públicos de um release. Nada da pessoa vai na URL nem no header: o Updater do Electrobun só põe um número aleatório contra cache.

## Decisão
- **O feed** é o `release.baseUrl` do build, que o CI define pelo tag (`KIWI_UPDATE_URL`):
  - uma versão final (`v0.2.0`) lê `releases/latest/download`, o release mais novo que não é prerelease;
  - uma rc (`v0.2.0-rc3`) lê `releases/download/updates-rc`, um release fixo que o publish sobrescreve a cada rc e a cada versão final. Assim quem testa as rc recebe a rc seguinte e, no fim, a versão final, e quem está numa versão final nunca recebe uma rc;
  - um build local ou um ensaio sai sem `baseUrl` e nunca checa.
- **O que se baixa** é o mesmo app do .dmg: o `release.ts` empacota o .app que ele assinou, notarizou e com o ticket, num `stable-macos-arm64-*.tar.zst`, e publica o `stable-macos-arm64-update.json` do build, conferido contra o app. O patch delta do Electrobun fica desligado (`generatePatch: false`), porque ele sairia do app antes da assinatura.
- **O app confere antes de oferecer.** O Updater do Electrobun não confere assinatura nem conteúdo do que baixa. Então, com o download pronto, o app abre o tar numa pasta temporária e confere três coisas:
  - o `version.json`, com o identificador e o hash do manifesto;
  - o `CFBundleIdentifier`;
  - o `codesign --verify --deep --strict` com o requisito `anchor apple generic and identifier "app.kiwinotes.desktop" and certificate leaf[subject.OU] = "57249C654W"`, que é o Developer ID da Kiwi Init.

  Um tar que não passa é apagado e não vira oferta. Quem publicar no release sem a nossa chave não troca o app de ninguém.
- **Só sobe de versão.** O Updater do Electrobun decide pelo hash, e o feed `updates-rc` é sobrescrito pelo último release que terminar. Então o app só oferece uma versão **maior** que a dele, em semver: `0.2.0-rc3 < 0.2.0 < 0.2.1-rc1`, e na rc os números contam como números (`rc3 < rc10`). Para isso, o build leva a versão do tag (`KIWI_VERSION`, por exemplo `0.1.0-rc3`), e não só a do package.json.
- **Nada reinicia sozinho.** A primeira checagem acontece 1 minuto depois de abrir, e depois de 6 em 6 horas. Com o download conferido, o menu ganha **Atualizar e reiniciar**. Só esse clique chama o `applyUpdate`, que fecha o app, troca o .app e abre o novo. O helper sai junto, no `exit` do processo.
- **Desligada** no canal dev, sem `baseUrl`, com `KIWI_DEBUG=1` (agentes) e no headless, que nem importa o módulo. Os testes não vão à rede: o `bun test` usa um Updater de mentira e um .app de mentira assinado ad hoc, que a conferência recusa.

### A seção Sobre (T2386)
- **"Verificar atualizações"** no hub roda a mesma checagem (o mesmo `check()`, com a conferência da assinatura), na hora, sem esperar as 6 h. Duas checagens juntas, a do relógio e a do botão, viram uma.
- **O `AppUpdates` guarda a última checagem:** a hora e o resultado (na última versão, a versão nova ou o erro, dito para a pessoa: sem internet, o servidor que não respondeu, o download que falhou, a assinatura que não confere). Antes, tudo voltava a `idle` e o motivo só ia para o log.
- **O estado `downloading`** aparece entre a checagem e a oferta, para a seção mostrar "Baixando a 0.1.0-rc4…".
- **Continua um clique:** com a versão pronta, o botão vira "Atualizar e reiniciar". Nada reinicia sozinho (#2385).

## Consequências
- **A rc1 não tem o Updater.** Quem está nela instala a rc2 à mão uma vez, e daí em diante atualiza pelo menu.
- **O download é o app inteiro** (dezenas de MB) a cada versão. Ligar o patch delta exige gerar o patch a partir dos tars assinados, no CI, e isso fica para depois.
- **Um release com assets errados** (um tar sem a nossa assinatura) não chega a ninguém: o app recusa e loga `refused update`.
- **O release `updates-rc`** aparece na lista de releases do GitHub como prerelease, com um aviso para não instalar dali.
