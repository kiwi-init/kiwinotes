// Portado de OpenWhispr/src/helpers/toneAppCategories.js @ 315ee2d (MIT, docs/licenses/OpenWhispr-MIT.txt).
// Mudanças: só o caminho do navegador (o app fora dele já tem tom pelo bundle id, em tone.ts); o navegador vem pelo
// bundle id do macOS, e não pelo nome; as categorias viram os tons do Kiwi (e-mail é formal; trabalho e pessoal,
// casual).

import type { Tone } from "./types.ts";

/**
 * Os navegadores do Mac, pelo bundle id. O helper lê o título da janela e o host só deles (BrowserSite.swift tem a
 * mesma lista, e o teste confere que as duas batem).
 */
export const BROWSER_BUNDLE_IDS: readonly string[] = [
  "com.apple.Safari",
  "com.apple.SafariTechnologyPreview",
  "com.google.Chrome",
  "com.google.Chrome.beta",
  "com.google.Chrome.canary",
  "org.chromium.Chromium",
  "org.mozilla.firefox",
  "org.mozilla.firefoxdeveloperedition",
  "com.microsoft.edgemac",
  "company.thebrowser.Browser",
  "company.thebrowser.dia",
  "com.brave.Browser",
  "com.operasoftware.Opera",
  "com.vivaldi.Vivaldi",
  "app.zen-browser.zen",
  "com.kagi.kagimacOS",
  "ai.perplexity.comet",
  "org.mozilla.librewolf",
];

type Category = "email" | "work" | "personal";

const CATEGORIES: readonly Category[] = ["email", "work", "personal"];

const TONE: Record<Category, Tone> = { email: "formal", work: "casual", personal: "casual" };

const SITE_HOSTS: Record<Category, readonly string[]> = {
  personal: [
    "whatsapp.com",
    "telegram.org",
    "instagram.com",
    "messenger.com",
    "facebook.com",
    "x.com",
    "twitter.com",
    "discord.com",
    "messages.google.com",
    "snapchat.com",
  ],
  work: ["slack.com", "teams.microsoft.com", "teams.live.com", "teams.cloud.microsoft", "chat.google.com", "linkedin.com", "zoom.us"],
  email: [
    "mail.google.com",
    "outlook.live.com",
    "outlook.office.com",
    "outlook.office365.com",
    "outlook.cloud.microsoft",
    "mail.yahoo.com",
    "mail.proton.me",
    "app.fastmail.com",
    "mail.superhuman.com",
    "app.hey.com",
    "mail.zoho.com",
    "mail.aol.com",
    "app.tuta.com",
  ],
};

const SITE_TITLES: Record<Category, readonly string[]> = {
  personal: [
    "whatsapp",
    "whatsapp business",
    "telegram",
    "telegram web",
    "instagram",
    "messenger",
    "facebook",
    "x",
    "discord",
    "google messages",
    "messages for web",
  ],
  work: ["slack", "microsoft teams", "google chat", "linkedin", "zoom"],
  email: ["gmail", "outlook", "yahoo mail", "proton mail", "fastmail", "superhuman", "hey", "zoho mail", "icloud mail"],
};

const BROWSER_TITLE_NAME =
  /^(?:google chrome|chromium|microsoft edge|mozilla firefox|firefox|librewolf|zen browser|brave|opera|vivaldi|safari|arc|dia|orion|comet)(?: private browsing| \(.*\))?$/;
const TITLE_SEPARATOR = /\s[-–—|·•/]\s/;
const ZERO_WIDTH = /[​-‍﻿]/g;

function withoutBrowserName(segments: string[]): string[] {
  const last = segments.length - 1;
  if (BROWSER_TITLE_NAME.test(segments[last] ?? "")) return segments.slice(0, last);
  if (last > 0 && BROWSER_TITLE_NAME.test(segments[last - 1] ?? "")) return segments.slice(0, last - 1);
  return segments;
}

function byHost(urlHost: string): Category | undefined {
  const host = urlHost.toLowerCase().replace(/^www\./, "");
  return CATEGORIES.find((c) => SITE_HOSTS[c].some((site) => host === site || host.endsWith(`.${site}`)));
}

/** O host traz a marca do site como rótulo: "icloud mail" em www.icloud.com. */
function hostCarries(urlHost: string, siteName: string): boolean {
  return urlHost.toLowerCase().split(/[.-]/).includes(siteName.split(" ")[0] ?? "");
}

/** O nome do site é o último pedaço do título (o Edge pode pôr o perfil depois). Pedaço inteiro, não substring. */
function byTitle(windowTitle: string, accepts: (siteName: string) => boolean): Category | undefined {
  const title = windowTitle.toLowerCase().replace(ZERO_WIDTH, "");
  const candidates = withoutBrowserName(title.split(TITLE_SEPARATOR).map((s) => s.trim()))
    .slice(title.endsWith("microsoft edge") ? -2 : -1)
    .map((s) => s.replace(/^\(\d+\+?\)\s*/, "").replace(/\sand \d+ more (?:pages?|tabs?)$/, "").trim());
  return CATEGORIES.find((c) => candidates.some((s) => SITE_TITLES[c].includes(s) && accepts(s)));
}

export interface SiteContext {
  bundleId?: string;
  title?: string;
  urlHost?: string;
}

/** O tom pelo site aberto no navegador, ou `undefined` quando não é navegador ou o site não está na lista. */
export function siteTone(app: SiteContext | undefined): Tone | undefined {
  if (!app?.bundleId || !BROWSER_BUNDLE_IDS.includes(app.bundleId)) return undefined;
  const host = app.urlHost?.trim() || undefined;
  const category =
    (host && byHost(host)) ||
    (app.title ? byTitle(app.title, (site) => !host || hostCarries(host, site)) : undefined);
  return category ? TONE[category] : undefined;
}
