import { EventEmitter } from "node:events";

export interface RealtimeEvent {
  type: "match" | "matches" | "presence" | "invites" | "hello" | "ping";
  matchId?: string;
}

export class RealtimeBus {
  private readonly emitter = new EventEmitter();

  constructor() {
    this.emitter.setMaxListeners(0);
  }

  publish(event: RealtimeEvent) {
    this.emitter.emit("event", event);
  }

  subscribe(listener: (event: RealtimeEvent) => void) {
    this.emitter.on("event", listener);
    return () => { this.emitter.off("event", listener); };
  }
}
