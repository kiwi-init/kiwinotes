import { afterEach, expect, test } from "bun:test";
import { mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tempDir } from "../../test/tmp.ts";
import path from "node:path";
import { Vault } from "./vault.ts";
const opened: Vault[] = [], dirs: string[] = [];
afterEach(() => { for(const v of opened.splice(0))v.close(); for(const d of dirs.splice(0))rmSync(d,{recursive:true,force:true}); });
async function fixture(files:Record<string,string>) {
  const root=tempDir('kiwi-e11-');dirs.push(root);
  for(const [p,s] of Object.entries(files)){mkdirSync(path.dirname(path.join(root,p)),{recursive:true});writeFileSync(path.join(root,p),s);}
  const v=new Vault({root});opened.push(v);await v.open();return {v,root};
}
test("file title rename updates real wiki/Markdown links, preserving code and aliases", async()=>{
  const {v}=await fixture({'A.md':'---\naliases: [Apelido]\n---\n# Seção', 'B.md':'[[A#Seção|texto]] [[Apelido]] [texto](A.md#seção)\n`[[A]]`\n<!-- [[A]] -->'});
  const r=await v.rename('A.md','Nova.md');
  expect(r.updatedLinks).toBe(2);
  expect((await v.get('B.md')).content).toBe('[[Nova#Seção|texto]] [[Apelido]] [texto](Nova.md#seção)\n`[[A]]`\n<!-- [[A]] -->');
});
test("heading rename updates incoming and local fragments, keeping aliases and other headings", async()=>{
  const {v}=await fixture({'A.md':'---\naliases: [Apelido]\n---\n# Antigo ##\n\n[[#Antigo|local]]\n## Outra', 'B.md':'[[Apelido#Antigo|rótulo]] [seção](A.md#antigo)\n`[[A#Antigo]]`'});
  const a=await v.get('A.md');
  const r=await v.renameHeading('A.md',a.content.indexOf('# Antigo'), 'Novo título',a.version);
  expect(r.updatedNotes).toBe(2); expect(r.updatedReferences).toBe(3);
  expect((await v.get('A.md')).content).toContain('# Novo título ##\n\n[[#Novo título|local]]\n## Outra');
  expect((await v.get('B.md')).content).toBe('[[Apelido#Novo título|rótulo]] [seção](A.md#Novo%20t%C3%ADtulo)\n`[[A#Antigo]]`');
  expect(await v.linkWarnings('B.md')).toEqual([]);
});
test("stale heading rename and duplicate destination leave all notes untouched", async()=>{
  const {v}=await fixture({'A.md':'# Um\n\n# Dois', 'B.md':'[[A#Um]]'});
  const a=await v.get('A.md');
  await expect(v.renameHeading('A.md',0,'Dois',a.version)).rejects.toMatchObject({code:'E_EXISTS'});
  await v.save('A.md','# Um\n\n# Dois\nedição',a.version);
  await expect(v.renameHeading('A.md',0,'Novo',a.version)).rejects.toMatchObject({code:'E_CONFLICT'});
  expect((await v.get('B.md')).content).toBe('[[A#Um]]');
});
test("tag rename updates descendants in body and frontmatter, leaving other fields intact", async()=>{
  const {v}=await fixture({'A.md':`---\naliases: [projeto]\ntags: [projeto, 'projeto/kiwi'] # ok\n---\n#Projeto #projetor\n\`#projeto\``, 'B.md':'#projeto/sub'});
  const r=await v.renameTag('projeto','trabalho');
  expect(r.updatedNotes).toBe(2); expect(r.updatedReferences).toBe(4);
  expect((await v.get('A.md')).content).toBe(`---\naliases: [projeto]\ntags: [trabalho, 'trabalho/kiwi'] # ok\n---\n#trabalho #projetor\n\`#projeto\``);
  expect((await v.get('B.md')).tags).toEqual(['trabalho/sub']);
});
test("tag destination collision and invalid title have no side effects", async()=>{
  const {v}=await fixture({'A.md':'#old #new # Título'});
  await expect(v.renameTag('old','new')).rejects.toMatchObject({code:'E_EXISTS'});
  await expect(v.renameTag('old','a b')).rejects.toMatchObject({code:'E_BAD_ARGS'});
  const a=await v.get('A.md');
  await expect(v.renameHeading('A.md',0,'a\nb',a.version)).rejects.toMatchObject({code:'E_BAD_ARGS'});
  expect((await v.get('A.md')).content).toBe(a.content);
});
test("CAS retries concurrent text changes without losing them; repeated conflicts are reported", async()=>{
  const {v,root}=await fixture({'A.md':'#old'});
  let once=true;
  (v as any).beforeReplace=()=>{if(once){once=false;writeFileSync(path.join(root,'A.md'),'#old\ntexto externo');}};
  expect((await v.renameTag('old','new')).skippedPaths).toEqual([]);
  expect((await v.get('A.md')).content).toBe('#new\ntexto externo');
  let n=0;
  (v as any).beforeReplace=()=>writeFileSync(path.join(root,'A.md'),'#new\nexterno '+(++n));
  const r=await v.renameTag('new','end');
  expect(r.skippedPaths).toEqual(['A.md']);expect(r.updatedNotes).toBe(0);
  expect(readFileSync(path.join(root,'A.md'),'utf8')).toBe('#new\nexterno 3');
});
test("missing-note/heading warnings include aliases and local fragments, ignoring literals/assets/external URLs", async()=>{
  const {v}=await fixture({'A.md':'---\naliases: [Apelido]\n---\n# Existe', 'B.md':'[[Sumiu]]\n[[Apelido#Existe]]\n[[A#Inexistente]]\n[[#Local]]\n`[[Sumiu]]`\n[imagem](x.png) [site](https://x.test)\n# Local'});
  expect(await v.linkWarnings('B.md')).toEqual([
    {path:'B.md',target:'Sumiu',reason:'note',line:1},
    {path:'B.md',target:'A#Inexistente',reason:'heading',line:3},
  ]);
});
test("heading source losing a write race aborts before any incoming reference changes", async()=>{
  const {v,root}=await fixture({'A.md':'# Antigo', 'B.md':'[[A#Antigo]]'});
  const a=await v.get('A.md');
  (v as any).beforeReplace=()=>writeFileSync(path.join(root,'A.md'),'# Antigo\nexterno');
  await expect(v.renameHeading('A.md',0,'Novo',a.version)).rejects.toMatchObject({code:'E_CONFLICT'});
  expect(readFileSync(path.join(root,'A.md'),'utf8')).toBe('# Antigo\nexterno');
  expect(readFileSync(path.join(root,'B.md'),'utf8')).toBe('[[A#Antigo]]');
});
// Achado na revisão do T7877: o link de uma propriedade (`up: "[[A]]"`, o tipo "link" do painel de Propriedades, T6598)
// conta nos backlinks, mas o renomear não o reescreve. Depois do rename, ele aponta para uma nota que não existe, e os
// backlinks da nota nova não o mostram. O Obsidian reescreve os links das propriedades no rename.
test("rename reescreve os [[links]] das propriedades do frontmatter, e mantém o resto do YAML", async()=>{
  const {v}=await fixture({'A.md':'# A', 'B.md':'---\nup: "[[A]]"\nrel:\n  - "[[A|o A]]"\n  - "[[Outra]]"\ntitulo: A\n---\ncorpo\n', 'Outra.md':'x'});
  expect((await v.backlinks('A.md')).map((b:any)=>b.path??b)).toContain('B.md');
  const r=await v.rename('A.md','Nova.md');
  expect((await v.get('B.md')).content).toBe('---\nup: "[[Nova]]"\nrel:\n  - "[[Nova|o A]]"\n  - "[[Outra]]"\ntitulo: A\n---\ncorpo\n');
  expect(r.updatedLinks).toBe(2);
  expect((await v.backlinks('Nova.md')).map((b:any)=>b.path??b)).toContain('B.md');
});

// T7986: o resto do jeito de escrever as propriedades, e o que não dá para trocar no lugar.
test("propriedades: aspas simples, comentário, #título, [x](caminho) e texto com link ficam no estilo; bloco | e YAML ruim vão para o skippedPaths", async()=>{
  const {v}=await fixture({
    'Pessoas/A.md':'# A',
    'B.md':"---\n# quem é o chefe\nup: '[[A#Topo|o chefe]]'\nveja: ver [[A]] e [[Outra]]\nsite: \"[a](Pessoas/A.md)\"\n---\ncorpo [[A]]\n",
    'Bloco.md':'---\nnota: |\n  sobre [[A]]\n---\n',
    'Ruim.md':'---\nup: "[[A]]\nx: [\n---\n[[A]]\n',
    'Outra.md':'x',
  });
  const r=await v.rename('Pessoas/A.md','Gente/Nova.md');
  expect((await v.get('B.md')).content).toBe("---\n# quem é o chefe\nup: '[[Nova#Topo|o chefe]]'\nveja: ver [[Nova]] e [[Outra]]\nsite: \"[a](Gente/Nova.md)\"\n---\ncorpo [[Nova]]\n");
  // O bloco `|` não se troca no lugar; o corpo dele (sem link) fica, e a nota sai no skippedPaths.
  expect((await v.get('Bloco.md')).content).toBe('---\nnota: |\n  sobre [[A]]\n---\n');
  // O YAML que não se lê: o corpo é reescrito, o frontmatter fica, e ela também vai para o skippedPaths.
  expect((await v.get('Ruim.md')).content).toBe('---\nup: "[[A]]\nx: [\n---\n[[Nova]]\n');
  expect(r.skippedPaths.sort()).toEqual(['Bloco.md','Ruim.md']);
  expect(r.updatedLinks).toBe(5);
});
