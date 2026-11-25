// The common texts in English (spec #28171): the same keys as `common.pt.ts`.

import type { Entry } from "./index.ts";
import type { ptCommon } from "./common.pt.ts";

export const enCommon: { readonly [K in keyof typeof ptCommon]: Entry } = {
  "common.notes": { one: "{n} note", other: "{n} notes" },
  "common.saveFailed": "Couldn't save. Try again.",
  "common.cancel": "Cancel",
  "common.remove": "Remove",
  "common.retry": "Try again",
  "common.loadingModel": "Loading the model…",
  "common.ok": "OK",
  "common.undo": "Undo",
  "common.close": "Close",
  "common.see": "View",
  "common.keep": "Keep",
  "common.discard": "Discard",
  "common.continue": "Continue",
  "common.skip": "Skip",
};
