# ADR-0080: The manager filters its browser arguments and closes a debuggable webview

- **Status:** Proposed (2026-11-05)
- **Date:** 2026-11-05
- **Crates:** `ltk-manager`, in `webview_args`, `shell_relaunch` and `setup`
- **Related:** `src-tauri/src/shell_relaunch.rs`, which restarts a manager that another process
  started. [ltk-manager#923](https://github.com/LeagueToolkit/ltk-manager/issues/923), where a
  third-party app asks to drive the patcher. [ltk-manager#1040](https://github.com/LeagueToolkit/ltk-manager/pull/1040),
  which implements this decision.

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

WebView2 passes the text of the variable and of the policy to the browser process unparsed, and
Chromium reads its command line through `CommandLineToArgvW`. That function removes quotes, so
`--remote"-debugging-port"=9222` is the same switch.

Other overrides replace what the browser process is. The `WEBVIEW2_BROWSER_EXECUTABLE_FOLDER`
variable and the `BrowserExecutableFolder` registry policy point WebView2 at another runtime
folder, whose browser can serve the protocol with no switch on its command line.

A user can also set the variable for a reason of their own, such as `--disable-gpu`, and a
developer of another WebView2 app can leave `--remote-debugging-port` set for the whole account.

## Decision

**The manager reads the variable itself, before any thread runs, and removes it.** `main` calls
`webview_args::take_inherited` first. The switches in `DEBUG_SWITCHES`, which name the DevTools
Protocol, code loaded into the page and traffic interception, are dropped. Every other switch is
kept, and `setup` passes it to WebView2 after the configured arguments, through the API. The
`LTF_CDP_PORT` variable, which a launcher reads back and WebView2 ignores, is removed too.

**A switch is matched as `CommandLineToArgvW` returns it.** `webview_args::arguments` splits a
line by that function's rules for quotes and backslashes. The name of a switch is compared
after the split, and a kept switch is passed on as the variable spelled it.

**The other WebView2 variables are removed.** `OVERRIDE_VARS` lists the variables that replace
the runtime folder, the release channel or the user data folder, and the two that attach a
script debugger. `take_inherited` removes them and the log names the ones that were set.

**A dropped switch or a launcher port restarts the manager under explorer, once.** The copy
runs with explorer's environment. A copy, which `--shell-relaunched` marks, never restarts,
whatever its environment: a variable set for the account reaches explorer too, and the manager
would otherwise restart forever.

**The main window is created in `setup`, not by Tauri.** Its `tauri.conf.json` entry sets
`create` to `false`. `setup` builds it after the `manage` calls, from the same entry, with the
kept switches appended.

**The browser process's command line decides.** Once the controller exists,
`verify_browser_process` reads `BrowserProcessId` and the command line of that process. A switch
in `DEBUG_SWITCHES` closes the manager with an error box that names the switch. This covers the
registry and a library that put the variable back, since neither the manager's filtering nor its
environment decides what the browser process was started with.

**A `BrowserExecutableFolder` policy closes the manager.** The same check reads the policy
under HKLM and HKCU for the process's Application User Model ID, its executable name and `*`.
A value closes the manager with an error box that names the registry key.

### Considered options

1. **Filter the variable, restart once, check the browser process.** Chosen.
2. **Remove the variable and restart whenever it was set.** It drops a user's
   `--disable-gpu`, and it restarts forever when the variable is set for the account, since the
   copy inherits it from explorer and the `--shell-relaunched` guard was bypassed to defeat the
   launcher passing that argument.
3. **Pass the arguments through the API only.** WebView2 appends the variable and the registry
   to the API's arguments, so this changes nothing.
4. **Build without the `devtools` feature.** It closes F12 and the context menu, which help a
   user report a frontend bug, and it does not touch the remote debugging port, which is a
   browser switch, not a Tauri feature.
5. **Keep only the switches on an allowlist.** The list does not need a new entry when
   Chromium adds a switch. It drops every user switch that the list omits, and the user gets
   no notice of that.

## Consequences

**A debugging launcher gets a manager without a port, or no manager.** Through the environment,
the restarted copy runs without the switch. Through a library or the registry, the manager
closes before the page is shown. The check does not stop a library that patches the check.
That needs a signed, verified host, as the patcher has.

**The page is not a trust boundary.** DevTools stay available (option 4), so a script entered
there wraps `invoke` without a port. A command does not rely on the page for a restriction:
`start_patcher` takes no hook flags from the page.

**A runtime in a user-writable folder is not verified.** A per-user WebView2 Runtime install
is in `%LOCALAPPDATA%`. The manager does not check the files of the runtime it loads.

**A user's own browser switches are kept.** Only the switches in `DEBUG_SWITCHES` are
dropped, and the log names what was kept and dropped, without the values.

**The check reads process memory of a child.** `NtQueryInformationProcess` with
`ProcessCommandLineInformation` on the browser process, with the limited query right. It runs
once per start, on the webview's thread.

**`create: false` moves the window after the `manage` calls.** The page can no longer invoke a
command before its state is managed, which was a race before.
