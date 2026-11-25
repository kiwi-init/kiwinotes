// As Reuniões em inglês (T29247, spec #28171): uma linha da lista, o card ao vivo e os textos que saem de funções (o
// dia, a hora, a duração, quem participou). O português continua o padrão, igual ao que a tela já mostrava.

import { afterEach, describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { durationLabel, type MeetingNote, participantsLabel } from "../../src/shared/meetings.ts";
import { setAppLocale, withStrong } from "../src/i18n.ts";
import { clock, dayLabel, LiveCard, MeetingRow } from "./Meetings.tsx";

const english = () => setAppLocale({ setting: "en", locale: "en", system: "en" });
afterEach(() => setAppLocale({ setting: "auto", locale: "pt", system: "pt" }));

const meeting: MeetingNote = {
  path: "Reuniões/Plano do jardim.md",
  title: "Plano do jardim",
  date: "2026-11-06",
  start: "2026-11-06T14:05:00",
  end: "2026-11-06T15:10:00",
  duration: 3900,
  app: "Zoom",
  participants: ["Ana", "Bruno", "Carla", "Davi"],
  live: false,
  mtime: "2026-11-06T15:10:00.000Z",
};
const row = (m: MeetingNote) =>
  renderToStaticMarkup(<MeetingRow meeting={m} renaming={false} onOpen={() => {}} onRename={() => {}} onRenamed={() => {}} onCancelRename={() => {}} onDelete={() => {}} />);

describe("as Reuniões em inglês", () => {
  test("uma linha: hora, duração, quem participou e os botões", () => {
    const pt = row(meeting);
    for (const text of ["14:05", "1 h 05", "Ana, Bruno e mais 2", 'aria-label="Apagar Plano do jardim"']) expect(pt).toContain(text);
    english();
    const en = row(meeting);
    for (const text of ["2:05 PM", "1 h 05 min", "Ana, Bruno and 2 more", 'aria-label="Open Plano do jardim in Notes"', 'aria-label="Rename Plano do jardim"', 'aria-label="Delete Plano do jardim"'])
      expect(en).toContain(text);
    for (const text of ["Abrir", "Apagar", "e mais"]) expect(en).not.toContain(text);
    expect(row({ ...meeting, end: null, duration: 0 })).toContain("interrupted");
    expect(row({ ...meeting, live: true })).toContain("recording");
  });

  test("o card ao vivo: título, mic pausado, aviso e botões", () => {
    english();
    const html = renderToStaticMarkup(
      <LiveCard live={{ recording: true, session: "s1", app: "Teams", since: new Date().toISOString(), minePaused: true, warning: "note_recreated" }} />,
    );
    for (const text of ['aria-label="Recording now"', "Recording · Teams", "your mic is paused", "Turn my mic back on", "Stop", "in Reuniões."]) expect(html).toContain(text);
    for (const text of ["Gravando", "Parar", "Voltar meu mic"]) expect(html).not.toContain(text);
  });

  test("os textos montados por função seguem a língua, e o português continua o padrão", () => {
    const now = new Date("2026-11-07T10:00:00");
    expect(dayLabel("2026-11-07", now)).toBe("Hoje");
    expect(dayLabel("2026-11-06", now, "en")).toBe("Yesterday");
    expect(dayLabel("2026-11-05", now, "en")).toBe("Thursday, November 5");
    expect(dayLabel("2026-11-05", now)).toBe("quinta-feira, 5 de novembro");
    expect(clock("2026-11-06T09:05:00")).toBe("09:05");
    expect(clock("2026-11-06T09:05:00", "en")).toBe("9:05 AM");
    expect(durationLabel(20, "en")).toBe("under 1 min");
    expect(durationLabel(38 * 60, "en")).toBe("38 min");
    expect(durationLabel(20)).toBe("menos de 1 min");
    expect(participantsLabel(["Ana", "Bruno", "Carla"], "en")).toBe("Ana, Bruno and Carla");
    expect(participantsLabel(["Ana", "Bruno", "Carla"])).toBe("Ana, Bruno e Carla");
  });

  test("o negrito no meio da frase fica no lugar certo nas duas línguas", () => {
    const html = renderToStaticMarkup(<p>{withStrong((k) => `Hold ${k} and speak.`, "Fn")}</p>);
    expect(html).toBe("<p>Hold <strong>Fn</strong> and speak.</p>");
  });
});
