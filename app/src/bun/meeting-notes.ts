import type { Event, EventMessage } from "../shared/ipc.ts";
import type { MeetingNotes } from "../notes/meetings.ts";

export interface MeetingEvents {
  on<T extends Event["type"]>(
    type: T,
    fn: (event: EventMessage<Extract<Event, { type: T }>>) => void,
  ): () => void;
}

/** The same bridge is driven by the helper and fake events. It never sends a capture command. */
export class MeetingNoteSession {
  private offs: (() => void)[] = [];
  private active?: string;
  constructor(
    private readonly events: MeetingEvents,
    private readonly notes: MeetingNotes,
    private readonly now = Date.now,
    private readonly onError: (error: unknown) => void = () =>
      console.error("[meetings] note write failed; pending text retained"),
  ) {}
  attach(): void {
    this.offs.push(
      this.events.on("meeting.started", (event) => {
        this.active = event.session;
        void this.notes
          .start(event.session, event.app ?? "Reunião", new Date(this.now()))
          .catch(this.onError);
      }),
      this.events.on("meeting.segment", (event) => {
        const session = event.session ?? this.active;
        if (session)
          void this.notes.segment(session, event).catch(this.onError);
      }),
      this.events.on("meeting.stopped", (event) => {
        if (this.active === event.session) this.active = undefined;
        void this.notes
          .finish(event.session, new Date(this.now()))
          .catch(this.onError);
      }),
    );
  }
  async detach(): Promise<void> {
    this.offs.splice(0).forEach((off) => off());
    const active = this.active;
    this.active = undefined;
    if (active) await this.notes.finish(active, new Date(this.now()));
    await this.notes.flush();
  }
}
