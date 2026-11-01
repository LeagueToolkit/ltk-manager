# Telemetry

Every event the manager sends and every property it carries. This is the reference an
implementer checks a change against, and the source the public privacy page is written from.
A property added without a line here is a defect.

The decision behind it is [ADR-0034](../adr/0034-anonymous-diagnostics-leave-the-machine.md).
The switch a reader holds is the **Privacy** card in [Settings](SETTINGS.md), and what the
project can publish to narrow collection is `config/README.md`.

## What every event carries

The transport adds three things, so no call site can forget them.

| Property                  | What it is                                                    |
| ------------------------- | ------------------------------------------------------------- |
| `distinct_id`             | The day's identity, a hash of a local secret and the UTC date |
| `$process_person_profile` | Always `false`, so the vendor builds no profile behind the id |
| `timestamp`               | When the event was written down, not when it was sent         |

Every string on the way out passes the scrubber, which replaces the running user's profile
directory with `%USERPROFILE%` however the path is spelled.

## `game_session_ended`

One per game session, whatever the outcome. A clean session reports as well as a failing one,
because a verdict rate needs a denominator.

### What the machine is

| Property           | Always | What it is                                           |
| ------------------ | ------ | ---------------------------------------------------- |
| `app_version`      | yes    | The manager's own version                            |
| `arch`             | yes    | The architecture this build runs as                  |
| `os_build`         | no     | The OS as `10.0.26100`, where the platform gives one |
| `locale`           | no     | The game's configured locale                         |
| `manager_elevated` | yes    | Whether the manager process runs elevated            |
| `league_admin`     | yes    | Whether League is set to run as administrator        |

### What the session was

| Property          | Always | What it is                                 |
| ----------------- | ------ | ------------------------------------------ |
| `outcome`         | yes    | `clean` or `verdict`                       |
| `enabled_mods`    | yes    | How many mods were enabled, as a count     |
| `injected`        | yes    | Whether injection happened                 |
| `origin`          | yes    | How the session started                    |
| `launch_kind`     | yes    | What was launched                          |
| `overlay_outcome` | yes    | How building the overlay ended             |
| `duration_bucket` | no     | How long the session ran, as a range       |
| `scan_mode`       | no     | Which archive scan the run used            |
| `game_patch`      | no     | The installed game patch                   |
| `patcher_dll`     | no     | The DLL that ran, as 16 hex of its SHA-256 |

The duration is a range rather than a number of seconds, because the exact second a game ran is
close to a fingerprint across a day and answers no question a range does not.

| Bucket     | Seconds      |
| ---------- | ------------ |
| `under-1m` | 0 to 59      |
| `1-5m`     | 60 to 299    |
| `5-15m`    | 300 to 899   |
| `15-30m`   | 900 to 1799  |
| `30-45m`   | 1800 to 2699 |
| `over-45m` | 2700 and up  |

### What the verdict was

Only on `outcome: verdict`.

| Property         | Always | What it is                                       |
| ---------------- | ------ | ------------------------------------------------ |
| `verdict_kind`   | yes    | Which verdict the classifier reached             |
| `consequence`    | yes    | What the verdict means for the player            |
| `game_phase`     | yes    | How far the game got                             |
| `scan_status`    | yes    | How the archive scan ended                       |
| `incident_token` | yes    | The same token `Report a Bug` puts in its URL    |
| `evidence_codes` | yes    | The codes the evidence carried, as a list of ids |
| `suspect_count`  | yes    | How many mods were named                         |
| `suspects`       | yes    | Each named mod as `{ digest, reason }`           |
| `exit_reason`    | no     | Why the game exited, where the log says          |
| `exit_status`    | no     | The exit code, described rather than raw         |
| `crashed`        | no     | Whether the game crashed, where that is known    |

The token is capped, trimmed to ten codes and four suspects, and omits every path on disk. It is
what makes one session readable in full without asking the reporter for anything, and it is what a
token pasted into a GitHub issue matches.

A suspect's `digest` is a truncated SHA-256: over the mod archive's bytes for a mod in archive
storage, and over the mod's lowercased sorted wad paths for a mod in project storage. No display
name, no project path and no mod id travels. `reason` is the coded reason the mod was named, from
the same vocabulary the app draws in a tooltip.

## `app_error`

A backend error that reached the frontend. A normal event rather than an exception, because most
of them are routine and routing them into error tracking would spend the exception allowance on
conditions the app already handles.

| Property      | Always | What it is                                                |
| ------------- | ------ | --------------------------------------------------------- |
| `app_version` | yes    | The manager's own version                                 |
| `error_code`  | yes    | The code the frontend matches on, such as `IO` or `WAD`   |
| `error_kind`  | no     | The variant under a code that has several, such as `BUSY` |
| `message`     | yes    | What the failure said, scrubbed                           |

## `app_started`

One per launch, once the states are built. It is the denominator for every other event: how many
installs run elevated, and how many have a patcher DLL to run.

| Property           | Always | What it is                                              |
| ------------------ | ------ | ------------------------------------------------------- |
| `app_version`      | yes    | The manager's own version                               |
| `arch`             | yes    | The architecture this build runs as                     |
| `os_build`         | no     | The OS as `10.0.26100`, where the platform gives one    |
| `locale`           | no     | The game's configured locale                            |
| `manager_elevated` | yes    | Whether the manager process runs elevated               |
| `league_admin`     | yes    | Whether League is set to run as administrator           |
| `delivery_channel` | yes    | `stable` or `beta`                                      |
| `patcher_staged`   | yes    | Whether a delivered DLL is staged for the channel       |
| `patcher_version`  | no     | The staged DLL's release name, such as `ltk_patcher-26` |

It also carries every elevation fact of `patcher_refused`.

## `patcher_start_failed`

A patcher start that got no DLL, before any session ran.

| Property      | Always | What it is                                                                   |
| ------------- | ------ | ---------------------------------------------------------------------------- |
| `app_version` | yes    | The manager's own version                                                    |
| `stage`       | yes    | `prepare`                                                                    |
| `reason`      | yes    | The delivery failure's kind, such as `network`, `no-release` or `unattested` |

## `patcher_delivery_sync_failed`

A background sync of the patcher delivery that failed. One reason per channel reports once an
hour.

| Property           | Always | What it is                  |
| ------------------ | ------ | --------------------------- |
| `app_version`      | yes    | The manager's own version   |
| `delivery_channel` | yes    | `stable` or `beta`          |
| `reason`           | yes    | The delivery failure's kind |

## `patcher_refused`

A patcher start that the elevation check refused, before any session ran. It carries the facts
the Diagnostics page shows under **LTK Manager not running as admin**, so a count of refusals
can be read by cause.

| Property                | Always | What it is                                                                          |
| ----------------------- | ------ | ----------------------------------------------------------------------------------- |
| `app_version`           | yes    | The manager's own version                                                           |
| `reason`                | yes    | `LEAGUE_ELEVATED` or `MANAGER_ELEVATED`, the same tag the frontend matches on       |
| `manager_elevated`      | yes    | Whether the manager process runs elevated                                           |
| `elevation_type`        | yes    | How the token relates to UAC: `default`, `full`, `limited` or `unknown`             |
| `uac_enabled`           | yes    | Whether User Account Control is on                                                  |
| `builtin_administrator` | yes    | Whether the account is the built-in Administrator                                   |
| `compat_layer`          | yes    | Whether `ltk-manager.exe` carries a `RUNASADMIN` compatibility layer                |
| `cause`                 | no     | The cause the facts point to, such as `uac-disabled`, when the manager is elevated  |
| `integrity`             | no     | The token's integrity level, `high` or `medium`                                     |
| `shell_elevated`        | no     | Whether `explorer.exe` runs elevated, where its token can be read                   |
| `parent`                | no     | The executable name of the process that started the manager, such as `explorer.exe` |

The parent travels as an executable name alone. No path, no command line and no account name
reaches the payload.

## `$exception`

A Rust panic and a frontend crash. The name is the vendor's, and so is `$exception_list`: that
shape is what groups an issue and what a source map resolves against. `kind` says which of the two
it is.

| Property          | Always | What it is                                            |
| ----------------- | ------ | ----------------------------------------------------- |
| `app_version`     | yes    | The manager's own version                             |
| `kind`            | yes    | `app_panic` or `ui_error`                             |
| `$exception_list` | yes    | One entry: `type`, `value`, `mechanism`, `stacktrace` |
| `route`           | no     | The screen a `ui_error` happened on                   |
| `component_stack` | no     | Which components were mounted, where React gives one  |

A panic's entry is typed `RustPanic`, carries the panic message as its value, and holds one frame
naming the file and line the standard library reports. No symbols are needed to read it.

A frontend crash is typed on the error's own constructor name, and its one frame carries the stack
as the engine wrote it. The stack is unresolved until the release's source maps are uploaded.

## What never travels

- A Riot account, a summoner name, a PUUID or a player id
- An IP address, beyond what any HTTP request unavoidably reveals to the vendor
- A Windows username, or any path holding one
- The name, the id or the disk location of any mod
- The contents of any file, log line or archive

## How often

One fingerprint reports once an hour, across the three failure seams and the refusal, so one
machine in a crash loop reports single figures rather than thousands. The fingerprint is the kind
and the location, never the message, so a message carrying a varying id still collapses. An
`app_error` fingerprint is the code and the kind, so two refusals under one code count apart.

The published document holds a sample rate drawn against the identity rather than against the
event, so an install is in or out for a whole day and a sampled session is never half reported.
