import type { Tone } from "./types.ts";

const CASUAL = new Set([
  "com.tinyspeck.slackmacgap",
  "com.microsoft.teams2",
  "com.microsoft.teams",
  "net.whatsapp.WhatsApp",
  "com.apple.MobileSMS",
  "ru.keepcoder.Telegram",
  "org.telegram.desktop",
  "com.hnc.Discord",
]);

const FORMAL = new Set([
  "com.apple.mail",
  "com.microsoft.Outlook",
  "com.readdle.smartemail-Mac",
  "com.microsoft.Word",
  "com.apple.iWork.Pages",
]);

const LITERAL = new Set([
  "com.apple.Terminal",
  "com.googlecode.iterm2",
  "dev.warp.Warp-Stable",
  "com.mitchellh.ghostty",
  "net.kovidgoyal.kitty",
  "com.github.wez.wezterm",
  "io.alacritty",
  "com.microsoft.VSCode",
  "com.microsoft.VSCodeInsiders",
  "com.todesktop.230313mzl4w4u92", // Cursor
  "com.exafunction.windsurf",
  "dev.zed.Zed",
  "com.sublimetext.4",
  "com.apple.dt.Xcode",
]);

/** O tom do texto pelo app em foco. JetBrains entra pelo prefixo (IntelliJ, PyCharm, GoLand…). */
export function toneFor(bundleId: string | undefined): Tone {
  if (!bundleId) return "default";
  if (LITERAL.has(bundleId) || bundleId.startsWith("com.jetbrains.")) return "literal";
  if (CASUAL.has(bundleId)) return "casual";
  if (FORMAL.has(bundleId)) return "formal";
  return "default";
}
