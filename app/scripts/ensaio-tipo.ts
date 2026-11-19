// Ensaio do T21438 (não entra): um erro de tipo de propósito, num tipo comum e num tipo do Electrobun.
import { BrowserWindow } from "electrobun/bun";

export const n: number = "texto";
export const w = new BrowserWindow({ titulo: "exemplo" });
