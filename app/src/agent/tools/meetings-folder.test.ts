// As reuniões com outra pasta de notas aberta (T26083): elas moram na pasta interna do app, e o agente as lê, lista e
// acha pelos caminhos que o `meetings_list` dá. Tudo inventado, num tmp.

import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, realpath, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { NotesFolders } from "../../notes/folders-workspace.ts";
import { Vault } from "../../notes/vault.ts";
import { SettingsStore } from "../../store/settings.ts";
import { HistoryStore } from "../../store/history.ts";
import { uiCapabilities, type CapabilityDeps } from "../../bun/ui-capabilities.ts";
import { readerFromCapabilities } from "./reader.ts";
import { runKiwiTool } from "./tools.ts";
import { tempDir } from "../../../test/tmp.ts";

const MEETING = `---
type: meeting
date: 2026-11-10
start: 2026-11-10T14:00:00.000Z
end: 2026-11-10T14:30:00.000Z
duration: 1800
app: Teams
---

## Transcrição

**Ana** (00:00): Bom dia, vamos falar da jabuticaba.
`;
const NAME = "2026-11-10 1400 Reunião do Teams";

const rigs: { root: string; folders: NotesFolders }[] = [];
afterEach(async () => {
  for (const r of rigs.splice(0)) {
    await r.folders.close();
    await rm(r.root, { recursive: true, force: true });
  }
});

/** O app com a pasta interna (as reuniões, com os nomes em NFD, como o Finder grava) e, se `open`, outra pasta aberta. */
async function rig(open: boolean, other: Record<string, string> = {}) {
  const root = await realpath(tempDir("kn-meet-folder-"));
  const home = path.join(root, "home"),
    dir = path.join(root, "dados"),
    defaultRoot = path.join(home, "KiwiNotes"),
    a = path.join(home, "Projeto X");
  await mkdir(path.join(defaultRoot, "Reuniões".normalize("NFD")), { recursive: true });
  await writeFile(path.join(defaultRoot, "Reuniões".normalize("NFD"), `${NAME}.md`.normalize("NFD")), MEETING);
  for (const [p, text] of Object.entries(other)) {
    await mkdir(path.dirname(path.join(a, p)), { recursive: true });
    await writeFile(path.join(a, p), text);
  }
  await mkdir(a, { recursive: true });
  const internalNotes = new Vault({ root: defaultRoot, watch: false, trash: async (p) => rm(p, { recursive: true, force: true }) });
  const folders = new NotesFolders({ dir, defaultRoot, globalSettings: new SettingsStore(dir), internalNotes, home, watch: false, limit: 20_000 });
  rigs.push({ root, folders });
  const caps = uiCapabilities({
    ...folders.fixed,
    notesFolders: folders,
    chooseNotesFolder: async () => a,
    history: new HistoryStore(dir),
    dictionary: { load: async () => [], save: async () => [] },
    snippets: { load: async () => [], save: async () => [] },
    clipboardWrite: () => {},
    settingsChanged: () => {},
  } as CapabilityDeps);
  if (open) expect(await caps["notes.openFolder"]({})).toMatchObject({ kind: "opened" });
  const reader = readerFromCapabilities(caps as never);
  const tool = async (name: string, args: unknown) => (await runKiwiTool({ reader }, name, args)).value as any;
  const listed = (await tool("meetings_list", {})).reunioes as { path: string }[];
  expect(listed.length).toBe(1);
  return { tool, path: listed[0]!.path };
}

describe("as reuniões com outra pasta aberta (T26083)", () => {
  for (const open of [false, true]) {
    test(`a reunião da lista se lê, se acha pelo nome, pela pasta e pelo texto (${open ? "outra pasta aberta" : "a pasta padrão"})`, async () => {
      const { tool, path: p } = await rig(open, { "Ideias.md": "# Ideias\n\ncaju\n" });
      expect(p.normalize("NFC")).toBe(`Reuniões/${NAME}.md`);
      // Ler, pelo caminho exato da lista: como reunião, como nota, e pelo título.
      expect(JSON.stringify(await tool("meetings_get", { path: p }))).toContain("jabuticaba");
      expect(JSON.stringify(await tool("notes_read", { path: p }))).toContain("jabuticaba");
      expect(JSON.stringify(await tool("notes_read", { path: NAME }))).toContain("jabuticaba");
      // A pasta Reuniões no achar, com a reunião dentro.
      expect(JSON.stringify(await tool("notes_list", { folder: "Reuniões" }))).toContain(NAME);
      // E a busca de texto.
      expect(JSON.stringify(await tool("notes_search", { query: "jabuticaba" })).normalize("NFC")).toContain(`Reuniões/${NAME}.md`);
      // A pasta aberta continua inteira.
      if (open) expect(JSON.stringify(await tool("notes_read", { path: "Ideias.md" }))).toContain("caju");
    });
  }

  test("um arquivo da pasta aberta com o mesmo caminho da reunião não toma o lugar dela (revisão #26093)", async () => {
    const { tool, path: p } = await rig(true, { [`Reuniões/${NAME}.md`]: "# Outra coisa\n\npitanga\n" });
    for (const read of [await tool("meetings_get", { path: p }), await tool("notes_read", { path: p })]) {
      expect(JSON.stringify(read)).toContain("jabuticaba");
      expect(JSON.stringify(read)).not.toContain("pitanga");
    }
    // Na pasta e na busca, o caminho é um só, o da reunião.
    const inFolder = (await tool("notes_list", { folder: "Reuniões" })).notas as { path: string; caracteres: number }[];
    expect(inFolder.length).toBe(1);
    // O tamanho é o da reunião (perto do texto dela), não o do arquivo curto da pasta aberta.
    expect(inFolder[0]!.caracteres).toBeGreaterThan(MEETING.length - 10);
    expect(JSON.stringify(await tool("notes_search", { query: "pitanga" }))).not.toContain(NAME);
  });
});
