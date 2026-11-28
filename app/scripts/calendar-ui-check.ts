// T32157 (spec #32129, parte 4): a aba Calendário no hub de verdade, com o headless e notas inventadas. Nunca abre
// janela, nem liga o mic, nem o agente.
// - A aba Calendário vem depois de Ditado e abre na Semana, com o painel do Kiwi à direita.
// - Dia · Semana · Mês · Agenda trocam a vista, e os itens das notas e da reunião aparecem nelas.
// - O hover num item mostra o cartão com um só ⤢, no canto de cima à direita.
// - O ⤢ abre o painel largo (Item · Nota · Ligações), e o item fica marcado; o ⤡ fecha e volta ao item.
// - O link da nota no cartão abre a aba Notas naquela nota, com a linha do item marcada.
// - A Semana da Início tem o "Abrir o calendário".
// - O Sim da "atrasada" numa pendência repetida leva só a vez para amanhã, e a sugestão não volta na vez anterior (#485).
// Os prints de cada vista, em pt e en, e um vídeo da ida e da volta do painel largo.
// Da raiz do app: `bun scripts/calendar-ui-check.ts [pasta]`. Pegue `kiwi lock bench`.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readdirSync, renameSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { webkit, type Page } from "playwright-core";
import { connect, request } from "./cli";
import { openWindow, type UiContext } from "./ui-page";

const app = resolve(import.meta.dir, "..");
const out = resolve(process.argv[2] ?? join(tmpdir(), "kiwi-T32157-calendar"));
mkdirSync(out, { recursive: true });
const data = mkdtempSync(join(tmpdir(), "kiwi-calendar-"));

async function cli(args: string[]) {
  const p = Bun.spawn([process.execPath, join(app, "scripts/cli.ts"), ...args, "--data", data], { cwd: app, stdout: "pipe", stderr: "pipe" });
  const text = await new Response(p.stdout).text();
  const err = await new Response(p.stderr).text();
  assert.equal(await p.exited, 0, text + err);
  return text;
}
const ctx: UiContext = {
  data,
  send: async (msg) => { const r = await request(data, msg); assert.ok(r); return r; },
  subscribe: async (topics, onMsg) => {
    const c = await connect(data, (line) => { if (!("id" in line)) onMsg(line); });
    assert.ok(c);
    c.write({ id: 0, cmd: "subscribe", topics, follow: true, backlog: false });
    return () => c.close();
  },
};
async function invoke(cap: string, args: unknown = {}) {
  const r = await ctx.send({ cmd: "invoke", cap, args });
  assert.equal(r.ok, true, JSON.stringify(r));
  return r.value as any;
}

/** A data de hoje mais `n` dias, como `AAAA-MM-DD`, no fuso do Mac (o calendário mostra a hora local). */
const day = (n = 0) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const at = (n: number, h: number) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  d.setHours(h, 0, 0, 0);
  return d.toISOString();
};

const VIEWS = ["day", "week", "month", "agenda"] as const;
const tab = (p: Page, s: string) => p.locator(`[role="tab"][data-section="${s}"]`);
const pane = '.kn-hub-pane[data-section="calendar"]';
const item = (title: string) => `${pane} .kn-cal-item:has-text("${title}")`;

/** O painel largo parado num estado: o `data-state` sai de `opening`/`closing` no fim da animação, sem `sleep`. */
const wide = (p: Page, state: "open" | "gone") =>
  state === "open"
    ? p.waitForSelector(`${pane} .kn-cal-wide[data-state="open"]`)
    : p.waitForSelector(`${pane} .kn-cal-wide`, { state: "detached" });

/** A grade abre rolada perto do agora: rola até o item, no meio, antes do print ou do arrastar. */
const show = (p: Page, title: string) =>
  p.locator(item(title)).first().evaluate((el) => el.scrollIntoView({ block: "center", behavior: "instant" }));

/** O "Revisar o orçamento" de 24 h: o bloco e o cartão do hover mostram a hora com o fim no dia seguinte (T34131). */
async function plusOneDay(p: Page, text: string) {
  await show(p, "Revisar o orçamento");
  const tile = p.locator(item("Revisar o orçamento")).first();
  assert.ok((await tile.textContent())?.includes(text), `o bloco: ${await tile.textContent()}`);
  await tile.hover();
  await p.waitForFunction(([s, t]) => [...document.querySelectorAll(s)].some((e) => e.textContent?.includes(t)), [`${pane} .kn-cal-when`, text] as const, { timeout: 5_000 })
    .catch(async () => assert.fail(`o cartão: ${await p.locator(`${pane} .kn-cal-when`).allTextContents()}`));
}

async function view(p: Page, v: (typeof VIEWS)[number]) {
  await p.locator(`${pane} .kn-cal-views [data-view="${v}"]`).click();
  await p.waitForSelector(`${pane} .kn-cal[data-view="${v}"]`);
}

/** O hover num item: o cartão aparece com um só ⤢, no canto de cima à direita do cartão. */
async function hoverCard(p: Page, title: string) {
  // No canto de cima: com a cascata, a caixa de cima cobre o meio da de baixo (#32311).
  await p.locator(item(title)).first().hover({ position: { x: 8, y: 8 } });
  await p.waitForSelector(`${pane} .kn-cal-card`);
  assert.equal(await p.locator(`${pane} .kn-cal-card .kn-cal-expand`).count(), 1, "o cartão tem um só ⤢");
  const [card, xp] = await Promise.all([
    p.locator(`${pane} .kn-cal-card`).boundingBox(),
    p.locator(`${pane} .kn-cal-card .kn-cal-expand`).boundingBox(),
  ]);
  assert.ok(card && xp);
  assert.ok(xp.y - card.y < card.height / 3, `o ⤢ fica em cima: ${xp.y - card.y} de ${card.height}`);
  assert.ok(card.x + card.width - (xp.x + xp.width) < card.width / 4, "o ⤢ fica à direita");
}

const browser = await webkit.launch({ headless: true });
const checks: string[] = [];
try {
  await cli(["start", "--no-helper"]);
  // Notas inventadas: pendências com data e hora, uma sem data, e uma reunião de hoje com a ata.
  await invoke("notes.create", { folder: "Projeto X", title: "Pendências", content: `# Pendências\n\n- [ ] Revisar o orçamento @ ${day(0)} 10:00\n- [ ] Mandar a proposta à Ana @ ${day(1)} 15:00\n- [ ] Escolher o fornecedor\n` });
  // Uma pendência repetida que começou há 3 dias, à meia-noite: sempre tem uma vez atrasada, a qualquer hora (#485).
  await invoke("notes.create", { folder: "Casa", title: "Rotina", content: `# Rotina\n\n- [ ] Regar as plantas @ ${day(-3)} 00:00 🔁 dia\n` });
  await invoke("notes.create", { folder: "Casa", title: "Mudança", content: `# Mudança\n\n- [ ] Comprar fita e caixas @ ${day(2)} 09:00\n- [ ] Levar a geladeira\n` });
  await invoke("notes.create", { folder: "Reuniões", title: "Revisão do Projeto X", content: `---\ntype: meeting\ndate: "${day(0)}"\nstart: "${at(0, 14)}"\nduration: 1800\nparticipants: [Ana, Bruno]\n---\n\nPauta: o orçamento e a data da entrega.\n` });
  await invoke("settings.set", { kiwicat: { overlay: false, show: true } });

  for (const lang of ["pt", "en"] as const) {
    await invoke("settings.set", { language: lang });
    const shots = join(out, lang);
    mkdirSync(shots, { recursive: true });
    const w = await openWindow(browser, ctx, { window: "hub", scale: 2, theme: "light", width: 1300, height: 800, motion: false, browser: "webkit", query: { section: "home" } });
    const p = w.page;
    try {
      // 1. A aba vem depois de Ditado e abre na Semana, com o painel do Kiwi.
      const order = await p.locator('[role="tab"][data-section]').evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.section));
      assert.equal(order[order.indexOf("dictation") + 1], "calendar", `a ordem das abas: ${order}`);
      await tab(p, "calendar").click();
      await p.waitForSelector(`${pane}:not([hidden]) .kn-cal[data-view="week"]`);
      // O painel do Kiwi é do T32156: aqui só o lugar dele, que fica vazio (e sem tamanho) até a parte 3 entrar.
      await p.waitForSelector(`${pane} .kn-cal-side`, { state: "attached" });
      for (const t of ["Revisar o orçamento", "Revisão do Projeto X"]) await p.waitForSelector(item(t));
      // O fundo da aba ativa (a pílula) fica embaixo do Calendário, não de outra aba (lead #32229).
      // Espera o fim do deslize (o print do #32229 saiu no meio dele), até 2 s.
      await p.waitForFunction(() => {
        const a = document.querySelector(".kn-tabs-pill")?.getBoundingClientRect();
        const b = document.querySelector('[role="tab"][data-section="calendar"]')?.getBoundingClientRect();
        return !!a && !!b && Math.abs(a.x + a.width / 2 - (b.x + b.width / 2)) <= 2;
      }, undefined, { timeout: 2000 });
      checks.push(`${lang}: a aba Calendário depois de Ditado, com a pílula nela, na Semana, com os itens e o painel do Kiwi`);

      // 2. Cada vista, com o print.
      for (const v of VIEWS) {
        await view(p, v);
        if (v !== "month") await p.waitForSelector(item("Revisar o orçamento"));
        if (v === "day" || v === "week") await show(p, "Revisar o orçamento");
        await p.screenshot({ path: join(shots, `${v}.png`) });
        // As cabeças de data saem como o `format.ts` as escreve, só com a 1ª maiúscula: nenhum CSS muda o texto. Em pt,
        // o `capitalize` punha "Sexta-Feira, 27 De Novembro" na Agenda (#494).
        const heads = await p.locator(`${pane} .kn-cal-dayhead, ${pane} .kn-cal-month-head span, ${pane} .kn-cal-agenda-day h3`).evaluateAll((els) =>
          // Sem os espaços: o número do dia é um item do flex, e o innerText põe uma quebra entre ele e o nome.
          els.map((e) => ({ shown: (e as HTMLElement).innerText.replace(/\s+/g, ""), text: (e.textContent ?? "").replace(/\s+/g, "") })),
        );
        assert.ok(heads.length > 0, `${lang}/${v}: nenhuma cabeça de data`);
        for (const h of heads) assert.equal(h.shown, h.text, `${lang}/${v}: a cabeça de data saiu diferente do texto (#494)`);
      }
      await view(p, "week");
      checks.push(`${lang}: Dia · Semana · Mês · Agenda, com um print de cada, e as cabeças de data como o format.ts as escreve (#494)`);

      // 3. O hover, o ⤢ e o ⤡.
      await hoverCard(p, "Revisão do Projeto X");
      await p.screenshot({ path: join(shots, "hover.png") });
      await p.locator(`${pane} .kn-cal-card .kn-cal-expand`).click();
      await wide(p, "open");
      assert.equal(await p.locator(`${pane} .kn-cal-item[data-open]`).count(), 1, "o item aberto fica marcado");
      for (const t of ["item", "note", "links"]) assert.equal(await p.locator(`${pane} .kn-cal-wide [role="tab"][data-tab="${t}"]`).count(), 1, `a aba ${t}`);
      await p.screenshot({ path: join(shots, "largo.png") });
      await p.locator(`${pane} .kn-cal-collapse`).click();
      await wide(p, "gone");
      assert.equal(await p.locator(`${pane} .kn-cal-item[data-open]`).count(), 0, "nenhum item marcado depois do ⤡");
      checks.push(`${lang}: o hover com um só ⤢ no canto, o painel largo com Item · Nota · Ligações, e o ⤡ de volta`);

      // 3b. O filtro (T32408): esconder um projeto e um tipo, na grade e no painel do Kiwi, e ele fica ao recarregar.
      const gone = (sel: string) => p.waitForSelector(sel, { state: "detached" });
      const undated = (t: string) => `${pane} .kn-cal-kiwi-undated li:has-text("${t}")`;
      await p.waitForSelector(undated("Escolher o fornecedor"));
      await p.locator(`${pane} .kn-cal-projects-bt`).click();
      await p.locator(`${pane} .kn-cal-projects [data-project="Projeto X"] input`).uncheck();
      await gone(item("Revisar o orçamento"));
      await gone(undated("Escolher o fornecedor"));
      await p.waitForSelector(item("Revisão do Projeto X"));
      await p.waitForSelector(undated("Levar a geladeira"));
      assert.equal(await p.locator(`${pane} .kn-cal-projects[data-filtered]`).count(), 1, "o botão mostra que há filtro");
      await p.screenshot({ path: join(shots, "filtro-projeto.png") });
      await p.locator(`${pane} .kn-cal-projects [data-project-all] input`).check();
      await p.waitForSelector(item("Revisar o orçamento"));
      await p.keyboard.press("Escape");
      await gone(`${pane} .kn-cal-projects-pop`);
      const meeting = p.locator(`${pane} .kn-cal-legend [data-kind="meeting"]`);
      await meeting.click();
      assert.equal(await meeting.getAttribute("aria-pressed"), "false");
      await gone(item("Revisão do Projeto X"));
      await p.waitForSelector(item("Revisar o orçamento"));
      await p.screenshot({ path: join(shots, "filtro-tipo.png") });
      await p.reload();
      await tab(p, "calendar").click();
      await p.waitForSelector(item("Revisar o orçamento"));
      assert.equal(await p.locator(`${pane} .kn-cal-legend [data-kind="meeting"]`).getAttribute("aria-pressed"), "false", "o filtro fica ao recarregar");
      assert.equal(await p.locator(item("Revisão do Projeto X")).count(), 0, "a reunião segue escondida ao recarregar");
      await p.locator(`${pane} .kn-cal-legend [data-kind="meeting"]`).click();
      await p.waitForSelector(item("Revisão do Projeto X"));
      checks.push(`${lang}: o filtro esconde o Projeto X (na grade e no sem data) e as reuniões, e fica ao recarregar`);

      // O rodapé do + Novo diz o arquivo de verdade: a pendência vai ao Calendário.md, e a Nota vira uma nota nova com o título (#492).
      {
        const where = () => p.locator(`${pane} .kn-cal-newform .kn-cal-where`).innerText();
        await p.locator(`${pane} .kn-cal-new`).click();
        assert.equal(await where(), lang === "pt" ? "Vai para Calendário.md." : "Goes to Calendário.md.");
        await p.locator(`${pane} .kn-cal-newform [data-kind="note"]`).click();
        await p.fill(`${pane} .kn-cal-newform input[name="title"]`, "Plano: Q1");
        await p.selectOption(`${pane} .kn-cal-newform select[name="project"]`, "Projeto X");
        const note = lang === "pt" ? "Vira a nota Projeto X/Plano Q1.md." : "Becomes the note Projeto X/Plano Q1.md.";
        assert.equal(await where(), note, `${lang}: o rodapé da Nota (#492)`);
        await p.screenshot({ path: join(shots, "novo-nota.png") });
        await p.locator(`${pane} .kn-cal-newform button.kn-cal-btn[type="button"]`).click();
        await p.waitForSelector(`${pane} .kn-cal-newform`, { state: "detached" });
        checks.push(`${lang}: o + Novo diz "${note}" com o tipo Nota, e Calendário.md na pendência (#492)`);
      }

      // 5. Criar no vazio e esticar a borda de cima (spec #34706, ponto 5, T34748), no Dia de hoje: o clique às 9:35 abre o
      // rascunho das 9:30 às 10:00 com o formulário ao lado, e o Enter cria; arrastar das 7:05 às 8:20 marca 7:00–8:30, e o
      // Esc desiste sem gravar; o vazio de um dia do Mês abre o + Novo nele; a borda de cima puxa o começo 1 h para cima.
      {
        const title = lang === "pt" ? "Café com a Ana" : "Coffee with Ana";
        const cal = async () => ((await invoke("notes.get", { path: "Calendário.md" }).catch(() => ({ content: "" }))).content as string);
        const calHas = async (re: RegExp, what: string) => {
          for (let n = 0; !re.test(await cal()); n++) { assert.ok(n < 50, `${lang}: ${what}: ${await cal()}`); await Bun.sleep(100); }
        };
        const form = `${pane} .kn-cal-newform`;
        const before = (await p.locator(`${pane} .kn-cal`).getAttribute("data-view")) as (typeof VIEWS)[number];
        await view(p, "day");
        await p.locator(`${pane} .kn-cal-scroll`).evaluate((el) => { el.scrollTop = 6 * 48; });
        const col = p.locator(`${pane} .kn-cal-col[data-day="${day(0)}"]`);
        const yAt = async (h: number) => { const b = await col.boundingBox(); assert.ok(b); return { x: b.x + b.width / 2, y: b.y + h * 48 }; };

        // 5a. O clique.
        const c = await yAt(9 + 35 / 60);
        await p.mouse.click(c.x, c.y);
        await p.waitForSelector(form);
        assert.deepEqual(
          [await p.inputValue(`${form} input[name="day"]`), await p.inputValue(`${form} input[name="time"]`), await p.inputValue(`${form} input[name="end"]`)],
          [day(0), "09:30", "10:00"],
          `${lang}: o clique às 9:35 abre 9:30–10:00`,
        );
        const draft = p.locator(`${pane} .kn-cal-draft`);
        assert.equal((await draft.innerText()).replace(/\s+/g, " ").trim(), `${lang === "pt" ? "(sem título)" : "(no title)"} 09:30–10:00`);
        const [db, fb] = [await draft.boundingBox(), await p.locator(form).boundingBox()];
        // No Dia, o rascunho tem a largura toda: o formulário fica à direita, sem cobrir o começo dele (o título e a hora).
        assert.ok(db && fb && (fb.x >= db.x + 160 || fb.x + fb.width <= db.x), `${lang}: o formulário abre ao lado do rascunho, sem cobrir o começo dele: ${JSON.stringify({ db, fb })}`);
        assert.ok(Math.abs(fb.y - db.y) < 2 || fb.y + fb.height <= 800, `${lang}: o formulário fica na altura do rascunho ou dentro da janela`);
        assert.equal(await p.evaluate(() => (document.activeElement as HTMLInputElement | null)?.name), "title", "o foco já está no título");
        assert.equal(await p.isChecked(`${form} input[name="allDay"]`), false, `${lang}: com a hora do vazio, o Dia todo vem desmarcado (#531)`);
        // O aviso no + Novo (régua 11.7): a Pendência vem sem aviso; com "30 min antes", o item sai com a marca do Kiwi.
        assert.equal(await p.inputValue(`${form} select[name="notify"]`), "none", `${lang}: a Pendência vem sem aviso`);
        await p.selectOption(`${form} select[name="notify"]`, "30m");
        await p.locator(`${form} input[name="title"]`).focus();
        await p.keyboard.type(title);
        await p.screenshot({ path: join(shots, "criar-clicando.png") });
        await p.keyboard.press("Enter");
        await p.waitForSelector(form, { state: "detached" });
        await calHas(new RegExp(`${title} @ ${day(0)} 09:30-10:00`), "o Enter cria 9:30–10:00");
        await p.waitForSelector(item(title));
        assert.equal(await draft.count(), 0, "o rascunho sai junto com o formulário");
        assert.equal(await p.locator(`${item(title)} .kn-cal-kiwi-mark`).count(), 1, `${lang}: o aviso escolhido no + Novo vai para o item (régua 11.7)`);
        checks.push(`${lang}: o clique às 9:35 no vazio abre o rascunho 09:30–10:00 com o formulário ao lado, e o Enter cria "${title}" no Calendário.md, com o aviso de 30 min escolhido no + Novo`);

        // 5b. O arrastar, e o Esc.
        const a0 = await yAt(7 + 5 / 60);
        await p.mouse.move(a0.x, a0.y);
        await p.mouse.down();
        await p.mouse.move(a0.x, a0.y + (75 / 60) * 48, { steps: 8 });
        assert.equal((await draft.innerText()).replace(/\s+/g, " ").trim().slice(-11), "07:00–08:30", `${lang}: o rascunho acompanha o arrastar`);
        await p.mouse.up();
        await p.waitForSelector(form);
        assert.deepEqual([await p.inputValue(`${form} input[name="time"]`), await p.inputValue(`${form} input[name="end"]`)], ["07:00", "08:30"], `${lang}: arrastar das 7:05 às 8:20 marca 7:00–8:30`);
        await p.screenshot({ path: join(shots, "criar-arrastando.png") });
        const was = await cal();
        await p.keyboard.press("Escape");
        await p.waitForSelector(form, { state: "detached" });
        assert.equal(await draft.count(), 0, "o Esc tira o rascunho");
        await Bun.sleep(300);
        assert.equal(await cal(), was, "o Esc não grava nada");
        checks.push(`${lang}: arrastar das 7:05 às 8:20 no vazio marca 07:00–08:30, e o Esc desiste sem gravar`);

        // 5c. A borda de cima: 1 h para cima, o fim fica.
        await p.locator(item(title)).first().hover();
        const tb = await p.locator(`${item(title)} .kn-cal-resize-top`).first().boundingBox();
        assert.ok(tb);
        await p.mouse.move(tb.x + tb.width / 2, tb.y + tb.height / 2);
        await p.mouse.down();
        await p.mouse.move(tb.x + tb.width / 2, tb.y + tb.height / 2 - 48, { steps: 8 });
        await p.mouse.up();
        await calHas(new RegExp(`${title} @ ${day(0)} 08:30-10:00`), "a borda de cima puxa o começo para 8:30");
        await p.screenshot({ path: join(shots, "esticar-comeco.png") });
        checks.push(`${lang}: a borda de cima de "${title}" puxa o começo para 08:30 e deixa o fim às 10:00`);

        // 5d. O vazio de um dia do Mês: o + Novo abre naquele dia, sem hora, com o dia marcado.
        await view(p, "month");
        const cell = p.locator(`${pane} .kn-cal-cell[data-day="${day(3)}"]`);
        // O Mês rola: o locator traz o dia para a vista antes do clique, no canto de baixo, longe dos itens.
        await cell.scrollIntoViewIfNeeded();
        const cb = await cell.boundingBox();
        assert.ok(cb);
        await cell.click({ position: { x: cb.width - 6, y: cb.height - 6 } });
        await p.waitForSelector(form);
        assert.deepEqual([await p.inputValue(`${form} input[name="day"]`), await p.inputValue(`${form} input[name="time"]`)], [day(3), ""], `${lang}: o vazio do Mês abre o + Novo no dia`);
        assert.equal(await cell.getAttribute("data-drafting"), "", "o dia fica marcado");
        // #531: sem hora, o Dia todo vem marcado à vista, e a hora vazia não mostra o "12:30" do WebKit.
        assert.equal(await p.isChecked(`${form} input[name="allDay"]`), true, `${lang}: sem hora, o Dia todo vem marcado (#531)`);
        // O WebKit não calcula o estilo do ::-webkit-datetime-edit pelo getComputedStyle: confere a marca no campo e a regra
        // que a usa, na folha de estilos de verdade.
        assert.equal(await p.getAttribute(`${form} input[name="time"]`, "data-empty"), "", `${lang}: a hora vazia ganha a marca (#531)`);
        const ghost = await p.evaluate(() =>
          [...document.styleSheets].flatMap((sh) => [...sh.cssRules]).some((r) => r instanceof CSSStyleRule && r.selectorText.includes("[data-empty]") && r.selectorText.includes("::-webkit-datetime-edit") && r.style.color === "transparent"),
        );
        assert.ok(ghost, `${lang}: a hora vazia fica em branco, não "12:30" (#531)`);
        assert.ok(Number(await p.locator(`${form} input[name="end"]`).evaluate((el) => getComputedStyle(el).opacity)) < 0.6, `${lang}: o Até desligado parece desligado (#531)`);
        await p.screenshot({ path: join(shots, "criar-no-mes.png") });
        // Desmarcar o Dia todo põe a próxima hora cheia; marcar de novo apaga a hora.
        await p.locator(`${form} input[name="allDay"]`).uncheck();
        assert.match(await p.inputValue(`${form} input[name="time"]`), /^\d\d:00$/, `${lang}: desmarcar o Dia todo põe uma hora (#531)`);
        await p.locator(`${form} input[name="allDay"]`).check();
        assert.equal(await p.inputValue(`${form} input[name="time"]`), "", `${lang}: marcar o Dia todo apaga a hora (#531)`);
        await p.keyboard.press("Escape");
        await p.waitForSelector(form, { state: "detached" });
        await view(p, before);
        checks.push(`${lang}: o clique no vazio do dia ${day(3)} no Mês abre o + Novo nele, com o Dia todo marcado e a hora em branco (#531), e o Esc fecha`);

        // 5e. Criar com o tipo escondido pelo filtro (régua 10.9): o aviso diz, e o Mostrar tira o filtro do tipo.
        const hidden = lang === "pt" ? "Ideia escondida" : "Hidden idea";
        const legendTask = p.locator(`${pane} .kn-cal-legend button[data-kind="task"]`);
        await legendTask.click();
        assert.equal(await legendTask.getAttribute("aria-pressed"), "false", "a Pendência escondida");
        await p.locator(`${pane} .kn-cal-new`).click();
        await p.fill(`${form} input[name="title"]`, hidden);
        await p.fill(`${form} input[name="day"]`, day(0));
        await p.fill(`${form} input[name="time"]`, "18:00");
        await p.locator(`${form} input[name="title"]`).press("Enter");
        await p.waitForSelector(form, { state: "detached" });
        const warn = p.locator(`${pane} .kn-cal-notice[data-hidden-new]`);
        await warn.waitFor();
        const said = lang === "pt" ? `“${hidden}” foi criado, mas o filtro esconde esse item.` : `“${hidden}” was created, but the filter hides it.`;
        assert.ok((await warn.innerText()).includes(said), `${lang}: o aviso do item escondido: ${await warn.innerText()}`);
        assert.equal(await p.locator(item(hidden)).count(), 0, "escondido pelo filtro");
        await p.screenshot({ path: join(shots, "criado-escondido.png") });
        await warn.locator("button.kn-cal-btn").click();
        await p.waitForSelector(item(hidden));
        assert.equal(await legendTask.getAttribute("aria-pressed"), "true", "o Mostrar tira o filtro da Pendência");
        assert.equal(await warn.count(), 0, "o aviso sai");
        checks.push(`${lang}: criar "${hidden}" com a Pendência escondida avisa "${said}", e o Mostrar põe o item e o tipo à vista (régua 10.9)`);
      }

      if (lang === "en") {
        // O item que o pt esticou até 24 h (4c), em inglês: o bloco e o cartão com o (+1 day) (T34131).
        await plusOneDay(p, "11:00–11:00 (+1 day)");
        await p.screenshot({ path: join(shots, "mais-um-dia.png") });
        checks.push(`${lang}: o item de 24 h mostra 11:00–11:00 (+1 day) no bloco e no cartão`);

        // O motivo do título com a tag do tipo (#493), em inglês; o Cancelar fecha sem criar.
        await p.locator(`${pane} .kn-cal-new`).click();
        await p.fill(`${pane} .kn-cal-newform input[name="title"]`, "Plan the #focus block");
        const why = p.locator(`${pane} .kn-cal-newform .kn-cal-title-problem`);
        await why.waitFor();
        assert.equal((await why.textContent())?.trim(), "The title can’t have “#focus”: in the note, it sets the item’s kind, alert, repetition or date.");
        assert.ok(await p.locator(`${pane} .kn-cal-newform button[type="submit"]`).isDisabled(), "Create is off");
        await p.locator(`${pane} .kn-cal-newform`).screenshot({ path: join(shots, "titulo-com-tag.png") });
        await p.locator(`${pane} .kn-cal-newform button[type="button"].kn-cal-btn`).click();
        assert.equal(await p.locator(`${pane} .kn-cal-newform`).count(), 0, "o Cancelar fecha o + Novo");
        checks.push(`${lang}: o + Novo com "Plan the #focus block" mostra o motivo em inglês e desliga o Create`);
      }

      if (lang === "pt") {
        // 4a. Arrastar uma hora para baixo muda a hora na linha da nota; esticar a borda põe o fim.
        const line = async () => ((await invoke("notes.get", { path: "Projeto X/Pendências.md" })).content as string).split("\n")[2];
        const until = async (re: RegExp, what: string) => {
          for (let n = 0; !re.test(await line()); n++) { assert.ok(n < 50, `${what}: ${await line()}`); await Bun.sleep(100); }
        };
        const drag = async (sel: string, dy: number) => {
          await show(p, "Revisar o orçamento");
          const b = await p.locator(sel).first().boundingBox();
          assert.ok(b);
          const [x, y] = [b.x + b.width / 2, sel.includes("resize") ? b.y + b.height / 2 : b.y + 8];
          await p.mouse.move(x, y);
          await p.mouse.down();
          await p.mouse.move(x, y + dy, { steps: 8 });
          await p.mouse.up();
        };
        await drag(item("Revisar o orçamento"), 48);
        await until(new RegExp(`@ ${day(0)} 11:00`), "arrastar 1 h");
        await p.locator(item("Revisar o orçamento")).first().hover();
        await drag(`${item("Revisar o orçamento")} .kn-cal-resize`, 48);
        await until(new RegExp(`@ ${day(0)} 11:00-\\d\\d:\\d\\d`), "esticar a borda");
        checks.push(`${lang}: arrastar muda a hora na nota (${(await line()).trim()}), e esticar põe o fim`);

        // 4c. Esticar além de 24 h (#480): o esticar para em 24 h, a nota fica com o fim no dia seguinte, na mesma hora,
        // e a tela não mostra o "Não consegui gravar". 30 h passam da janela: o resto do gesto vai à window, onde a tela
        // escuta o pointermove e o pointerup depois do pointerdown na borda.
        await show(p, "Revisar o orçamento");
        await p.locator(item("Revisar o orçamento")).first().hover();
        const rb = await p.locator(`${item("Revisar o orçamento")} .kn-cal-resize`).first().boundingBox();
        assert.ok(rb);
        const [rx, ry] = [rb.x + rb.width / 2, rb.y + rb.height / 2];
        await p.mouse.move(rx, ry);
        await p.mouse.down();
        await p.mouse.move(rx, ry + 40, { steps: 4 });
        await p.evaluate(([x, y]) => {
          dispatchEvent(new PointerEvent("pointermove", { clientX: x, clientY: y, bubbles: true }));
          dispatchEvent(new PointerEvent("pointerup", { clientX: x, clientY: y, bubbles: true }));
        }, [rx, ry + 30 * 48] as const);
        await p.mouse.up();
        await until(new RegExp(`@ ${day(0)} 11:00-11:00`), "esticar além de 24 h para em 24 h");
        await Bun.sleep(300);
        assert.equal(await p.locator(`${pane} .kn-cal-notice`).count(), 0, `sem o aviso de erro: ${await p.locator(`${pane} .kn-cal-notice`).first().textContent().catch(() => "")}`);
        // O bloco e o cartão dizem que o fim é no dia seguinte (T34131): sem isso, 11:00–11:00 parecia duração zero.
        await plusOneDay(p, "11:00–11:00 (+1 dia)");
        await p.screenshot({ path: join(shots, "esticar-24h.png") });
        checks.push(`${lang}: esticar além de 24 h para em 24 h (${(await line()).trim()}), sem aviso de erro, e o bloco e o cartão dizem 11:00–11:00 (+1 dia)`);

        // 4d. O Sim da "atrasada" numa pendência repetida (#485). O painel usa o relógio de verdade, e outra pendência pode ser
        // a atrasada mais nova: o "Agora não" nas outras até a sugestão ser a da Rotina.
        const sug = `${pane} .kn-cal-kiwi-sug`;
        const sugItem = () => p.locator(sug).getAttribute("data-item", { timeout: 5_000 }).catch(() => null);
        const rotina = async () => (await invoke("notes.get", { path: "Casa/Rotina.md" })).content as string;
        for (let n = 0; ; n++) {
          await p.waitForSelector(`${sug}[data-rule="overdue"]`);
          const was = await sugItem();
          if (was?.includes("Rotina.md")) break;
          assert.ok(n < 8, `a sugestão da pendência repetida não apareceu: ${was}`);
          await p.locator(`${sug} [data-action="dismiss"]`).click();
          await p.waitForFunction(([s, w]) => document.querySelector(s)?.getAttribute("data-item") !== w, [sug, was] as const);
        }
        const asked = (await sugItem())!;
        const vez = asked.split("~")[1]!;
        await p.locator(`${sug} [data-action="accept"]`).click();
        // A nota: a série ganha o ⏭ da vez, e a linha avulsa leva a vez para amanhã, 9h. A hora da série não muda.
        for (let n = 0; !(await rotina()).includes(`- [ ] Regar as plantas @ ${day(1)} 09:00\n`); n++) { assert.ok(n < 50, await rotina()); await Bun.sleep(100); }
        assert.ok((await rotina()).includes(`- [ ] Regar as plantas @ ${day(-3)} 00:00 🔁 dia ⏭ ${vez}\n`), await rotina());
        // A vez anterior segue aberta e atrasada (a pendência segura a série, #483): sem a resposta guardada, ela voltaria.
        const antes = (await invoke("calendar.items", { from: day(-3), to: vez })).items as { title: string; start: string; done?: boolean }[];
        assert.ok(antes.some((i) => i.title === "Regar as plantas" && !i.done), "a vez anterior está aberta");
        // A sugestão sai da vez respondida, e por 1 s nenhuma vez da Rotina volta (o painel relê depois do Sim).
        await p.waitForFunction(([s, w]) => document.querySelector(s)?.getAttribute("data-item") !== w, [sug, asked] as const);
        for (let n = 0; n < 10; n++) {
          const now = await p.locator(sug).getAttribute("data-item", { timeout: 100 }).catch(() => null);
          assert.ok(!now?.includes("Rotina.md"), `a sugestão voltou na vez anterior: ${now}`);
          await Bun.sleep(100);
        }
        await p.screenshot({ path: join(shots, "sim-repeticao.png") });
        checks.push(`${lang}: o Sim da atrasada na pendência repetida põe o ⏭ ${vez} e a linha de amanhã, 9h, e a sugestão não volta na vez anterior (#485)`);

        // 4b. O + Novo, sem projeto, cria a linha no Calendário.md e o item na tela.
        await p.locator(`${pane} .kn-cal-new`).click();
        // 4b'. Um título com a tag do tipo (#493): o motivo aparece embaixo do campo, com o pedaço, e o Criar desliga.
        await p.fill(`${pane} .kn-cal-newform input[name="title"]`, "Revisar #foco do mês");
        const why = p.locator(`${pane} .kn-cal-newform .kn-cal-title-problem`);
        await why.waitFor();
        assert.equal((await why.textContent())?.trim(), "O título não pode ter “#foco”: na nota, isso vira o tipo, o aviso, a repetição ou a data do item.");
        assert.ok(await p.locator(`${pane} .kn-cal-newform button[type="submit"]`).isDisabled(), "o Criar fica desligado");
        await p.locator(`${pane} .kn-cal-newform`).screenshot({ path: join(shots, "titulo-com-tag.png") });
        checks.push(`${lang}: o + Novo com "Revisar #foco do mês" mostra o motivo com o pedaço e desliga o Criar`);
        // Uma data com hora no título: o aviso cita a data inteira, não só "@ 2" (lead #34500).
        await p.fill(`${pane} .kn-cal-newform input[name="title"]`, `Aula @ ${day(1)} 10:00-11:30 sala 3`);
        await p.waitForFunction((s) => document.querySelector(s)?.textContent?.includes("10:00-11:30"), `${pane} .kn-cal-newform .kn-cal-title-problem`);
        assert.equal((await why.textContent())?.trim(), `O título não pode ter “@ ${day(1)} 10:00-11:30”: na nota, isso vira o tipo, o aviso, a repetição ou a data do item.`);
        await p.locator(`${pane} .kn-cal-newform`).screenshot({ path: join(shots, "titulo-com-data.png") });
        checks.push(`${lang}: o + Novo com uma data e hora no título cita "@ ${day(1)} 10:00-11:30" inteira`);
        await p.fill(`${pane} .kn-cal-newform input[name="title"]`, "Ligar para o Bruno");
        assert.equal(await why.count(), 0, "o motivo some com o título comum");
        await p.fill(`${pane} .kn-cal-newform input[name="day"]`, day(0));
        await p.fill(`${pane} .kn-cal-newform input[name="time"]`, "16:00");
        await p.locator(`${pane} .kn-cal-newform button[type="submit"]`).click();
        await p.waitForSelector(item("Ligar para o Bruno"));
        assert.match((await invoke("notes.get", { path: "Calendário.md" })).content, new RegExp(`Ligar para o Bruno @ ${day(0)} 16:00`));
        checks.push(`${lang}: o + Novo cria "Ligar para o Bruno" no Calendário.md e na tela`);

        // 4b'. No Mês seguinte, o + Novo sugere o dia 1 dele, não a segunda da grade, que cai no mês de hoje (#491).
        const before = (await p.locator(`${pane} .kn-cal`).getAttribute("data-view")) as (typeof VIEWS)[number];
        await view(p, "month");
        await p.locator(`${pane} .kn-cal-tool > .kn-cal-ic`, { hasText: "›" }).click();
        const n = new Date();
        const first = `${new Date(n.getFullYear(), n.getMonth() + 1, 1).getFullYear()}-${String(((n.getMonth() + 1) % 12) + 1).padStart(2, "0")}-01`;
        await p.locator(`${pane} .kn-cal-new`).click();
        assert.equal(await p.inputValue(`${pane} .kn-cal-newform input[name="day"]`), first, `${lang}: o + Novo no Mês seguinte sugere o dia 1 (#491)`);
        await p.screenshot({ path: join(shots, "novo-mes-seguinte.png") });
        await p.locator(`${pane} .kn-cal-newform button.kn-cal-btn[type="button"]`).click();
        await p.waitForSelector(`${pane} .kn-cal-newform`, { state: "detached" });
        await p.locator(`${pane} .kn-cal-tool > .kn-cal-btn:not(.kn-cal-new)`).click();
        await view(p, before);
        checks.push(`${lang}: no Mês seguinte, o + Novo sugere ${first}, o dia 1 do mês à vista (#491)`);

        // 4c. O link da nota abre as Notas naquela nota, na linha do item.
        await hoverCard(p, "Revisar o orçamento");
        await p.locator(`${pane} .kn-cal-card [data-note-link]`).first().click();
        await p.waitForSelector('.kn-hub-pane[data-section="notes"]:not([hidden])');
        // A pendência é a 3ª linha da nota; a marca some depois da piscada, então espera logo depois do clique.
        const flashed = await p.waitForSelector('.kn-hub-pane[data-section="notes"] [data-flash-line="3"]');
        assert.match(await flashed.innerText(), /Revisar o orçamento/, "a linha marcada é a da pendência");
        checks.push(`${lang}: o link do cartão abre "Projeto X/Pendências" nas Notas, com a linha 3 marcada`);

        // 5. A Semana da Início tem o "Abrir o calendário".
        await tab(p, "home").click();
        await p.locator(".kn-home-v-chevron").click();
        await p.locator('.kn-home-v-menu [data-view="semana"]').click();
        await p.locator(".kn-home-week-open").click();
        await p.waitForSelector(`${pane}:not([hidden]) .kn-cal`);
        checks.push(`${lang}: a Semana da Início abre o calendário`);
      }
      assert.deepEqual(w.report.problems, [], "problemas na página");
    } finally {
      await w.close();
    }
  }
  await invoke("settings.set", { language: "pt" });

  // 6. O vídeo da animação: com movimento, a ida e a volta do painel largo.
  const video = join(out, "video");
  const w = await openWindow(browser, ctx, { window: "hub", scale: 1, theme: "light", width: 1300, height: 800, motion: true, browser: "webkit", query: { section: "calendar" }, video });
  try {
    const p = w.page;
    await p.waitForSelector(`${pane}:not([hidden]) .kn-cal[data-view="week"]`);
    await p.waitForTimeout(600);
    await hoverCard(p, "Revisão do Projeto X");
    await p.waitForTimeout(600);
    await p.locator(`${pane} .kn-cal-card .kn-cal-expand`).click();
    await wide(p, "open");
    await p.waitForTimeout(1200);
    await p.locator(`${pane} .kn-cal-collapse`).click();
    await wide(p, "gone");
    await p.waitForTimeout(1200);
  } finally {
    await w.close();
  }
  const [webm] = readdirSync(video).filter((f) => f.endsWith(".webm"));
  assert.ok(webm, "sem o vídeo");
  renameSync(join(video, webm), join(out, "animacao.webm"));
  checks.push("o vídeo da ida e da volta do painel largo");

  for (const c of checks) console.log(`ok  ${c}`);
  console.log(`prints em ${out}`);
} finally {
  await browser.close();
  await cli(["stop"]).catch(() => {});
}
