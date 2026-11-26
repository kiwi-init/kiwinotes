// The English catalog (spec #28171): the same keys as `pt.ts`, written by the team (no cloud translation).
// A missing or extra key breaks `tsc`; the i18n test also checks that both ask for the same `{params}`.

import { enCatOverlay } from "./catoverlay.en.ts";
import { enAgent } from "./agent.en.ts";
import { enActivity } from "./activity.en.ts";
import { enCommon } from "./common.en.ts";
import { enDiagnostics } from "./diagnostics.en.ts";
import { enHistory } from "./history.en.ts";
import { enHub } from "./hub.en.ts";
import { enEditor } from "./editor.en.ts";
import type { Catalog, Entry } from "./index.ts";
import { enMeetingsSettings } from "./meetings-settings.en.ts";
import { enMeetings } from "./meetings.en.ts";
import { enNotes } from "./notes.en.ts";
import type { PT_PARTS } from "./pt.ts";
import { enSettings } from "./settings.en.ts";
import { enViewers } from "./viewers.en.ts";

const enBase: { readonly [K in keyof typeof PT_PARTS.base]: Entry } = {
  "language.pt": "Português",
  "language.en": "English",

  "settings.window.title": "Settings",
  "settings.topics.aria": "Settings topics",
  "settings.back": "‹ Back",
  "settings.tab.general": "General",
  "settings.tab.shortcuts": "Shortcuts",
  "settings.tab.transcription": "Transcription",
  "settings.tab.dictionary": "Dictionary",
  "settings.tab.snippets": "Snippets",
  "settings.tab.folder": "Folder and options",
  "settings.tab.sidebar": "Sidebar",
  "settings.tab.recording": "Recording",
  "settings.tab.yours": "Your meetings",
  "settings.tabs.aria": "Topic tabs",
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
  "settings.language.hint": "Automatic follows the macOS language. Dictation, Kiwi's voice and the agent's replies don't change here.",
  "settings.language.auto": "Automatic",
  "settings.language.autoNow": "From macOS, now in {language}.",

  // The app menu, the tray and the dictation status (T28192).
  "menu.quit": "Quit Kiwi Notes",
  "menu.edit": "Edit",
  "menu.window": "Window",
  "tray.open": "Open Kiwi Notes",
  "tray.allowAccess": "Allow access… ({permission})",
  "tray.notes": "Notes…",
  "tray.notesFolder": "Open notes folder…",
  "tray.dictation": "Dictation…",
  "tray.settings": "Settings…",
  "tray.about": "About Kiwi Notes…",
  "tray.updating": "Updating…",
  "tray.updateRestart": "Update and restart",
  "tray.updateRestartVersion": "Update and restart (v{version})",
  "status.failed": "Dictation has a problem",
  "status.starting": "Starting…",
  "status.hotkeyOff": "Shortcut off: needs {permission}",
  "status.aPermission": "a permission",
  "status.modelLoading": "Preparing the voice model…",
  "status.modelUnavailable": "Voice model unavailable",
  "status.vocabularyLoading": "Ready to dictate · downloading the vocabulary…",
  "status.noPriority": "Ready to dictate · shortcuts without priority: needs {permission}",
  "status.ready": "Ready to dictate",
  "status.helperOff": "Helper off",

  // The macOS permissions, by the name System Settings uses.
  "permission.systemAudio": "System Audio",
  "permission.microphone": "Microphone",
  "permission.accessibility": "Accessibility",
  "permission.inputMonitoring": "Input Monitoring",

  // The link dialog and the agent's notification.
  "dialog.link.title": "Open the link?",
  "dialog.link.message": "Open this link in the browser?",
  "dialog.link.open": "Open",
  "dialog.link.cancel": "Cancel",
  "notice.agent.title": "The agent is waiting for your answer",
  "notice.agent.bodyNote": "A question in {note}. Click to answer.",
  "notice.agent.bodyRequest": "A question about your request. Click to answer.",

  // The dictation pill: one line of 38 characters (`OverlayModel.maxMessageLength`).
  "pill.notPasted.noFocus": "No focused field: text is on clipboard",
  "pill.notPasted.noTextField": "Not a text field: text is on clipboard",
  "pill.notPasted.noAccessibility": "Needs Accessibility: text on clipboard",
  "pill.nothingToPaste": "No dictation to paste yet",
  "pill.secureInput": "The text is also on the clipboard",
  "pill.micLost": "Mic dropped: transcribed up to here",
  "pill.micFellBack": "Chosen mic missing: used {mic}",
  "pill.mic.builtin": "the Mac's",
  "pill.mic.default": "the default",
  "pill.micLostEmpty": "No audio from the microphone",
  "pill.noteCreated": "Now a note: {title}",
  "pill.noteFailed": "Couldn't create the note: text is in History",
  "pill.pasteFailed": "Couldn't paste the text",
  "pill.modelUnavailable": "The voice model isn't ready",
  "pill.sttFailed": "Couldn't transcribe",
  "update.swapFailed": "Version {version} was downloaded, but the app couldn't be replaced. Try again; if it keeps failing, install from the release .dmg.",
  "update.offline": "No internet: couldn't reach GitHub.",
  "update.serverDown": "The update server didn't answer. Try again later.",
  "update.checkFailed": "Couldn't check right now. Try again later.",
  "update.downloadFailed": "Downloading {version} failed. Try again.",
  "update.refused": "Version {version} was refused: the signature doesn't match.",
  "update.off.agents": "agent test mode",
  "update.off.dev": "development build",
  "update.off.channel": "build outside the release channels",
  "update.off.noUrl": "local build, without the update address",
  "update.off.badUrl": "this build's update address isn't valid",
  "system.micUsage": "Kiwi Notes uses the microphone when you dictate or ask it to record a meeting, and transcribes everything on your Mac.",
  "system.audioCaptureUsage": "Kiwi Notes captures meeting audio only when you ask. Transcription happens on your Mac and the audio is deleted once it's transcribed.",
};

/** The same parts as `PT_PARTS`. */
export const EN_PARTS = {
  base: enBase,
  common: enCommon,
  notes: enNotes,
  editor: enEditor,
  viewers: enViewers,
  settings: enSettings,
  meetingsSettings: enMeetingsSettings,
  catOverlay: enCatOverlay,
  agent: enAgent,
  meetings: enMeetings,
  history: enHistory,
  hub: enHub,
  activity: enActivity,
  diagnostics: enDiagnostics,
} as const;

export const en: Catalog = {
  ...enBase,
  ...enCommon,
  ...enNotes,
  ...enSettings,
  ...enMeetingsSettings,
  ...enCatOverlay,
  ...enAgent,
  ...enMeetings,
  ...enHistory,
  ...enHub,
  ...enActivity,
  // O editor das Notas (T29842): `editor.en.ts`.
  ...enEditor,
  // Os visualizadores das Notas (T29245): `viewers.en.ts`.
  ...enViewers,
  // O arquivo do Salvar diagnóstico (T30631): `diagnostics.en.ts`.
  ...enDiagnostics,
};
