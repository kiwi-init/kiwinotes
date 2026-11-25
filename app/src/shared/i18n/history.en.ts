// The History catalog in English (T29247, spec #28171): `history.pt.ts` is the source.

import type { Entry } from "./index.ts";
import type { ptHistory } from "./history.pt.ts";

export const enHistory: { readonly [K in keyof typeof ptHistory]: Entry } = {
  "history.title": "History",
  "history.search": "Search dictations",
  "history.loadFailed": "Couldn't open the history",
  "history.retry": "Try again",
  "history.notFound": "Nothing found",
  "history.notFoundHint": "No dictation has “{query}”. Search ignores accents and capitals.",
  "history.empty": "No dictations yet",
  "history.emptyHint": "Hold {key} in any app and speak. Each dictation shows up here, with the clean text and the original.",
  "history.today": "Today",
  "history.yesterday": "Yesterday",
  "history.more": "Show more",
  "history.moreFailed": "Couldn't load. Try again",

  "history.sendToNote": "Send to note…",
  "history.copy": "Copy the text",
  "history.delete": "Delete from history",
  "history.unfinished": "The dictation wasn't finished",
  "history.retrying": "Transcribing…",
  "history.retryAudio": "Transcribe again",
  "history.retryFailed": "Couldn't transcribe. Try again.",
  "history.audioUntil": "Audio kept on this Mac until {date}.",
  "history.audioKept": "Audio kept on this Mac.",

  "history.toNote.dialog": "Send to note",
  "history.toNote.search": "Search notes",
  "history.toNote.new": "＋ New note",
  "history.toNote.in": "in {folder}",
  "history.toNote.notesFailed": "Couldn't open the notes",
  "history.toNote.sendFailed": "Couldn't send. Try again",
  "history.sent.already": "Already in “{title}”",
  "history.sent.created": "Became the note “{title}”, in {folder}",
  "history.sent.appended": "Added to the end of “{title}”",
  "history.sent.root": "Notes",
};
