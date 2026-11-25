// The English catalog (spec #28171): the same keys as `pt.ts`, written by the team (no cloud translation).
// A missing or extra key breaks `tsc`; the i18n test also checks that both ask for the same `{params}`.

import type { Catalog } from "./index.ts";

export const en: Catalog = {
  "language.pt": "Português",
  "language.en": "English",

  "common.notes": { one: "{n} note", other: "{n} notes" },
  "common.saveFailed": "Couldn't save. Try again.",

  "settings.window.title": "Settings",
  "settings.topics.aria": "Settings topics",
  "settings.back": "‹ Back",
  "settings.topic.general": "General",
  "settings.topic.appearance": "Appearance",
  "settings.topic.dictation": "Dictation",
  "settings.topic.notes": "Notes",
  "settings.topic.meetings": "Meetings",
  "settings.topic.agent": "Agent",
  "settings.topic.activity": "Agent activity",
  "settings.topic.privacy": "Privacy",
  "settings.topic.about": "About",

  "settings.language.section": "Language",
  "settings.language.label": "App language",
  "settings.language.hint": "Automatic follows the macOS language. Dictation, the cat's voice and the agent's replies don't change here.",
  "settings.language.auto": "Automatic",
  "settings.language.autoNow": "From macOS, now in {language}.",
  "settings.language.autoPending": "For now, Automatic stays in Portuguese: the rest of the app is still being translated.",
};
