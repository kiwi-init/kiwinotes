// T9567: event mapping without a renderer dependency.
import type { AgentTurnEvent } from "../../src/shared/ui-contract";
export type CatState = "repouso" | "acordou" | "thinking" | "agindo" | "pronto" | "erro";
export class CatActivity {
  state: CatState;
  private current: string | null = null;
  private finished = new Set<string>();
  constructor(busy: boolean) { this.state = busy ? "thinking" : "repouso"; }
  event(e: AgentTurnEvent): CatState {
    if (this.finished.has(e.id)) return this.state;
    if (e.type === "started") {
      if (this.current && this.current !== e.id) this.finished.add(this.current);
      this.current = e.id; this.state = "acordou";
    } else {
      if (this.current && this.current !== e.id) return this.state;
      this.current ??= e.id;
      if (e.type === "status") this.state = e.status === "running" ? "agindo" : "thinking";
      if (e.type === "done" || e.type === "error") {
        this.state = e.type === "error" ? "erro" : e.stopReason === "end_turn" ? "pronto" : "repouso";
        this.finished.add(e.id); this.current = null;
      }
    }
    return this.state;
  }
}
