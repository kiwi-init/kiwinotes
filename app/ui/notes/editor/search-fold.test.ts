import { expect, test } from "bun:test";
import { EditorState } from "@codemirror/state";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { codeFolding, ensureSyntaxTree, foldEffect, foldable, foldedRanges, unfoldEffect } from "@codemirror/language";
import { canonicalShortcut, NOTES_SHORTCUTS, SHORTCUTS, shortcutsConflict } from "../../../src/shared/shortcuts.ts";
import { TABLE_ACTIONS } from "./table.ts";
import { FORMAT_KEYS } from "./index.ts";
import { listFolding, SEARCH_KEYS } from "./search-fold.ts";
function mac(key:string) { const map:Record<string,string>={Mod:'command',Cmd:'command',Alt:'option',Shift:'shift',Ctrl:'control',ArrowUp:'up',ArrowDown:'down',ArrowLeft:'left',ArrowRight:'right',Backspace:'delete'};const result=canonicalShortcut(key.split('-').map(k=>map[k]??k.toLowerCase()).join('+')); return result; }
test('search shortcuts do not collide with Kiwi defaults, legacy presets, formatting or tables',()=>{
 // Punctuation-only editor bindings cannot collide with f/g; canonicalShortcut intentionally rejects them.
 const others=[...SHORTCUTS.map(x=>x.default),...NOTES_SHORTCUTS.map(x=>x.value),...TABLE_ACTIONS.flatMap(x=>x.key?[mac(x.key)]:[]),...FORMAT_KEYS.map(x=>mac(x.key))];
 const keys=SEARCH_KEYS.filter(x=>x.key?.startsWith('Mod')).flatMap(x=>[x.key!,...(x.shift?['Shift-'+x.key]:[])]).map(mac);
 expect(keys.every(Boolean)).toBe(true); expect(new Set(keys).size).toBe(keys.length);
 for(const key of keys) for(const other of others) if(key && other) expect(shortcutsConflict(key,other)).toBe(false);
 expect(shortcutsConflict(mac('Mod-f')!, 'command+f')).toBe(true);
});
function state(doc:string) {const s=EditorState.create({doc,extensions:[markdown({base:markdownLanguage}),listFolding,codeFolding()]});ensureSyntaxTree(s,s.doc.length,100);return s;}
test('heading folding stops at the next peer, preserves Markdown and maps with edits',()=>{
 let s=state('# Primeiro\nTexto\n## Filho\nMais\n# Segundo\nFim');const fold=foldable(s,0,s.doc.line(1).to)!;
 expect(s.sliceDoc(fold.from,fold.to)).toBe('\nTexto\n## Filho\nMais');
 s=s.update({effects:foldEffect.of(fold)}).state;expect(foldedRanges(s).size).toBe(1);
 const original=s.doc.toString();s=s.update({changes:{from:0,insert:'x'}}).state;expect(s.doc.toString()).toBe('x'+original);
 const mapped:{from:number;to:number}[]=[];foldedRanges(s).between(0,s.doc.length,(from,to)=>{mapped.push({from,to});});expect(mapped[0]).toEqual({from:fold.from+1,to:fold.to+1});
 s=s.update({effects:unfoldEffect.of(mapped[0]!)}).state;expect(foldedRanges(s).size).toBe(0);
});
test('lists fold their remaining lines, including nested items, without consuming following paragraph',()=>{
 for(const doc of ['- Um\n- Dois\n\nFora','1. Um\n2. Dois\n\nFora','- Pai\n  - Filho\n- Outro\n\nFora']) {
  const s=state(doc),r=foldable(s,0,s.doc.line(1).to)!;expect(r).not.toBeNull();expect(s.sliceDoc(r.from,r.to)).not.toContain('Fora');expect(s.sliceDoc(r.from,r.to)).toContain('\n');
 }
});
