# ADR-0046: An update downloads ahead and installs at quit

- **Status:** Accepted (2026-09-21)
- **Date:** 2026-09-21
- **Crates:** none. The backend is `src-tauri/src/updater.rs`, the frontend `src/modules/updater`
- **Related:** [ADR-0039](0039-windows-ships-the-nsis-installer-alone.md), whose `/UPDATE` flag
  the quit install passes too. [ADR-0022](0022-one-self-raising-dialog-holds-the-screen-at-a-time.md)
  queues the dialog a check raises.

## Context and problem statement

The app checked for an update once, three seconds after launch. A release lands every day or two,
and an app that starts with Windows into the tray runs for days, so most of those installs never
heard about a release until they restarted. A tray-only install never saw the title bar cell at all.

The download began on the press and ran while the dialog held the screen, 19 MB of it. An install
the reader never pressed for waited for the next launch to be offered again.

The webview drove the updater plugin, so the downloaded installer lived in a webview resource the
backend could not reach. The plugin's install passes `/R` in every silent mode, which relaunches the
app once the installer finishes.

## Decision

**The backend owns the update.** `check_update`, `download_update`, `install_update` and
`discard_update` hold the plugin's `Update` and the verified installer in `UpdaterState`. The
webview schedules the checks and draws the dialog, and no longer calls the plugin.

**A running app checks again.** Every four hours, and when the window comes back into view after a
check older than an hour. A recheck that finds the release already on offer raises nothing.

**A release downloads as soon as a check finds it,** unless the reader skipped it. The dialog's
press is then a restart, and skipping a downloaded release drops the installer.

**The ahead download is a setting,** `autoDownloadUpdates`, on by default. With it off a check still
finds the release and raises the dialog, the press downloads and installs, and quitting installs
nothing. Turning it off drops an installer already downloaded.

**A downloaded installer runs when the reader quits,** from the tray's Quit or by closing the window.
The backend writes it to the temp directory and starts it with `/P /UPDATE` and without `/R`, so the
installer shows its progress window, keeps the reader's shortcuts, and leaves the app closed. A
Windows shutdown sends no close, so no install starts mid-shutdown.

**The tray names the release on offer,** as an entry leading its menu that opens the dialog.

**The install waits while League is up.** The install stops the patcher, which is harmless between
games and pulls the mods out of a live one, so the press is disabled while a session reports the
game running.

**The pinned manifest carries stable releases only.** A pre-release still publishes its own
`latest.json`, and the workflow copies only a stable one to the `updater` release.

## Consequences

- The `updater:*` permissions and `@tauri-apps/plugin-updater` left the frontend.
- "Start in tray unless update available" reveals the window for an update the launch check found,
  never for one a recheck found hours later.
- Only Windows runs the installer by hand. Elsewhere the plugin replaces the app in place at quit,
  which relaunches nothing.
