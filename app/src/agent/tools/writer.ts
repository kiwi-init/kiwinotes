// O que as ferramentas de escrita do Kiwi gravam (spec #8356): pelas mesmas capacidades que a janela das Notas usa,
// na pasta de notas aberta agora e com a mesma fronteira do cofre (só `.md`, sem `..`, sem link simbólico para fora).
//
// - **A gravação é condicional:** o `notes.save` só escreve se a nota ainda está na versão lida; senão devolve a de
//   agora, sem escrever. É o mesmo salvar das Notas, então o texto novo entra no histórico de versões.
// - **A cópia de antes nas Versões:** o `notes.save` vai com `snapshot: true`, e o texto de antes vira uma versão na
//   hora, sem o intervalo de 2 minutos do histórico.
// - **Nada apaga, renomeia nem move:** o escritor só conhece quatro capacidades (`notes.get`, `notes.save`,
//   `notes.create` e `notes.folder`), e nenhuma outra passa por ele.

/** A nota que o escritor lê antes de mudar. */
export interface WriterNote {
  path: string;
  title: string;
  content: string;
  version: string;
  /** A nota não é UTF-8: o Kiwi só mostra, e nada grava por cima. */
  readOnly?: boolean;
}

export interface VaultWriter {
  get(path: string): Promise<WriterNote>;
  /** Grava se ninguém mudou a nota desde `baseVersion`, guardando antes o texto de agora nas Versões. */
  save(path: string, content: string, baseVersion: string): Promise<{ saved: true; path: string; version: string } | { saved: false }>;
  /** Uma nota nova; com o título já usado na pasta, ela ganha um número ("Título 2"). */
  create(folder: string, title: string, content: string): Promise<WriterNote>;
  /** O id da pasta de notas aberta, ou null num app que não troca de pasta. */
  folder(): Promise<string | null>;
}

/** As únicas capacidades que o escritor chama. */
export const WRITER_CAPABILITIES = ["notes.get", "notes.save", "notes.create", "notes.folder"] as const;
type WriterCapability = (typeof WRITER_CAPABILITIES)[number];

type NoteResult = { path: string; title: string; content: string; version: string; readOnly?: boolean };

const note = (n: NoteResult): WriterNote => ({
  path: n.path,
  title: n.title,
  content: n.content,
  version: n.version,
  ...(n.readOnly ? { readOnly: true } : {}),
});

/** O escritor sobre as capacidades do app (as de `uiCapabilities`): só as quatro acima. */
export function writerFromCapabilities(caps: Record<WriterCapability, (args: unknown) => unknown>): VaultWriter {
  const call = async <T>(cap: WriterCapability, args: unknown): Promise<T> => (await caps[cap](args)) as T;
  return {
    get: async (path) => note(await call<NoteResult>("notes.get", { path })),
    save: async (path, content, baseVersion) => {
      const r = await call<{ saved: true; meta: { path: string; version: string } } | { saved: false }>("notes.save", {
        path,
        content,
        baseVersion,
        snapshot: true,
      });
      return r.saved ? { saved: true, path: r.meta.path, version: r.meta.version } : { saved: false };
    },
    create: async (folder, title, content) => note(await call<NoteResult>("notes.create", { folder, title, content })),
    folder: async () => {
      try {
        return (await call<{ current?: { id?: string } }>("notes.folder", {})).current?.id ?? null;
      } catch {
        // O engine sem pastas (`E_NO_FOLDERS`): só há uma.
        return null;
      }
    },
  };
}
