// T10330: rigid ear angles in source coordinates; positive is counter-clockwise.
import { clamp, smooth, type FogState } from './state';
export type EarPose = readonly [number, number];
export interface EarEvent { kind: string; at: number; values: number[] }
interface Twitch { at: number; side: number; angle: number; go: number; hold: number; back: number }
const zero: EarPose = [0,0];
const blend = (a: EarPose,b: EarPose,u: number): EarPose => a.map((v,i)=>clamp(v+(b[i]!-v)*u,-25,25)) as unknown as EarPose;
export function fixedEars(state: FogState): EarPose {
 switch(state) {
  case 'dormindo':return [12,-12]; case 'acordou':return [-25,25];
  case 'agindo':return [-10,10]; case 'pronto':return [8,-8]; case 'erro':return [20,-20];
  default:return zero;
 }
}
export class EarGestures {
 private state: FogState;
 private entered: number;
 private now: number;
 private origin: EarPose = zero;
 private reduced = false;
 private settled = false;
 private settling = .24;
 private twitch: Twitch | null = null;
 private next = Infinity;
 private lastEnd = -Infinity;
 constructor(state: FogState,at: number,private options: {
  random: ()=>number;
  onEvent?: (event: EarEvent)=>void;
  /** Deadline owned by the eye channel: avoid gaze/twitch collisions. */
  blockedUntil?: (state: FogState)=>number;
 }) {this.state=state;this.entered=this.now=at;this.setState(state,at);}
 private range(a:number,b:number) {const r=this.options.random();return a+(b-a)*clamp(Number.isFinite(r)?r:.5,0,1-Number.EPSILON);}
 private arm(at:number) {
  this.next=this.reduced?Infinity:this.state==='repouso'?at+this.range(7,16):
   this.state==='thinking'?at+this.range(6,12):this.state==='ouvindo'?at+this.range(2.8,6.5):Infinity;
 }
 private end() {const g=this.twitch;return g?g.at+g.go+g.hold+g.back:Infinity;}
 get nextBoundary() {return Math.min(this.next,this.end());}
 blockingUntil() {return Math.max(this.twitch?this.end():-Infinity,this.lastEnd)+(this.state==='repouso'?.6:0);}
 nextWake(t:number) {
  const g=this.twitch;
  const phases=g?[g.at+g.go,g.at+g.go+g.hold,this.end()]:[];
  if(!this.settled) phases.push(...(this.state==='acordou'?[.2,.53,.72,1.4]:this.state==='pronto'?[.26,.42,.84]:this.state==='erro'?[.12,.82]:[this.state==='dormindo'?.7:this.state==='agindo'?.32:this.settling]).map(v=>this.entered+v));
  else phases.push(this.entered+this.settling);
  return this.reduced?Infinity:Math.min(this.nextBoundary,...phases.filter(v=>v>t+1e-8));
 }
 moving(t:number) {
  const end=this.settled?this.settling:this.state==='acordou'?1.4:this.state==='pronto'?.84:this.state==='erro'?.82:this.state==='dormindo'?.7:this.state==='agindo'?.32:this.settling;
  return !this.reduced && (!!this.twitch || t<this.entered+end);
 }
 advance(t:number) {
  t=Math.max(this.now,t);
  for(let n=0;this.nextBoundary<=t;n++) {
   if(n>100000)throw new Error('Ear scheduler did not advance');
   const at=this.nextBoundary;
   if(at===this.end()) {this.twitch=null;this.lastEnd=at;this.arm(at);}
   else {
    const blocked=this.options.blockedUntil?.(this.state)??-Infinity;
    if(blocked>at+1e-8){this.next=blocked;continue;}
    const listening=this.state==='ouvindo',thinking=this.state==='thinking';
    const side=this.range(0,1)<.5?0:1;
    const angle=this.range(listening?12:thinking?8:10,listening?25:thinking?14:22)*(side? -1:1)*(listening?-1:1);
    const go=listening?.18:thinking?.18:this.range(.12,.18),hold=listening?this.range(.35,.7):thinking?.08:this.range(.05,.1),back=listening?.36:thinking?.36:this.range(.22,.36);
    this.twitch={at,side,angle,go,hold,back};this.next=Infinity;
    this.options.onEvent?.({kind:listening?'orientar_orelha':thinking?'tique_pensando':'tique_orelha',at,values:[side,angle,go,hold,back]});
   }
  }
  this.now=t;
 }
 setState(state: FogState,t:number) {
  this.advance(t);this.origin=this.project(t);const from=this.state;
  this.state=state;this.entered=t;this.settled=false;this.settling=from==='acordou'&&state==='ouvindo'?.22:.24;
  this.twitch=null;this.lastEnd=-Infinity;this.arm(t+this.settling);
  const names:Partial<Record<FogState,string>>={dormindo:'relaxar_sono',acordou:'erguer_orelhas',agindo:'atencao_execucao',pronto:'satisfacao_orelhas',erro:'orelhas_aviao'};
  if(names[state])this.options.onEvent?.({kind:names[state]!,at:t,values:[...fixedEars(state)]});
 }
 setReduced(reduced:boolean,t:number) {
  if(this.reduced===reduced)return;
  this.advance(t);const before=this.project(t);this.reduced=reduced;
  this.origin=before;this.entered=t;this.settled=true;this.settling=.24;this.twitch=null;this.lastEnd=-Infinity;this.arm(t+.24);
 }
 resume(t:number) {
  this.origin=this.project(this.now);this.now=this.entered=t;this.settled=true;this.settling=.24;
  this.twitch=null;this.lastEnd=-Infinity;this.arm(t+.24);
 }
 project(t:number):EarPose {
  if(this.reduced)return fixedEars(this.state);
  const age=Math.max(0,t-this.entered);
  let pose:EarPose;
  if(this.settled) pose=blend(this.origin,this.state==='acordou'||this.state==='pronto'?zero:fixedEars(this.state),smooth(age/this.settling));
  else if(this.state==='acordou')pose=age<.2?this.origin:age<.53?blend(this.origin,[-25,25],smooth((age-.2)/.33)):age<.72?[-25,25]:blend([-25,25],zero,smooth((age-.72)/.68));
  else if(this.state==='pronto')pose=age<.26?blend(this.origin,[8,-8],smooth(age/.26)):age<.42?[8,-8]:blend([8,-8],zero,smooth((age-.42)/.42));
  else {
   const delay=this.state==='erro'?.12:0,duration=this.state==='erro'?.7:this.state==='dormindo'?.7:this.state==='agindo'?.32:this.settling;
   pose=blend(this.origin,fixedEars(this.state),smooth((age-delay)/duration));
  }
  const g=this.twitch;
  if(g) {const u=t-g.at;const strength=u<g.go?smooth(u/g.go):u<g.go+g.hold?1:1-smooth((u-g.go-g.hold)/g.back);const target:[number,number]=[...pose];target[g.side]=g.angle;pose=blend(pose,target,strength);}
  return pose;
 }
}
