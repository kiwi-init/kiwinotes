import { afterEach, expect, test } from "bun:test";
import { NoteSearchIndex, lexicalQuery } from "./search-index.ts";
import { lexicalForms } from "../shared/lexical.ts";
const opened: NoteSearchIndex[] = [];
afterEach(()=>{for(const i of opened.splice(0))i.close();});
function index(files:Record<string,string>) {
  const i=new NoteSearchIndex();opened.push(i);
  i.sync(Object.entries(files).map(([path,content])=>({meta:{path,title:path.replace('.md',''),version:content},aliases:[],content})));
  return i;
}
test("BM25 rewards frequency with saturation and normalizes document length",()=>{
  const i=index({'A.md':'orçamento reunião', 'B.md':'orçamento orçamento orçamento reunião', 'C.md':'orçamento '+('assunto '.repeat(200))});
  const hits=i.search(['orçamento'],[]);
  expect(hits.map(h=>h.path)).toEqual(['B.md','A.md','C.md']);
  expect(hits.every(h=>Number.isFinite(h.score)&&h.score>0)).toBe(true);
});
test("Portuguese derivations, nasal plurals and accent-free queries share roots",()=>{
  const i=index({'A.md':'organização das reuniões, ações e projetos'});
  for(const q of ['organizar','organizações','organizacoes','reunião','reuniao','ação','acao','projeto'])expect(i.search([q],[]).map(h=>h.path)).toEqual(['A.md']);
  expect(lexicalForms('organização')).toContain('organiz');
});
test("query operators stay literal and never become FTS/SQL syntax",()=>{
  const i=index({'A.md':'sqlite notas'});
  expect(()=>i.search(['" OR * NOT ( NEAR )'],[])).not.toThrow();
  expect(lexicalQuery(['projet'],[])).toContain('"projet"*');
  expect(i.search(['2025'],[])).toEqual([]);
});
test("incremental sync removes stale postings and does not retokenize unchanged notes",()=>{
  const i=index({'A.md':'primeiro','B.md':'segundo'});
  expect(i.updates).toBe(2);
  const a={meta:{path:'A.md',title:'A',version:'primeiro'},aliases:[],content:'primeiro'};
  i.sync([a]);expect(i.updates).toBe(2);expect(i.search(['segundo'],[])).toEqual([]);
  i.sync([{...a,meta:{...a.meta,version:'novo'},content:'terceiro'}]);
  expect(i.search(['primeiro'],[])).toEqual([]);expect(i.search(['terceiro'],[])).toHaveLength(1);
});
test("canonical and decomposed Unicode accents produce the same lexical terms",()=>{
  const i=index({'A.md':'Organização'.normalize('NFD')});
  expect(i.search(['organizar'],[]).map(h=>h.path)).toEqual(['A.md']);
  expect(i.search(['organizações'.normalize('NFD')],[]).map(h=>h.path)).toEqual(['A.md']);
});
