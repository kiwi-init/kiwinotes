// A lista inteira no ar e os pedaços que chegam antes dela (spec #20118, U2, T20249; nimble-heron, #20361): o
// `notes.list` sai do engine antes do renomear, o aviso do renomear chega primeiro, e a lista não pode voltar velha.
// Cofre inventado (spec #17952).

import { describe, expect, test } from "bun:test";

import type { ListingPatch } from "../../src/shared/ui-contract.ts";
import { PatchedListing } from "./listing-patch.ts";
import type { NoteMeta, VaultListing } from "./types.ts";

const note = (path: string, version = "v1"): NoteMeta => {
  const slash = path.lastIndexOf("/");
  return {
    path,
    title: path.slice(slash + 1).replace(/\.md$/, ""),
    folder: slash < 0 ? "" : path.slice(0, slash),
    mtime: "2026-01-01T00:00:00.000Z",
    ctime: "2026-01-01T00:00:00.000Z",
    size: 10,
    version,
    tags: [],
  };
};
const listing = (...paths: string[]): VaultListing => ({ folders: ["Projeto X"], notes: paths.map((p) => note(p)), fileCounts: {} });
/** O pedaço de um renomear dentro de `Projeto X`, como o engine manda: os dois caminhos e o estado de agora. */
const rename = (from: string, to: string): ListingPatch => ({ roots: [from, to], folders: ["Projeto X"], notes: [note(to)], fileCounts: {} });

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}
const paths = (l: VaultListing | null) => l?.notes.map((n) => n.path);

describe("PatchedListing: os pedaços que chegam com a lista no ar", () => {
  test("o pedaço vai por cima da lista que saiu do engine antes dele", async () => {
    const pl = new PatchedListing();
    const before = listing("Ideias.md", "Projeto X/Plano.md");
    const get = deferred<VaultListing | null>();
    const fetching = pl.fetch(() => get.promise);
    const shown = pl.apply(before, rename("Projeto X/Plano.md", "Projeto X/Plano novo.md"));
    expect(paths(shown)).toEqual(["Ideias.md", "Projeto X/Plano novo.md"]);
    get.resolve(listing("Ideias.md", "Projeto X/Plano.md"));
    expect(paths(await fetching)).toEqual(["Ideias.md", "Projeto X/Plano novo.md"]);
  });

  test("dois pedaços, na ordem em que chegaram", async () => {
    const pl = new PatchedListing();
    const get = deferred<VaultListing | null>();
    const fetching = pl.fetch(() => get.promise);
    pl.apply(null, rename("Projeto X/Plano.md", "Projeto X/Plano novo.md"));
    pl.apply(null, rename("Projeto X/Plano novo.md", "Projeto X/Plano final.md"));
    get.resolve(listing("Ideias.md", "Projeto X/Plano.md"));
    expect(paths(await fetching)).toEqual(["Ideias.md", "Projeto X/Plano final.md"]);
  });

  test("a lista que já tinha o renomear fica igual (repetir não estraga)", async () => {
    const pl = new PatchedListing();
    const get = deferred<VaultListing | null>();
    const fetching = pl.fetch(() => get.promise);
    pl.apply(null, rename("Projeto X/Plano.md", "Projeto X/Plano novo.md"));
    get.resolve(listing("Ideias.md", "Projeto X/Plano novo.md"));
    expect(paths(await fetching)).toEqual(["Ideias.md", "Projeto X/Plano novo.md"]);
  });

  test("um pedaço depois que a lista voltou não entra na próxima", async () => {
    const pl = new PatchedListing();
    await pl.fetch(async () => listing("Ideias.md"));
    pl.apply(null, rename("Ideias.md", "Ideias boas.md"));
    expect(paths(await pl.fetch(async () => listing("Ideias.md")))).toEqual(["Ideias.md"]);
  });

  test("sem lista ainda, apply dá null (a janela pede uma); a lista que falha não fica presa", async () => {
    const pl = new PatchedListing();
    expect(pl.apply(null, rename("Ideias.md", "Ideias boas.md"))).toBeNull();
    await expect(pl.fetch(() => Promise.reject(new Error("falhou")))).rejects.toThrow("falhou");
    pl.apply(null, rename("Ideias.md", "Ideias boas.md"));
    expect(paths(await pl.fetch(async () => listing("Ideias.md")))).toEqual(["Ideias.md"]);
  });
});
