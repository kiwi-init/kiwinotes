// T7444 (varredura de robustez): o disco cheio no meio de uma gravação. O `open("w")` do temporário dá certo e a escrita
// falha com ENOSPC (foi o que o disco de 8 MB da varredura mostrou). A nota fica intacta, mas o temporário ficava na pasta:
// um `.kiwi-<hex>.tmp` no cofre a cada save que falhava (o salvamento automático tenta de novo a cada pausa), e um
// `<arquivo>.<pid>.<…>.tmp` na pasta de dados, sem nada que os limpasse depois.
//
// O ENOSPC é simulado só neste arquivo: `mock.module` troca o `node:fs/promises` para o processo de teste inteiro.
import { afterEach, expect, mock, test } from "bun:test";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import * as fsp from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

// As funções de verdade, copiadas antes do mock (o namespace importado passa a apontar para o mock).
const real = { ...fsp };
let full = false;
const enospc = () => Object.assign(new Error("ENOSPC: no space left on device, write"), { code: "ENOSPC", errno: -28, syscall: "write" });
mock.module("node:fs/promises", () => ({
  ...real,
  // O `writeDurable` do cofre: abre, escreve, faz o fsync.
  open: async (...args: Parameters<typeof real.open>) => {
    const fh = await real.open(...args);
    if (full && args[1] === "w") fh.writeFile = async () => { throw enospc(); };
    return fh;
  },
  // O `writeAtomic` da pasta de dados: o arquivo nasce vazio e a escrita falha.
  writeFile: async (...args: Parameters<typeof real.writeFile>) => {
    if (full && typeof args[0] === "string" && args[0].endsWith(".tmp")) {
      await real.writeFile(args[0], "");
      throw enospc();
    }
    return real.writeFile(...args);
  },
}));

const { Vault } = await import("./vault.ts");
const { writeAtomic } = await import("../store/files.ts");
const { uiCapabilities } = await import("../bun/ui-capabilities.ts");
const { directInvoke } = await import("../bun/ui-engine.ts");
const { DEFAULT_SETTINGS } = await import("../store/settings.ts");

const dirs: string[] = [];
afterEach(() => {
  full = false;
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
const tmp = () => {
  const d = mkdtempSync(path.join(tmpdir(), "kn-7444-full-"));
  dirs.push(d);
  return d;
};

test("cofre: o save que falha com o disco cheio não deixa .tmp na pasta, e a nota fica como estava", async () => {
  const root = path.join(tmp(), "Cofre");
  mkdirSync(root, { recursive: true });
  writeFileSync(path.join(root, "Diário.md"), "# Diário\n\nlinha boa\n");
  const v = new Vault({ root, debounceMs: 20, trash: async () => {} });
  await v.open();
  try {
    const note = await v.get("Diário.md");
    full = true;
    for (let i = 0; i < 3; i++) {
      await expect(v.save("Diário.md", `# Diário\n\nlinha boa\n${"y".repeat(1000 * (i + 1))}\n`, note.version)).rejects.toMatchObject({ code: "ENOSPC" });
    }
    full = false;
    expect(readFileSync(path.join(root, "Diário.md"), "utf8")).toBe("# Diário\n\nlinha boa\n");
    expect(readdirSync(root).filter((f) => f.endsWith(".tmp"))).toEqual([]);
  } finally {
    v.close();
  }
});

test("pasta de dados: o writeAtomic que falha com o disco cheio não deixa .tmp, e o arquivo fica como estava", async () => {
  const dir = tmp();
  const file = path.join(dir, "settings.json");
  writeFileSync(file, '{"version":1}\n');
  full = true;
  await expect(writeAtomic(file, '{"version":1,"ocr":false}\n')).rejects.toMatchObject({ code: "ENOSPC" });
  full = false;
  expect(readFileSync(file, "utf8")).toBe('{"version":1}\n');
  expect(readdirSync(dir).filter((f) => f.endsWith(".tmp"))).toEqual([]);
});

// T7942: o disco cheio chega à janela com um código próprio (pedido do lead, #7973), e não como E_FAILED.
test("pelas capacidades: o notes.save com o disco cheio dá E_DISK_FULL, sem .tmp e com a nota igual", async () => {
  const root = path.join(tmp(), "Cofre");
  mkdirSync(root, { recursive: true });
  writeFileSync(path.join(root, "Diário.md"), "linha boa\n");
  const vault = new Vault({ root, trash: async () => {} });
  const caps = uiCapabilities({
    dictionary: { load: async () => [], save: async (x) => x },
    snippets: { load: async () => [], save: async (x) => x },
    history: { search: async () => ({ entries: [] }), delete: async () => true, get: async () => null },
    dictationNotes: { toNew: async () => { throw new Error("not used"); }, append: async () => { throw new Error("not used"); } },
    settings: { load: async () => DEFAULT_SETTINGS, save: async () => DEFAULT_SETTINGS },
    clipboardWrite: () => {},
    notes: vault,
  });
  try {
    const note = (await directInvoke(caps, "notes.get", { path: "Diário.md" })) as { ok: true; value: { version: string } };
    full = true;
    const r = await directInvoke(caps, "notes.save", { path: "Diário.md", content: "outra coisa\n", baseVersion: note.value.version });
    full = false;
    expect(r).toMatchObject({ ok: false, code: "E_DISK_FULL" });
    expect((r as { message: string }).message).toContain("ENOSPC");
    expect(readFileSync(path.join(root, "Diário.md"), "utf8")).toBe("linha boa\n");
    expect(readdirSync(root).filter((f) => f.endsWith(".tmp"))).toEqual([]);
  } finally {
    vault.close();
  }
});

test("o registro da Lixeira (.kiwi-trash/registry.json) com o disco cheio não deixa .tmp", async () => {
  const root = path.join(tmp(), "Cofre");
  mkdirSync(root, { recursive: true });
  writeFileSync(path.join(root, "Velha.md"), "apagar\n");
  const v = new Vault({ root, trash: async () => {}, undoMs: 0 } as ConstructorParameters<typeof Vault>[0]);
  await v.open();
  try {
    full = true;
    await v.delete("Velha.md");
    await (v as unknown as { expireAll(): Promise<void> }).expireAll();
    full = false;
    const trash = path.join(root, ".kiwi-trash");
    expect(readdirSync(trash).filter((f) => f.endsWith(".tmp"))).toEqual([]);
  } finally {
    full = false;
    v.close();
  }
});
