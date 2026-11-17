import { describe, expect, test } from "bun:test";
import { ENTRY_MS, EXIT_MS, exitStyle, HIDDEN_STYLE, shownStyle } from "./transition";

describe("a materialização da névoa (spec #14813)", () => {
  test("entra em 420 ms e sai em 280 ms", () => {
    expect(ENTRY_MS).toBe(420);
    expect(EXIT_MS).toBe(280);
    expect(shownStyle(false).transition).toBe(
      "transform 420ms cubic-bezier(0.22, 1.33, 0.36, 1), opacity 252ms ease-out, filter 294ms ease-out");
    expect(exitStyle(false).transition).toBe(
      "transform 280ms cubic-bezier(0.4, 0, 0.7, 0.25), opacity 230ms ease-in, filter 280ms ease-in");
  });
  test("parte da névoa e volta a ela", () => {
    expect(HIDDEN_STYLE).toMatchObject({ opacity: "0", filter: "blur(10px)", transition: "none" });
    expect(exitStyle(false)).toMatchObject({ opacity: "0", filter: "blur(8px)" });
    expect(shownStyle(false)).toMatchObject({ opacity: "1", filter: "blur(0px)" });
  });
  test("com reduzir movimento, sem passagem", () => {
    expect(shownStyle(true).transition).toBe("none");
    expect(exitStyle(true).transition).toBe("none");
  });
});
