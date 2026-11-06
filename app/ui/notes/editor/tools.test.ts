import { expect, test } from "bun:test";
import { EditorState, type TransactionSpec } from "@codemirror/state";
import { history, undo } from "@codemirror/commands";
import { splitAt, splitNote, textTool } from "./tools.ts";
function view(doc: string, from = 0, to = from) {
  let state = EditorState.create({ doc, selection: { anchor: from, head: to }, extensions: [history()] });
  return { get state() { return state; }, dom: { isConnected: true }, dispatch(spec: TransactionSpec) { state = state.update(spec).state; }, switchNote() { state = EditorState.create({doc: state.doc.toString(), selection: {anchor: state.selection.main.head}}); } };
}
test("line tools expand only selected lines, preserve the next line and have their own undo", () => {
 const v = view("fim\nitem10\nitem2\nitem2\nfora", 4, 23);
 const tr = textTool(v.state,"sort")!; v.dispatch(tr);
 expect(v.state.doc.toString()).toBe("fim\nitem2\nitem2\nitem10\nfora");
 v.dispatch(textTool(v.state,"deduplicate")!);
 expect(v.state.doc.toString()).toBe("fim\nitem2\nitem10\nfora");
 undo(v); expect(v.state.doc.toString()).toBe("fim\nitem2\nitem2\nitem10\nfora");
 undo(v); expect(v.state.doc.toString()).toBe("fim\nitem10\nitem2\nitem2\nfora");
});
test("case tools change exact selection including accents, no selection is a no-op", () => {
 const v = view("antes ação depois",6,10); v.dispatch(textTool(v.state,"uppercase")!);
 expect(v.state.doc.toString()).toBe("antes AÇÃO depois"); v.dispatch(textTool(v.state,"lowercase")!);
 expect(v.state.doc.toString()).toBe("antes ação depois"); expect(textTool(view("oi").state,"uppercase")).toBeNull();
});
test("split preserves every character and only truncates after successful creation", async () => {
 const v = view("Primeira.\n\nContinuação.",11);
 const parts = splitAt(v.state)!; expect(parts.head+parts.tail).toBe(v.state.doc.toString());
 let saved = "";
 const r = await splitNote(v,async tail => { expect(v.state.doc.toString()).toBe(parts.head+parts.tail); saved=tail; return "Parte.md"; });
 expect(r).toEqual({path:"Parte.md",moved:true}); expect(v.state.doc.toString()+saved).toBe(parts.head+parts.tail);
 undo(v); expect(v.state.doc.toString()).toBe(parts.head+parts.tail);
});
test("failed creation, edits, switch/closed view cannot truncate original",async () => {
 const v=view("antes depois",6); await expect(splitNote(v,async()=>{throw Error("disk");})).rejects.toThrow("disk"); expect(v.state.doc.toString()).toBe("antes depois");
 const r=await splitNote(v,async()=>{v.dispatch({changes:{from:0,insert:"novo "}});return "Parte.md";}); expect(r?.moved).toBe(false); expect(v.state.doc.toString()).toBe("novo antes depois");
 const switched=view("antes depois",6); expect((await splitNote(switched,async()=>{switched.switchNote();return "Parte.md";}))?.moved).toBe(false); expect(switched.state.doc.toString()).toBe("antes depois");
 const closed=view("antes depois",6); expect((await splitNote(closed,async()=>{closed.dom.isConnected=false;return "Parte.md";}))?.moved).toBe(false);
});
test("split rejects boundaries, selection and multiple cursors",async () => {
 expect(splitAt(view("oi").state)).toBeNull(); expect(splitAt(view("oi",2).state)).toBeNull(); expect(splitAt(view("oi",0,1).state)).toBeNull();
});
