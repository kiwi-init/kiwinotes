import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, renameSync, unlinkSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Vault } from "./vault.ts";
import { until, untilSeen } from "./watch-wait.ts";
const opened: Vault[] = [], dirs: string[] = [];
afterEach(()=>{ for(const v of opened.splice(0))v.close();for(const d of dirs.splice(0))rmSync(d,{recursive:true,force:true}); });
async function vault(files:Record<string,string>,watch=false) {
  const root=mkdtempSync(path.join(tmpdir(),'kiwi-bm25-'));dirs.push(root);
  for(const [p,c] of Object.entries(files)){mkdirSync(path.dirname(path.join(root,p)),{recursive:true});writeFileSync(path.join(root,p),c);}
  const v=new Vault({root,watch,debounceMs:10,trash:async()=>{}});opened.push(v);await v.open();return{v,root};
}
const paths=(v:Vault,q:string)=>v.search(q).map(h=>h.path);
test("search returns more than 100 matching notes when requested", async () => {
  const files: Record<string, string> = {};
  for (let i = 0; i < 101; i++) files[`note${i}.md`] = "needle in content";
  const { v } = await vault(files);
  expect(v.search("needle", 101)).toHaveLength(101);
});

test("literal substrings, phrases and punctuation are preserved alongside BM25", async () => {
  const { v } = await vault({ "A.md": "programa C++", "B.md": "gramado C language" });
  expect(paths(v, '"gram"').sort()).toEqual(["A.md", "B.md"]);
  expect(paths(v, "gram").sort()).toEqual(["A.md", "B.md"]);
  expect(paths(v, "C++")).toEqual(["A.md"]);
  expect(paths(v, "programa++")).toEqual([]);
  expect(paths(v, "gram language")).toEqual(["B.md"]);
});

test("stemmed lexical search, prefixes and all existing literal filters",async()=>{
  const {v}=await vault({'P/A.md':'#projeto Organização das reuniões. Decidimos o\norçamento.','B.md':'#outro Organizando as reuniões. rascunho'});
  expect(paths(v,'organizar')).toEqual(expect.arrayContaining(['P/A.md','B.md']));
  expect(paths(v,'organizacoes path:p tag:projeto -rascunho')).toEqual(['P/A.md']);
  expect(paths(v,'organizar "decidimos o orcamento"')).toEqual(['P/A.md']);
  expect(paths(v,'"organizar"')).toEqual([]);
  expect(paths(v,'reuniao')).toEqual(expect.arrayContaining(['P/A.md','B.md']));
  expect(paths(v,'org')).toHaveLength(2);
  expect(v.search('reuniao').every(h=>!h.approx)).toBe(true);
  expect(v.search('organizacoes')[0]!.snippet).toContain('Organi');
});
test("fuzzy only without lexical results, and a typo can combine with a PT root",async()=>{
  const {v}=await vault({'A.md':'organização reunião', 'B.md':'organização reunaio'});
  expect(paths(v,'reuniao')).toEqual(['A.md']);
  expect(v.search('organizacoes reunaio').map(h=>[h.path,!!h.approx])).toEqual([['B.md',false]]);
  await v.delete('B.md');
  expect(v.search('organizacoes reunaio').map(h=>[h.path,!!h.approx])).toEqual([['A.md',true]]);
});
test("postings follow save, filename/folder rename, delete, restore and cached rescan",async()=>{
  const {v,root}=await vault({'P/A.md':'antigo'});
  const a=await v.get('P/A.md');await v.save(a.path,'organização',a.version);
  expect(paths(v,'antigo')).toEqual([]);expect(paths(v,'organizar')).toEqual(['P/A.md']);
  await v.rename('P/A.md','P/Novo.md');expect(paths(v,'novo')).toEqual(['P/Novo.md']);
  await v.moveFolder('P','Q');expect(paths(v,'organizar')).toEqual(['Q/Novo.md']);
  const index=(v as any).searchIndex, updates=index.updates;
  expect(paths(v,'organizar')).toEqual(['Q/Novo.md']);expect(index.updates).toBe(updates);
  await v.delete('Q/Novo.md');expect(paths(v,'organizar')).toEqual([]);
  await v.restore('Q/Novo.md');expect(paths(v,'organizar')).toEqual(['Q/Novo.md']);
  expect(readdirSync(root).filter(n=>/sqlite|index|search/.test(n))).toEqual([]);
});
test("external save, move and delete update postings through the watcher",async()=>{
  const {v,root}=await vault({'A.md':'primeiro'},true);
  await untilSeen(n=>writeFileSync(path.join(root,'A.md'),`organização ${n}`),()=>paths(v,'organizar')[0]==='A.md','A.md saved outside');
  renameSync(path.join(root,'A.md'),path.join(root,'Novo.md'));await until(()=>paths(v,'organizar')[0]==='Novo.md','A.md renamed outside');
  unlinkSync(path.join(root,'Novo.md'));await until(()=>!paths(v,'organizar').length,'Novo.md deleted outside');
},20_000);
test("separate vaults never share postings, aliases can be found, and reopening rebuilds in memory",async()=>{
  const one=await vault({'A.md':'---\naliases: [Organização]\n---\nTexto local'}), two=await vault({'B.md':'outra pasta'});
  expect(paths(one.v,'organizar')).toEqual(['A.md']);expect(paths(two.v,'organizar')).toEqual([]);
  one.v.close();const reopened=new Vault({root:one.root});opened.push(reopened);await reopened.open();expect(paths(reopened,'organizar')).toEqual(['A.md']);
});
