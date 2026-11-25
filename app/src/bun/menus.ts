// O menu do app e o da bandeja (T28192), na língua do app. Funções puras, para o `bun test`: o index.ts as aplica e
// refaz os dois quando a língua muda.

import type { ApplicationMenu, Tray } from "electrobun/bun";

import { type Locale, translate } from "../shared/i18n/index.ts";
import { permissionName } from "./permissions.ts";
import type { SessionStatus } from "./session.ts";
import { statusLabel } from "./session-status.ts";

// Só os tipos: o teste não carrega a engine.
type AppMenuItems = Parameters<typeof ApplicationMenu.setApplicationMenu>[0];
type TrayMenuItems = Parameters<Tray["setMenu"]>[0];

/**
 * Com o Dock, o app tem menu de app: ⌘Q sai pelo mesmo caminho do "Sair" da barra, ⌘W fecha o hub, e a edição
 * (⌘C, ⌘V, ⌘Z…) segue funcionando nas notas. Os itens com `role` o macOS escreve na língua dele.
 */
export function appMenu(locale: Locale): AppMenuItems {
  const t = translate.bind(null, locale);
  return [
    {
      label: "Kiwi Notes", // i18n-ok: o nome do app
      submenu: [
        { role: "hide" },
        { role: "hideOthers" },
        { role: "showAll" },
        { type: "separator" },
        { label: t("menu.quit"), action: "quit", accelerator: "q" },
      ],
    },
    {
      label: t("menu.edit"),
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "pasteAndMatchStyle" },
        { role: "selectAll" },
      ],
    },
    { label: t("menu.window"), submenu: [{ role: "minimize" }, { role: "zoom" }, { role: "close" }, { type: "separator" }, { role: "bringAllToFront" }] },
  ];
}

export interface TrayUpdate {
  /** O rótulo do `updateMenuLabel`, ou null sem atualização. */
  label: string | null;
  ready: boolean;
}

/** O menu da barra: o status do ditado, a permissão que falta, as seções do hub, a atualização e o Sair. */
export function trayMenu(s: SessionStatus, update: TrayUpdate, locale: Locale): TrayMenuItems {
  const t = translate.bind(null, locale);
  return [
    { type: "normal", label: t("tray.open"), action: "hub" },
    { type: "divider" },
    { type: "normal", label: statusLabel(s, locale), action: "status", enabled: false },
    // Enquanto faltar alguma permissão: pede a próxima (o diálogo do macOS, ou os Ajustes no lugar certo).
    ...(s.connected && s.missing.length
      ? [{ type: "normal" as const, label: t("tray.allowAccess", { permission: permissionName(s.missing[0]!, locale) }), action: "permissions" }]
      : []),
    { type: "divider" },
    // As janelas soltas de antes viraram seções do hub (#2100).
    { type: "normal", label: t("tray.notes"), action: "notes" },
    { type: "normal", label: t("tray.notesFolder"), action: "notes-folder" },
    { type: "normal", label: t("tray.dictation"), action: "dictation" },
    { type: "normal", label: t("tray.settings"), action: "settings" },
    { type: "normal", label: t("tray.about"), action: "about" },
    { type: "divider" },
    ...(update.label ? [{ type: "normal" as const, label: update.label, action: "update", enabled: update.ready }] : []),
    { type: "normal", label: t("menu.quit"), action: "quit" },
  ];
}
