import { expect, test } from "bun:test";
import { EditorState } from "@codemirror/state";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { syntaxTree } from "@codemirror/language";
import { highlightSyntax } from "./highlight.ts";
import katex from "katex";
import { parseMarkdown } from "react-native-enriched-markdown/lib/module/web/parseMarkdown.js";
function ranges(doc:string) { const state=EditorState.create({doc,extensions:[markdown({base:markdownLanguage,extensions:[highlightSyntax]})]});const out:string[]=[];syntaxTree(state).iterate({enter(n){if(n.name==='Highlight')out.push(state.sliceDoc(n.from,n.to));}});return out; }
test('highlight syntax handles multiple ranges, nested Markdown, accents and excludes code/escaped/unclosed markers',()=>{
 expect(ranges('==ação== e ==**forte**==')).toEqual(['==ação==','==**forte**==']);
 for(const text of ['`==código==`','```\n==código==\n```','\\==escapado==','==sem fim','===sem realce===']) expect(ranges(text)).toEqual([]);
});
test('rendered parser emits highlight and both kinds of math, leaving code literal',async()=>{
 const ast=await parseMarkdown('==ação== e $x^2$\n\n$$\\frac{1}{2}$$\n\n`$x$ ==não==`',{highlight:true,latexMath:true});
 const nodes:any[]=[]; const walk=(n:any)=>{nodes.push(n);n.children?.forEach(walk);};walk(ast);
 expect(nodes.some(n=>n.type==='Highlight')).toBe(true);
 expect(nodes.some(n=>n.type==='LatexMathInline')).toBe(true); expect(nodes.some(n=>n.type==='LatexMathDisplay')).toBe(true);
 expect(nodes.find(n=>n.type==='Code')?.children?.map((n:any)=>n.content??'').join('')).toBe('$x$ ==não==');
});
test('KaTeX emits local MathML and malformed/untrusted expressions do not inject markup',()=>{
 const options={output:'mathml' as const,throwOnError:false,trust:false};
 expect(katex.renderToString('\\frac{1}{2}',options)).toContain('<mfrac>');
 expect(katex.renderToString('\\invalidcommand{',options)).toContain('katex-error');
 const html=katex.renderToString('\\href{https://exemplo.invalid}{x}',options); expect(html).not.toContain('href=');
 expect(katex.renderToString('<img src=x onerror=alert(1)>',options)).not.toContain('<img');
});
