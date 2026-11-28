// T32157 (spec #32129, parte 4): a aba Calendário no hub de verdade, com o headless e notas inventadas. Nunca abre
// janela, nem liga o mic, nem o agente.
// - A aba Calendário vem depois de Ditado e abre na Semana, com o painel do Kiwi à direita.
// - Dia · Semana · Mês · Agenda trocam a vista, e os itens das notas e da reunião aparecem nelas.
// - O hover num item mostra o cartão com um só ⤢, no canto de cima à direita.
// - O ⤢ abre o painel largo (Item · Nota · Ligações), e o item fica marcado; o ⤡ fecha e volta ao item.
// - O link da nota no cartão abre a aba Notas naquela nota, com a linha do item marcada.
// - A Semana da Início tem o "Abrir o calendário".
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
          els.map((e) => ({ shown: (e as HTMLElement).innerText.replace(/\s+/g, " ").trim(), text: (e.textContent ?? "").replace(/\s+/g, " ").trim() })),
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

        // 4b. O + Novo, sem projeto, cria a linha no Calendário.md e o item na tela.
        await p.locator(`${pane} .kn-cal-new`).click();
        await p.fill(`${pane} .kn-cal-newform input[name="title"]`, "Ligar para o Bruno");
        await p.fill(`${pane} .kn-cal-newform input[name="day"]`, day(0));
        await p.fill(`${pane} .kn-cal-newform input[name="time"]`, "16:00");
        await p.locator(`${pane} .kn-cal-newform button[type="submit"]`).click();
        await p.waitForSelector(item("Ligar para o Bruno"));
        assert.match((await invoke("notes.get", { path: "Calendário.md" })).content, new RegExp(`Ligar para o Bruno @ ${day(0)} 16:00`));
        checks.push(`${lang}: o + Novo cria "Ligar para o Bruno" no Calendário.md e na tela`);

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
