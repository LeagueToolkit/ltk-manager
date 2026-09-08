# Privacy page

The source for <https://wiki.leaguetoolkit.dev/manager/privacy>, which the first-run dialog and
the Settings privacy card both link. Publishing is a manual step: the page has to exist before a
release carrying either of those links ships.

Written for a user rather than a contributor. The reference it is written from is
[Telemetry](ux/TELEMETRY.md), which lists every property exactly.

---

## Anonymous diagnostics

LTK Manager sends anonymous diagnostics so that problems get found and fixed without anybody
having to file a report. You can turn this off at any time, and nothing here identifies you.

### Why

More than ten thousand people run the manager every day. When a game patch breaks mod loading for
some of them, or a release introduces a crash, we currently find out only when somebody takes the
time to open a GitHub issue. Almost nobody does, so a problem can go unnoticed for days.

Diagnostics turn that around. If your game fails to start, we see that it happened, what the
manager decided went wrong, and roughly how common it is, without you doing anything.

### What is collected

**When a game session ends**, whether it went well or not:

- how it ended, and what the manager decided went wrong if anything did
- how long it ran, as a rough range rather than an exact time
- how many mods you had enabled, as a number
- your manager version, your Windows build, and your installed game patch
- if a mod was blamed, a scrambled fingerprint of that mod's file and the reason it was blamed

**When the manager itself fails**: an error message, a crash message, and the file and line it
came from.

That is everything. There is no tracking of what you click, no analytics on how you use the app,
and no advertising of any kind.

### What is never collected

- your Riot account, your summoner name, or any account identifier
- your Windows username, or any file path containing it
- the names of the mods you have installed, or where they live on disk
- the contents of any file, log, or archive
- anything at all while diagnostics are switched off

### How you stay anonymous

Your events carry an identity that is generated from a secret stored on your machine and today's
date. It changes every day at midnight UTC, and the secret itself never leaves your computer.

That means we can count how many people hit a problem on a given day, and we cannot follow anyone
from one day to the next.

You can break the link immediately with **Reset anonymous id** in Settings, under Privacy. It
takes effect at once rather than waiting for midnight.

On top of that, not every install reports. We sample, so on any given day many machines send
nothing at all.

### One thing worth knowing about mod fingerprints

When a mod is blamed for a failed game, we send a scrambled fingerprint of that mod's file instead
of its name. The fingerprint is the same on every machine that has the same file, which is exactly
what lets us tell that a hundred people were broken by one mod.

It also means somebody who already has that mod file can work out that the fingerprint is theirs.
The fingerprint identifies the mod, not you, and your library as a whole is never sent. We would
rather say this plainly than claim more privacy than the design actually gives you.

### Turning it off

Open **Settings**, then the **Privacy** card, and switch off **Anonymous diagnostics**. You are
also offered the switch the first time the manager starts after the update that introduced this.

Turning it off stops collection at once. Anything already queued on your machine is deleted rather
than sent later. The manager works exactly the same either way, and nothing about your experience
changes.

### Where the data goes

Events go to PostHog, hosted in the European Union, on a project only the LTK Manager maintainers
can read. They are used to fix bugs and for nothing else, and are never sold or shared.

### Questions

Open an issue at <https://github.com/LeagueToolkit/ltk-manager/issues>, or ask in the project's
Discord at <https://discord.gg/yhzDVRyQex>.
