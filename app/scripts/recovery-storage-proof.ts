// T5797: reproducible synthetic History proof. Fake sidecar, no helper/device/clipboard. DATA must not exist.
import { mkdir, readdir, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import assert from "node:assert/strict";
import { Dictation, type DictationSidecar } from "../src/bun/dictation.ts";
import { HistoryStore } from "../src/store/history.ts";
import { RecordingRecoveries } from "../src/store/recording-recovery.ts";
import type { Command, Event } from "../src/shared/ipc.ts";
const data = resolve(process.argv[2] ?? "/tmp/T5797-history-proof");
await mkdir(data); // exclusive fixture: never overwrite a person's data
const recovery = new RecordingRecoveries(data), history = new HistoryStore(data, recovery);
await mkdir(recovery.dir, { recursive: true, mode: 0o700 });
const ref = { id: crypto.randomUUID(), at: new Date().toISOString() };
const header = Buffer.alloc(44); header.write("RIFF"); header.writeUInt32LE(676,4);header.write("WAVEfmt ",8);
header.writeUInt32LE(16,16);header.writeUInt16LE(1,20);header.writeUInt16LE(1,22);header.writeUInt32LE(16000,24);header.writeUInt32LE(32000,28);header.writeUInt16LE(2,32);header.writeUInt16LE(16,34);header.write("data",36);header.writeUInt32LE(640,40);
await writeFile(join(recovery.dir,ref.id+".wav"),Buffer.concat([header,Buffer.alloc(640)]),{mode:0o600});
await writeFile(join(recovery.dir,ref.id+".json"),JSON.stringify(ref),{mode:0o600});
const listeners = new Map<string, Set<(e: any) => void>>();
let failedInsert = false;
const sidecar = { on(type:string,fn:(e:any)=>void) { let set=listeners.get(type); if(!set)listeners.set(type,set=new Set());set.add(fn);return()=>set!.delete(fn); },
 async send(command:Command) { if(command.type==='insert.text') { failedInsert=true;return {v:1,type:'result',id:'fake',ok:false,error:'insert_failed'}; }return {v:1,type:'result',id:'fake',ok:true,data:{}}; }
} as unknown as DictationSidecar;
const dictation = new Dictation({sidecar,history,recovery,dryRun:true,log:()=>{}});
dictation.attach();
const emit=(event:Event)=>{for(const fn of listeners.get(event.type)??[])fn({v:1,...event});};
emit({type:'record.started',reason:'debug',recovery:ref});
emit({type:'transcript.final',text:'Este texto já está seguro no Histórico.',raw:'Este texto já está seguro no Histórico.',lang:'pt',durationMs:20,latencyMs:1,recovery:ref});
await dictation.idle();dictation.detach();recovery.stop();
const entries=(await history.search()).entries,files=await readdir(recovery.dir);
assert(failedInsert);assert.equal(entries.length,1);assert(entries[0]!.text.includes('seguro no Histórico'));assert(!entries[0]!.recoveryId);assert.equal(files.length,0);
console.log(JSON.stringify({data,scenario:'fake insert_failed after History saved',failedInsert,historyText:entries[0]!.text,retryAvailable:!!entries[0]!.recoveryId,remainingRecoveryFiles:files.length},null,2));
