# ADR-0080: The manager filters its browser arguments and closes a debuggable webview

- **Status:** Proposed (2026-11-05)
- **Date:** 2026-11-05
- **Crates:** `ltk-manager`, in `webview_args`, `shell_relaunch` and `setup`
- **Related:** `src-tauri/src/shell_relaunch.rs`, which restarts a manager that another process
  started. [ltk-manager#923](https://github.com/LeagueToolkit/ltk-manager/issues/923), where a
  third-party app asks to drive the patcher. [ltk-manager#1040](https://github.com/LeagueToolkit/ltk-manager/pull/1040),
  the first cut, which this decision supersedes.

## Context and problem statement

WebView2 opens a Chrome DevTools Protocol port when its browser process starts with
`--remote-debugging-port`. A program that holds that port runs script in the manager's page,
and the page cannot tell. One such program wraps `window.__TAURI_INTERNALS__.invoke` and answers
`get_mod_health_verdicts` with `healthy` for every mod, so the frontend shows no `bin/skinhack`
verdict. It then installs and patches through the manager's own commands.

The switch reaches the browser process three ways, and WebView2 appends all of them to the
arguments the manager passes through `additionalBrowserArgs`:

1. the `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS` environment variable of the manager process;
2. the registry policy `Software\Policies\Microsoft\Edge\WebView2\AdditionalBrowserArguments`,
   under HKLM or HKCU, for the manager's executable name or `*`;
3. a library loaded into the manager process, which sets the variable before the webview exists.

The launcher in question uses the first way, passes `--shell-relaunched` so the manager does not
restart under explorer, and seeds `explorer.exe` as the manager's parent. Its library takes the
third way when the first is closed.

A user can also set the variable for a reason of their own, such as `--disable-gpu`, and a
developer of another WebView2 app can leave `--remote-debugging-port` set for the whole account.

## Decision

**The manager reads the variable itself, before any thread runs, and removes it.** `main` calls
`webview_args::take_inherited` first. The switches in `DEBUG_SWITCHES`, which name the DevTools
Protocol, code loaded into the page and traffic interception, are dropped. Every other switch is
kept, and `setup` passes it to WebView2 after the configured arguments, through the API. The
`LTF_CDP_PORT` variable, which a launcher reads back and WebView2 ignores, is removed too.

**A dropped switch or a launcher port restarts the manager under explorer, once.** The copy
runs with explorer's environment. A copy, which `--shell-relaunched` marks, never restarts,
whatever its environment: a variable set for the account reaches explorer too, and the manager
would otherwise restart forever.

**The main window is created in `setup`, not by Tauri.** Its `tauri.conf.json` entry sets
`create` to `false`. `setup` builds it after the `manage` calls, from the same entry, with the
kept switches appended.

**The browser process's command line is the word that counts.** Once the controller exists,
`verify_browser_process` reads `BrowserProcessId` and the command line of that process. A switch
in `DEBUG_SWITCHES` closes the manager with an error box that names the switch. This covers the
registry and a library that put the variable back, since neither the manager's filtering nor its
environment decides what the browser process was started with.

### Considered options

1. **Filter the variable, restart once, check the browser process.** Chosen.
2. **Remove the variable and restart whenever it was set.** The first cut. It drops a user's
   `--disable-gpu`, and it restarts forever when the variable is set for the account, since the
   copy inherits it from explorer and the `--shell-relaunched` guard was bypassed to defeat the
   launcher passing that argument.
3. **Pass the arguments through the API only.** WebView2 appends the variable and the registry
   to the API's arguments, so this changes nothing.
4. **Build without the `devtools` feature.** It closes F12 and the context menu, which help a
   user report a frontend bug, and it does not touch the remote debugging port, which is a
   browser switch, not a Tauri feature.

## Consequences

**A debugging launcher gets a manager without a port, or no manager.** Through the environment,
the restarted copy runs without the switch. Through a library or the registry, the manager
closes before the page is shown. A library that patches the check itself is the next move, and
a signed, verified host is the answer to that, as it is for the patcher.

**A user's own browser switches survive.** Only the sixteen switches in `DEBUG_SWITCHES` are
dropped, and the log names what was kept and dropped.

**The check reads process memory of a child.** `NtQueryInformationProcess` with
`ProcessCommandLineInformation` on the browser process, with the limited query right. It runs
once per start, on the webview's thread.

**`create: false` moves the window after the `manage` calls.** The page can no longer invoke a
command before its state is managed, which was a race before.
