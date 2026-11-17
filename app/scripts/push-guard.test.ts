// A guarda de privacidade antes do GitHub (spec #14415, T14423). Os valores que barram são inventados e montados em
// tempo de execução (`"prj-" + "banana"`), para este arquivo não barrar a si mesmo; os que passam são os de exemplo.
// Nada daqui é do trabalho de ninguém.
import { afterAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { crc32, deflateSync } from "node:zlib";
import { dirname, join } from "node:path";

import { hashOf, parseTerms } from "./privacy-check.ts";
import { lineKey, lineReasons, parseExceptions, pushRanges, scanLines, scanRange } from "./push-guard.ts";

const P = "prj-" + "banana-prd"; // um projeto inventado que não é de exemplo
const SA = "sa-teste@" + P + ".iam.gserviceaccount" + ".com";
const MACHINE = "maquina-do-" + "fulano" + ".local";
const TERM = "banana " + "split"; // um "termo da lista" inventado
const terms = parseTerms(`2 12 e ${hashOf(TERM)}\n`);

const dirs: string[] = [];
const tmp = () => {
  const d = mkdtempSync(join(tmpdir(), "push-guard-test-"));
  dirs.push(d);
  return d;
};
afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

function git(cwd: string, ...args: string[]) {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
  return r.stdout.trim();
}
function repo(): string {
  const d = tmp();
  git(d, "init", "-q", "-b", "main");
  git(d, "config", "user.email", "teste@exemplo.com");
  git(d, "config", "user.name", "Teste");
  git(d, "config", "commit.gpgsign", "false");
  writeFileSync(join(d, "LEIA.md"), "# Um repo de teste\n");
  git(d, "add", "-A");
  git(d, "commit", "-q", "-m", "o começo");
  return d;
}

describe("os padrões (spec #14415)", () => {
  test("os IDs de nuvem, a chave da AWS e o nome de máquina barram, cada um com o motivo", () => {
    expect(lineReasons(`conta: ${SA}`)).toContain("service account do GCP");
    expect(lineReasons(`url: https://x/v1/projects/${P}/locations/us`)).toContain("projeto do GCP");
    expect(lineReasons("gs://" + "banana-arquivos/2026")).toEqual(["bucket gs://"]);
    expect(lineReasons("arn:aws:iam::" + "111122223333" + ":role/x")).toEqual(["ARN da AWS"]);
    expect(lineReasons("chave " + "AKIA" + "QX7RT2LMN4PZ8WKB")).toContain("segredo (aws)");
    expect(lineReasons(`ssh ${MACHINE}`)).toEqual(["nome de máquina .local"]);
  });

  test("os valores de exemplo passam, e o que só parece não barra", () => {
    for (const ok of [
      "sa-exemplo@" + "prj-exemplo-prd.iam.gserviceaccount" + ".com",
      "projects/" + "prj-exemplo-hml/locations/us",
      "gs://" + "exemplo-bucket/x",
      "arn:aws:iam::" + "123456789012" + ":role/x",
      "exemplo" + ".local",
      "localhost e 0.1.0-local.2 e o build.local.json",
      "Co-Authored-By: Claude <noreply@anthropic.com>",
      "a pasta personal-projects e /Users/qualquer",
    ]) {
      expect([ok, lineReasons(ok)]).toEqual([ok, []]);
    }
  });

  test("um termo da lista barra pela linha; a exceção vale só para aquela linha daquele arquivo", () => {
    const lines = [
      { n: 1, text: "nada aqui" },
      { n: 2, text: `uma ${TERM} aqui` },
      { n: 3, text: `outra ${TERM} ali` },
    ];
    expect(scanLines("a.md", lines, terms, new Set())).toEqual([
      { file: "a.md", line: 2, reason: "termo da lista (privacy-terms.txt)" },
      { file: "a.md", line: 3, reason: "termo da lista (privacy-terms.txt)" },
    ]);
    const except = parseExceptions(`# revisado no PR\n${lineKey("a.md", lines[1]!.text)}\tum exemplo de propósito\n`);
    expect(scanLines("a.md", lines, terms, except).map((h) => h.line)).toEqual([3]);
    expect(scanLines("b.md", lines, terms, except).map((h) => h.line)).toEqual([2, 3]);
  });
});

describe("os commits que sobem", () => {
  test("as linhas novas de cada commit, com o número da linha, e as mensagens", () => {
    const d = repo();
    const base = git(d, "rev-parse", "HEAD");
    mkdirSync(join(d, "app"));
    writeFileSync(join(d, "app", "config.ts"), `// um\n// dois\nconst conta = "${SA}";\n`);
    git(d, "add", "-A");
    git(d, "commit", "-q", "-m", `o config (veja ${MACHINE})`);
    // Um 2º commit que tira a linha: ela subiu no 1º, então barra mesmo assim (a ref do PR guarda cada commit).
    writeFileSync(join(d, "app", "config.ts"), "// um\n// dois\n");
    git(d, "commit", "-q", "-am", "tira");
    const hits = scanRange(d, [`${base}..HEAD`], terms, new Set());
    expect(hits).toContainEqual({ file: "app/config.ts", line: 3, reason: "service account do GCP" });
    expect(hits.some((h) => h.file.endsWith("(mensagem)") && h.reason === "nome de máquina .local")).toBe(true);
    // Nada do valor vai para o motivo.
    expect(JSON.stringify(hits)).not.toContain(P);
    // A autoria pode ficar (#14430): um nome de pessoa na linha de autoria não barra.
    git(d, "commit", "-q", "--allow-empty", "-m", "vazio\n\nCo-authored-by: Pessoa Exemplo <pessoa@exemplo.com>");
    expect(scanRange(d, ["HEAD~1..HEAD"], terms, new Set())).toEqual([]);
  });

  test("o nome de máquina .local barra também no e-mail de autor e de committer e na linha de autoria (#14434)", () => {
    const d = repo();
    const base = git(d, "rev-parse", "HEAD");
    const mac = "fulano@" + "Fulano-MacBook-Pro" + ".local";
    const r = spawnSync("git", ["commit", "-q", "--allow-empty", "-m", `um commit\n\nCo-authored-by: Fulano <${mac}>`], {
      cwd: d,
      encoding: "utf8",
      env: { ...process.env, GIT_AUTHOR_EMAIL: mac, GIT_COMMITTER_EMAIL: mac },
    });
    expect(r.status).toBe(0);
    const reasons = scanRange(d, [`${base}..HEAD`], terms, new Set()).map((h) => h.reason);
    expect(reasons).toEqual(expect.arrayContaining([
      "nome de máquina .local no e-mail de autor",
      "nome de máquina .local no e-mail de committer",
      "nome de máquina .local na autoria",
    ]));
  });

  test("um sha do remoto que não existe aqui (um force-push sobre algo não buscado) vira o range de um branch novo", () => {
    const a = "a".repeat(40);
    const b = "b".repeat(40);
    expect(pushRanges(`refs/heads/x ${a} refs/heads/x ${b}\n`, "origin", (sha) => sha !== b)).toEqual([[a, "--not", "--remotes=origin"]]);
  });

  test("o que o pre-push manda vira ranges: um branch novo, um que já existe, e apagar não sobe nada", () => {
    const z = "0".repeat(40);
    const a = "a".repeat(40);
    const b = "b".repeat(40);
    expect(pushRanges(`refs/heads/x ${a} refs/heads/x ${z}\nrefs/heads/y ${a} refs/heads/y ${b}\n(delete) ${z} refs/heads/w ${b}\n`, "origin")).toEqual([
      [a, "--not", "--remotes=origin"],
      [`${b}..${a}`],
    ]);
  });

  test("o hook de verdade: um push com um ID de nuvem não sai, e diz a linha e o motivo; limpo, sai", () => {
    const remote = tmp();
    git(remote, "init", "-q", "--bare");
    const d = repo();
    git(d, "remote", "add", "origin", remote);
    git(d, "push", "-q", "origin", "main");
    // O hook de verdade, o .githooks/pre-push deste branch: ele chama app/scripts/push-guard.ts na raiz do repo, que
    // aqui é um link para os scripts deste branch (fora do que o teste comita).
    mkdirSync(join(d, "app"));
    symlinkSync(import.meta.dir, join(d, "app", "scripts"));
    git(d, "config", "core.hooksPath", join(import.meta.dir, "..", "..", ".githooks"));
    const env = { ...process.env, PATH: `${dirname(process.execPath)}:${process.env.PATH ?? ""}` };

    git(d, "checkout", "-q", "-b", "kn/T1-teste");
    writeFileSync(join(d, "notas.md"), `# Notas\n\nO bucket é gs://${"banana-arquivos"}.\n`);
    git(d, "add", "notas.md");
    git(d, "commit", "-q", "-m", "notas");
    const blocked = spawnSync("git", ["push", "origin", "kn/T1-teste"], { cwd: d, encoding: "utf8", env });
    expect(blocked.status).not.toBe(0);
    expect(blocked.stderr).toContain("notas.md:3: bucket gs://");
    expect(blocked.stderr).not.toContain("banana-arquivos");
    expect(git(remote, "branch", "--list", "kn/T1-teste")).toBe("");

    writeFileSync(join(d, "notas.md"), "# Notas\n\nO bucket é gs://exemplo-bucket.\n");
    git(d, "commit", "-q", "--amend", "-am", "notas");
    const ok = spawnSync("git", ["push", "origin", "kn/T1-teste"], { cwd: d, encoding: "utf8", env });
    expect([ok.status, ok.stdout + ok.stderr]).toEqual([0, expect.stringContaining("push-guard: nada barra")]);
    expect(git(remote, "branch", "--list", "kn/T1-teste")).toContain("kn/T1-teste");
  }, 30_000);

  test.skipIf(process.platform !== "darwin")("um print com um ID escrito na imagem barra, pelo OCR local", async () => {
    const { webkit } = await import("playwright-core");
    const d = repo();
    const base = git(d, "rev-parse", "HEAD");
    const browser = await webkit.launch({ headless: true });
    try {
      const page = await browser.newPage({ viewport: { width: 900, height: 160 }, deviceScaleFactor: 2 });
      await page.setContent(`<body style="margin:24px;font:28px -apple-system,sans-serif;background:#fff;color:#111">conecte em ${MACHINE}</body>`);
      await page.screenshot({ path: join(d, "print.png") });
    } finally {
      await browser.close();
    }
    git(d, "add", "print.png");
    git(d, "commit", "-q", "-m", "um print");
    // O print corrigido num commit seguinte: o 1º ainda sobe, porque a ref do PR guarda os dois.
    const clean = join(d, "limpo.png");
    const browser2 = await webkit.launch({ headless: true });
    try {
      const page = await browser2.newPage({ viewport: { width: 900, height: 160 }, deviceScaleFactor: 2 });
      await page.setContent(`<body style="margin:24px;font:28px -apple-system,sans-serif;background:#fff;color:#111">conecte no servidor de exemplo</body>`);
      await page.screenshot({ path: clean });
    } finally {
      await browser2.close();
    }
    renameSync(clean, join(d, "print.png"));
    git(d, "commit", "-q", "-am", "o print limpo");
    const hits = scanRange(d, [`${base}..HEAD`], terms, new Set(), { ocr: true });
    expect(hits).toContainEqual({ file: "print.png (texto da imagem)", line: 1, reason: "nome de máquina .local" });
    expect(hits).toHaveLength(1);
  }, 120_000);

  /** Um png branco de w×h, em escala de cinza. */
  const png = (w: number, h: number): Buffer => {
    const chunk = (type: string, data: Buffer) => {
      const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
      const len = Buffer.alloc(4);
      len.writeUInt32BE(data.length);
      const crc = Buffer.alloc(4);
      crc.writeUInt32BE(crc32(td) >>> 0);
      return Buffer.concat([len, td, crc]);
    };
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(w, 0);
    ihdr.writeUInt32BE(h, 4);
    ihdr[8] = 8; // 8 bits, cinza, sem entrelaçar
    const raw = Buffer.alloc((w + 1) * h, 0xff);
    for (let y = 0; y < h; y++) raw[y * (w + 1)] = 0; // o filtro de cada linha
    const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
    return Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
  };

  test.skipIf(process.platform !== "darwin")("uma imagem de 2 px não quebra o OCR, e um erro dele barra só aquela imagem (T16071)", () => {
    const d = repo();
    const base = git(d, "rev-parse", "HEAD");
    // O Vision recusa um lado de até 2 px; nele não cabe texto.
    writeFileSync(join(d, "fina.png"), png(2, 2048));
    writeFileSync(join(d, "baixa.png"), png(2048, 2));
    // Uma imagem que o OCR não lê: barra, com o arquivo e o motivo, e a guarda segue.
    writeFileSync(join(d, "quebrada.png"), "nao e um png");
    writeFileSync(join(d, "notas.txt"), `veja ${MACHINE}\n`);
    git(d, "add", "-A");
    git(d, "commit", "-q", "-m", "imagens");
    const hits = scanRange(d, [`${base}..HEAD`], terms, new Set(), { ocr: true });
    expect(hits).toContainEqual({ file: "notas.txt", line: 1, reason: "nome de máquina .local" });
    expect(hits).toContainEqual({ file: "quebrada.png (imagem)", line: 0, reason: expect.stringMatching(/^o OCR não leu a imagem: \S/) });
    expect(hits.filter((h) => /fina|baixa/.test(h.file))).toEqual([]);
    expect(hits).toHaveLength(2);
    // O motivo não leva o caminho do arquivo temporário.
    expect(JSON.stringify(hits)).not.toContain(tmpdir());
  }, 120_000);
});
