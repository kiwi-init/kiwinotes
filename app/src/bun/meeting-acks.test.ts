// R3 (T4943): o áudio só sai do helper depois do texto salvo; o sistema, só no fim (opção B, #5131).
import { expect, test } from "bun:test";

import { type MeetingAck, MeetingAcks } from "./meeting-acks.ts";

const S = "7D1C2C3E-0000-4000-8000-000000000001";
const seg = (channel: "mine" | "system", i: number, start: number, end: number) => ({
  session: S, channel, id: `${channel}-${i}`, start, end, startFrame: start * 16_000, endFrame: end * 16_000, final: true, text: "algo", speaker: "x",
});

function rig() {
  const sent: MeetingAck[] = [];
  return { sent, acks: new MeetingAcks((a) => sent.push(a)) };
}

test("você: a marca anda até o settled, mas nunca passa um final ainda não salvo", () => {
  const { sent, acks } = rig();
  acks.segment(seg("mine", 0, 2, 4));
  acks.settled(S, "mine", 10 * 16_000);
  expect(sent).toEqual([{ type: "meeting.ack", session: S, channel: "mine", finalThroughFrame: 32_000 }]);
  acks.committed(S, [seg("mine", 0, 2, 4)]);
  expect(sent.at(-1)).toEqual({ type: "meeting.ack", session: S, channel: "mine", finalThroughFrame: 160_000 });
  acks.settled(S, "mine", 10 * 16_000);
  expect(sent.length).toBe(2);
});

test("sistema: nada no meio da reunião; no fim, depois do relabel gravado, um ack com contexto 0", () => {
  const { sent, acks } = rig();
  acks.segment(seg("system", 0, 1, 3));
  acks.settled(S, "system", 60 * 16_000);
  acks.committed(S, [seg("system", 0, 1, 3)]);
  expect(sent).toEqual([]);
  acks.relabelStarted(S);
  acks.drained(S, "system", 90 * 16_000);
  expect(sent).toEqual([]); // the VBx correction isn't on disk yet
  acks.relabelDone(S);
  expect(sent).toEqual([{ type: "meeting.ack", session: S, channel: "system", finalThroughFrame: 1_440_000, contextFrames: 0 }]);
  acks.drained(S, "system", 90 * 16_000);
  acks.committed(S, []);
  expect(sent.length).toBe(1);
});

test("o fim só apaga com todos os finais salvos (um final tardio, depois do stop)", () => {
  const { sent, acks } = rig();
  acks.segment(seg("mine", 3, 40, 42));
  acks.drained(S, "mine", 50 * 16_000);
  expect(sent).toEqual([]);
  acks.committed(S, [seg("mine", 3, 40, 42)]);
  expect(sent).toEqual([{ type: "meeting.ack", session: S, channel: "mine", finalThroughFrame: 800_000, contextFrames: 0 }]);
});

test("provisórios, finais sem texto e sem sessão não seguram a marca", () => {
  const { sent, acks } = rig();
  acks.segment({ ...seg("mine", 0, 1, 2), final: false });
  acks.segment({ ...seg("mine", 0, 1, 2), text: "  " });
  acks.segment({ ...seg("mine", 0, 1, 2), session: undefined });
  acks.settled(S, "mine", 5 * 16_000);
  expect(sent).toEqual([{ type: "meeting.ack", session: S, channel: "mine", finalThroughFrame: 80_000 }]);
});
