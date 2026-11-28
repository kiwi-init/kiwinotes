// T33888 (#33885): os horários de "hoje" dos roteiros caem hoje, em ordem, com o relógio em qualquer hora do dia.
import { expect, test } from "bun:test";
import { minutesAgoToday, startOfDay, waitForSameDay } from "./day-clock.ts";

const at = (h: number, m: number, s = 0) => new Date(2026, 11, 7, h, m, s);
const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();

test("às 00:00, 00:01, 00:20, 12:00 e 23:59, os de hoje caem entre a meia-noite e agora, em ordem", () => {
  for (const now of [at(0, 0), at(0, 1), at(0, 20), at(12, 0), at(23, 59)]) {
    const [a, b] = [minutesAgoToday(now, 30), minutesAgoToday(now, 5)];
    for (const t of [a, b]) {
      expect(sameDay(t, now)).toBe(true);
      expect(t.getTime()).toBeGreaterThanOrEqual(startOfDay(now).getTime());
      expect(t.getTime()).toBeLessThanOrEqual(now.getTime());
    }
    if (now.getTime() > startOfDay(now).getTime()) expect(a.getTime()).toBeLessThan(b.getTime());
  }
});

test("com folga desde a meia-noite, é o 'agora − minutos' de sempre", () => {
  expect(minutesAgoToday(at(12, 0), 30)).toEqual(at(11, 30));
  expect(minutesAgoToday(at(1, 0), 5)).toEqual(at(0, 55));
});

test("às 23:59 o roteiro espera passar da meia-noite; longe dela, não espera", () => {
  expect(waitForSameDay(at(23, 59))).toBe(61_000);
  expect(waitForSameDay(at(23, 56))).toBe(241_000);
  expect(waitForSameDay(at(23, 54))).toBe(0);
  expect(waitForSameDay(at(0, 1))).toBe(0);
  expect(waitForSameDay(at(12, 0))).toBe(0);
});
