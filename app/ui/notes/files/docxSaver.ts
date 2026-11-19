// A gravação do docx editado nas Notas (T21152, spec #21080), como a da nota e a da planilha: um instante depois da
// última edição, pelo `files.save` com a versão do arquivo no disco. Se outro app mudou o arquivo, vale o de lá, e a
// barra avisa. Os bytes são pegos do motor na hora (antes de fechar o documento, quando a pessoa sai dele); a gravação
// em si corre depois.

import { base64Of } from "./csv.ts";
import type { FilesApi } from "./viewers.ts";

/** Quanto a gravação espera depois da última edição (ms), como a planilha. */
export const DOCX_SAVE_DELAY = 400;

export const CHANGED_OUTSIDE = "O arquivo mudou fora do Kiwi: abri a versão nova, e a última edição não foi gravada.";
export const SAVE_FAILED = "Não deu para gravar este documento agora. O Kiwi tenta de novo na próxima edição.";

export interface DocxSaverOptions {
  path: string;
  files: Pick<FilesApi, "saveBytes">;
  /** O docx de agora, do motor. Chamado só quando há o que gravar. */
  bytes(): Uint8Array;
  notice(text: string | null): void;
  /** Outro app gravou antes de nós: abrir estes bytes no lugar. */
  reload(base64: string, version: string): void;
  delay?: number;
}

export class DocxSaver {
  /** A versão do disco que as edições têm por base. */
  private disk: string;
  private dirty = false;
  /** Os bytes (base64) da nossa última gravação: a leitura que volta com eles não reabre nada. */
  private written: string | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private saving: Promise<boolean> | null = null;
  /** O gato está tocando na tela (T21231): a edição da pessoa espera para gravar. */
  private held = false;

  constructor(
    private readonly o: DocxSaverOptions,
    version: string,
  ) {
    this.disk = version;
  }

  get canSave(): boolean {
    return !!this.o.files.saveBytes;
  }

  get pending(): boolean {
    return this.dirty;
  }

  /** Há edição da pessoa que o disco ainda não tem: por gravar, ou gravando agora (T21231). */
  get unsaved(): boolean {
    return this.dirty || !!this.saving;
  }

  /** O documento foi aberto de novo, com estes bytes do disco: as edições de antes não valem mais. */
  opened(version: string): void {
    this.cancel();
    this.held = false;
    this.disk = version;
    this.dirty = false;
  }

  /**
   * O arquivo no disco mudou. `true`: são os bytes que nós gravamos, e nada reabre. `false`: veio de fora, e o
   * documento abre de novo (com o aviso, se havia edição que não foi gravada).
   */
  incoming(base64: string, version: string): boolean {
    if (base64 === this.written) {
      if (!this.saving) this.disk = version;
      return true;
    }
    if (version === this.disk) return true;
    if (this.dirty) this.o.notice(CHANGED_OUTSIDE);
    this.opened(version);
    return false;
  }

  /** Estes bytes são os nossos, ou esta versão é a que já temos: nada a abrir. */
  known(base64: string, version: string): boolean {
    return base64 === this.written || version === this.disk;
  }

  /**
   * O gato vai tocar as mudanças dele na tela (T21231): até o `release`, nada grava (os bytes da tela estariam no meio,
   * sobre a versão de antes dele).
   */
  hold(): void {
    this.cancel();
    this.held = true;
  }

  /** O fim do `hold`: a edição da pessoa que esperou grava agora, por cima da versão do gato. */
  release(): void {
    if (!this.held) return;
    this.held = false;
    if (this.dirty) this.edited();
  }

  /**
   * O agente gravou o arquivo, e as mudanças dele já estão na tela (T21231, `play(docxOps)`): a versão dele vira a base,
   * sem reabrir e sem aviso. Uma edição da pessoa que ainda não foi gravada segue, agora por cima da versão do agente.
   */
  adopt(version: string): void {
    this.disk = version;
  }

  /** A pessoa editou: grava daqui a pouco. */
  edited(): void {
    if (!this.canSave) return;
    this.dirty = true;
    this.cancel();
    if (this.held) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, this.o.delay ?? DOCX_SAVE_DELAY);
  }

  /** Grava agora o que falta. Os bytes saem do motor nesta chamada, antes de qualquer espera. */
  flush(): Promise<boolean> {
    this.cancel();
    if (this.held || !this.dirty || !this.o.files.saveBytes) return this.saving ?? Promise.resolve(true);
    let b64: string;
    try {
      b64 = base64Of(this.o.bytes());
    } catch {
      this.o.notice(SAVE_FAILED);
      return Promise.resolve(false);
    }
    this.dirty = false;
    const before = this.saving;
    const run = (async () => {
      if (before) await before;
      return this.write(b64);
    })();
    this.saving = run;
    void run.finally(() => {
      if (this.saving === run) this.saving = null;
    });
    return run;
  }

  dispose(): void {
    this.cancel();
  }

  private async write(b64: string): Promise<boolean> {
    try {
      this.written = b64;
      const base = this.disk;
      const r = await this.o.files.saveBytes!(this.o.path, b64, this.disk);
      if (r.saved) {
        this.disk = r.version;
        return true;
      }
      // Foi o gato, que está tocando a versão dele na tela agora (T21231): a edição da pessoa já está na tela por cima
      // dela, e grava de novo no `release`, sobre a versão dele. Se a tela não bater, o documento abre do disco.
      // Ou o gato já tocou e a tela adotou a versão dele (a recusa chegou depois): grava de novo, por cima dela.
      if (this.held || ("version" in r.current && r.current.version === this.disk && base !== this.disk)) {
        this.dirty = true;
        if (!this.held) this.edited();
        return false;
      }
      // Mudou no disco desde a nossa versão: vale o arquivo de lá, como numa nota com conflito.
      this.o.notice(CHANGED_OUTSIDE);
      if ("base64" in r.current) {
        this.opened(r.current.version);
        this.o.reload(r.current.base64, r.current.version);
      }
      return false;
    } catch {
      this.written = null;
      this.dirty = true;
      this.o.notice(SAVE_FAILED);
      return false;
    }
  }

  private cancel(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
}
