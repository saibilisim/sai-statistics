// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * e2e-userdata.cjs — where Electron keeps userData for the built app, per OS.
 *
 * Scripts that seed settings.json / ai-session.bin before launching the
 * app need this path. Four of them had the Linux convention hardcoded
 * (~/.config/Electron), so on Windows they wrote to a directory the app never
 * reads: the app then started with defaults, ai.provider stayed 'off', the
 * chat input stayed disabled, and e2e-ai-chat failed with the deeply unhelpful
 * "element is not enabled". One shared helper instead of four copies.
 *
 * The unpackaged app runs under the name "Electron" (probed), hence the fixed
 * leaf. A packaged build would use productName instead.
 */
const os = require('os')
const path = require('path')

function electronUserDataDir(appName = 'Electron') {
  const base =
    process.platform === 'win32'
      ? (process.env.APPDATA ?? path.join(os.homedir(), 'AppData', 'Roaming'))
      : process.platform === 'darwin'
        ? path.join(os.homedir(), 'Library', 'Application Support')
        : (process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), '.config'))
  return path.join(base, appName)
}

module.exports = { electronUserDataDir }
