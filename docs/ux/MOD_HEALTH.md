# Mod health

## Changes

| Date       | Change                                                       |
| ---------- | ------------------------------------------------------------ |
| 2026-08-28 | One drawer title, and three lines under it for three states  |
| 2026-08-28 | The drawer becomes a focused sheet over a dimmed page        |
| 2026-08-28 | An unfixable row says so, and the header says where to go    |
| 2026-08-28 | The repair reports itself in the drawer, not over it         |
| 2026-08-28 | The drawer opens itself, and Play asks before a broken patch |
| 2026-08-28 | A drawer row repairs its own mod, and counts problems        |
| 2026-08-28 | The status bar item is a light cell, led by its glyph        |
| 2026-08-28 | Mod health moves into the status bar as a filled item        |
| 2026-08-28 | The item names a count, and the drawer folds in the ask      |
| 2026-08-28 | A corner notice and a side drawer replace the banner         |

Each edit of this document adds a row at the top. The table keeps the last ten rows.

Mod health is the [Problems](PROJECT_PROBLEMS.md) rules pointed at the installed library. The
engine is shared and the surface is not. A modder reads a list of findings addressed to a
property inside a file. A mod user reads a verdict and presses one button. That split is the
whole design: same rules, same problems, same repairs, two very different things drawn on
screen.

## Goals

- A mod user learns which of their mods will break the game, without bisecting the library
- One button repairs what a machine can repair
- A mod that cannot be repaired says so plainly, so the user goes and finds a replacement
- A newly imported mod is checked without asking, and the import does not wait for it
- A repair is never applied for a game patch the user is not on yet
- A user who has never heard of a rule still gets their library repaired, in one press

## Feature status

This table holds every major feature of Mod health. A status word has one meaning - see
[Problems](PROJECT_PROBLEMS.md) for the legend.

| Feature               | Status    | Note                                                         |
| --------------------- | --------- | ------------------------------------------------------------ |
| The verdict model     | Available | `ModHealthVerdict`: health, fixable count, live counts       |
| The check             | Available | `check_mod_health`, both storages, never writes the mod      |
| The repair            | Available | `repair_mod`, both storages, applies every live fix          |
| The verdict store     | Available | `mod-health-verdicts.json` beside the index, one row per mod |
| The badge             | Available | On the card, only when something is wrong                    |
| The popover           | Available | Plain counts, Repair, re-check, and when it was checked      |
| Check at import       | Available | A background check per install, and the import never waits   |
| Check Health, by hand | Available | In the card menu, answered by a toast                        |
| The library sweep     | Available | Every mod whose basis moved, at startup, skipping the rest   |
| The status bar item   | Available | A light cell at the right of the bar, and its drawer         |
| Repair all            | Available | `repair_mods`, one press for every repairable mod            |
| The launch ask        | Available | Play confirms under itself when a broken mod is enabled      |
| Verdict pruning       | Available | A sweep forgets the verdicts of mods the library dropped     |
| The full findings     | Planned   | Behind a disclosure, for the user who wants the detail       |
| One health surface    | Proposed  | The skinhack and missing-deps warnings join the badge        |

## The verdict

A check runs every Problems rule over one mod's content and summarizes the run for a badge:

| Field       | Meaning                                        |
| ----------- | ---------------------------------------------- |
| `health`    | `healthy`, `repairable`, or `unrepairable`     |
| `fixable`   | How many findings a repair would fix           |
| `counts`    | Every live finding by severity, fixable or not |
| `checkedAt` | When the check ran                             |
| `basis`     | What the check was a claim about               |

`repairable` means at least one finding carries a fix. `unrepairable` means findings exist and
none does. The verdict counts only **live** findings: a dormant rule describes a patch the
installed game has not taken yet, and the Problems panel shows those findings with the fix
withheld. A surface with no panel makes the same cut itself, which is why a repair can never
break a mod on the build the user plays tonight.

Verdicts are remembered in `mod-health-verdicts.json` beside the library index, one row per mod
id. The file is a cache of a computation, not a record - a lost or unreadable file starts empty
and refills on the next check. It was `check-verdicts.json` before the feature took the word
"health" everywhere, and the first sweep after that release deletes the old file rather than
reading it: every row in it predates the basis below, so all of them are due again anyway.

### The basis

A verdict is a claim about one mod under one set of rules on one game build, and it stays true
only for as long as both of those hold. So each one records the pair it was taken under.

| Field     | What it is                                                    |
| --------- | ------------------------------------------------------------- |
| `build`   | The installed game build, absent where none could be read     |
| `manager` | The manager version, which is what a migration table ships in |

The build is there because Riot ships a patch and a dormant rule wakes up. The manager version is
there because a table update is a manager release - see
["Why the table ships in the build"](PROJECT_PROBLEMS.md#why-the-table-ships-in-the-build) - so a
release adding a table has to make every verdict due again on the same game.

Nothing else is in the basis. A mod's own content is not, because the manager is the only thing
that writes it: an install and a repair each record a fresh verdict as they finish, so a mod's
verdict cannot fall behind its files without the manager knowing.

## The check and the repair, per storage

The write is what once kept the rules out of the library - see "The library waited" in
[Problems](PROJECT_PROBLEMS.md). The answer is that both operations meet the rules on a mod
project, wherever the mod keeps its content:

| Storage   | Check                              | Repair                                         |
| --------- | ---------------------------------- | ---------------------------------------------- |
| `project` | Analyze the mod's own tree         | Fix in the tree, with a restore point          |
| `archive` | Unpack to staging, analyze, delete | Unpack, fix, repack, swap the archive in place |

A project-storage repair is the project editor's fix run on the mod's directory, so it leaves
the same `.ltk/restore/` point and is undone the same way. An archive-storage repair replaces
the archive with the repacked result and keeps no copy of the original - see ADR-0005. Either
way a repair that applied nothing leaves the mod untouched, byte for byte.

A repair records the mod's fresh verdict itself, so the badge updates without a second scan.
Any repair that wrote also flushes the next overlay build, so the fix reaches the game without
a manual rebuild.

A modpkg is not checked or repaired. Its content only exists inside its archive, and there is
no unpacked form to run the rules over - the same boundary as ADR-0001.

## The badge

The badge sits on the mod card beside the WAD footprint and missing-dependency badges, and it
draws only when something is wrong. A healthy mod shows nothing, and so does a mod never
checked - a badge on every card would bury the few that matter.

| Verdict        | Badge                                    |
| -------------- | ---------------------------------------- |
| `healthy`      | Nothing                                  |
| `repairable`   | Amber wrench pill with the fixable count |
| `unrepairable` | Red alert pill with the finding count    |

The popover behind the pill carries the verdict in plain counts, when the check ran, one
Repair button, and a re-check. It never shows a property path - the full findings wait for the
disclosure row above. An unrepairable mod's sentence says to look for an updated version of
the mod, because "stop trying" is the actionable half of that verdict.

## The library sweep

**A mod user should never have to wonder which of their mods a patch broke.** The badge answers
that per mod, and only for a mod somebody thought to check. The sweep is what makes the answer
arrive on its own.

It runs at startup, last of the four passes that bring the library in line with disk, because
the three before it decide where each mod's content is. It re-checks every mod whose verdict was
not taken under the current [basis](#the-basis), which is what makes it affordable: on a launch
where neither the game nor the manager moved, the sweep reads the index, reads the verdict file,
finds nothing due, and is over.

| The mod                              | The sweep                |
| ------------------------------------ | ------------------------ |
| Never checked                        | Checks it                |
| Checked on an older build            | Checks it again          |
| Checked by an older manager          | Checks it again          |
| Checked under the basis it is on now | Skips it                 |
| Faulted, or a modpkg                 | Never checked at all     |
| Gone from the library                | Its verdict goes with it |

One mod that cannot be read is logged and stepped over. It records no verdict, so the next sweep
tries it again rather than treating an unreadable archive as an answer.

**Startup is the only trigger.** A patch that lands while the manager is open is not noticed until
the next launch, and neither is a League path pointed somewhere else in Settings. Both leave the
badges and the bar's item describing the build the manager started on. Read
[open question 1](#open-questions).

**A sweep prunes before it checks.** Nothing else drops a verdict, so without that step the file
grows for the life of the library and an uninstalled mod's verdict outlives it forever.

## The status bar item and the drawer

What the library's mod health amounts to is one cell at the right of the status bar, and the
drawer it opens. Those two are the whole of what a mod user has to understand.

```
[ search ]  [ filters ]     ░░░░░░░░╭─────────────────────────╮
                            ░░░░░░░░│ 🐺 Detected issues    ✕ │
  ▓   ▓   ▓   ▓   ▓         ░░░░░░░░│    with mods            │
                            ░░░░░░░░│    Repairing is         │
  ▓   ▓   ▓   ▓   ▓         ░░░░░░░░│    recommended, though… │
                            ░░░░░░░░├─────────────────────────┤
  ▓   ▓   ▓   ▓   ▓         ░░░░░░░░│ 🔧 Charizard  [⏻ Repair]│
                            ░░░░░░░░│    3 problems           │
  ▓   ▓   ▓   ▓   ▓         ░░░░░░░░│ ⚠  Old Ashe Rework      │
                            ░░░░░░░░│    4 unfixable problems │
  ▓   ▓   ▓   ▓   ▓         ░░░░░░░░├─────────────────────────┤
                            ░░░░░░░░│ [ ⏻ Repair 3 mods     ] │
  ▓   ▓   ▓   ▓   ▓         ░░░░░░░░╰─────────────────────────╯
─────────────────────────────────────────────────────────────
  ○ Patcher idle   Start the patcher…        █ 🔧 19 repairs █
```

**The bar has two regions.** The activity region on the left is whichever line has the news, and
it supersedes itself as a session moves - idle, building, launching, in game, a verdict, a
failure. The items to its right are ambient: they answer to nothing the session is doing, so they
outlive every line that passes underneath them. Mod health is the first of them.

**The item is a light cell, and its glyph is what carries it.** The bar's ground is the darkest
surface in the app, so a wash that was lost over cover art reads plainly here, and it is the only
hue in a line of grey. Size does the work the fill was doing: the icon runs most of the bar's
height against a label at the bar's own size, so the item is found as a shape before it is read as
a count. It lightens under the pointer, which is the one thing a solid cell could not do.

**It is found by where it is, not by how loud it is.** That is what a status bar buys: one place a
reader learns once. It is also why nothing floats over the grid any more - the cards stay whole,
and a mod card is never covered by news about itself.

**It carries a count, and the drawer carries the words.** `19 repairs`, or `1 broken` where no
repair can reach the library. A cell has room for a number and little else, and the title saying
what to do about it is one press away.

**It is ambient, so it is not dismissible.** It appears when the library has something wrong and
leaves when the library is clean. There is no dismiss and no dismissed-for-this-session state,
which is also why it no longer waits for a sweep to have just run: a launch that checked nothing
still says what the library is carrying.

**The drawer is a sheet over a dimmed page, not a panel floating inside one.** It was the second
for a while and the list was hard to read: a panel drawn in the same surfaces as the grid, at the
same brightness, in the corner where a toast also lands. A scrim behind it settles all of that at
once - the drawer is the only lit thing on screen, and the cards stop competing with the list
about them. It arrives from the right edge, which is where the sheet lives rather than where its
trigger happens to be.

**It takes focus while it is open.** A list of twenty mods with a press on each is read, not
glanced at, so Tab belongs inside it, Escape closes it, and a click on the dimmed page behind it
means "I'm done here". Nothing outside is reachable in the meantime, which is the honest reading of
a panel this size.

**It still reflows nothing.** A panel that pushed the cards aside would move the one somebody was
reaching for. It steps aside for select mode, which is a mode the user is holding open and would
fight a sheet over the grid they are picking from.

**It opens itself once, when the library first turns out to be broken.** A cell in the status bar
is a thing you learn to look at, and nobody has learned it on their first run - so the drawer says
what is wrong instead of waiting to be asked. Once for the life of the app, whether or not a sweep
just ran, and a reader who closes it has answered: it does not come back when the next verdict
lands. Everything after that is the cell, which is where a reader who wants it knows to look.

**Repair all is one press for the whole library.** It repairs each repairable mod in turn, and a
mod that cannot be repaired is recorded rather than stopping the rest. That is the answer to "do
it for me" that this feature owes: a user who has never heard of a bin property type still gets
their mods working.

**Nothing is repaired without the press.** An archive repair keeps no copy of the original
(ADR-0005), so a rewrite of every mod in the library is not a thing to do to somebody who did not
ask. The press is what makes it theirs.

**The run is drawn where the press was, not over it.** A repair of a whole library takes long
enough to need reporting, and the drawer is already naming every mod it is working through - so a
toast would cover the list in order to report on it. The button's own seat becomes the progress
while the run lasts, and goes back to being the button when it ends. The outcome stays a toast: by
then the drawer has usually emptied itself and gone.

**The drawer holds the whole finding.** A header that says what to do, a row per mod, and the one
press. Each row is a mod name and how much is wrong with it - `3 problems`, or `4 unfixable
problems :(` where no repair can reach any of them. Both halves of the list count the same thing,
so a repairable row shows every finding rather than only the subset a repair can reach. It never
shows a property path, for the same reason the badge's popover does not: that is the modder's
half, and it lives in the Problems panel.

**An unfixable row says the word.** A missing Repair button is not a message: a reader scanning
twenty rows sees one with nothing to press and has to work out why. Saying `unfixable` puts the
one fact that matters in the line they were already reading, and the sad face is there because
this is the row where the manager has run out of things to offer.

Where to go next is said once, by the header, and only where it is the whole story: a library no
repair can reach at all reads "look for updated versions". A mixed list does not repeat it per
row - the header's one line belongs to the repair that most of the list is still owed, and a row
has no second line to spend on the same sentence twenty times.

**A row repairs its own mod, on hover.** Repair all is the answer for somebody who wants their
library back, and a row's own button is for somebody who wants one mod back - the update they just
installed, and nothing else. It is revealed by the pointer rather than drawn on every row, because
a column of twenty identical buttons beside the one that repairs them all is a list of decisions
where the reader wanted a list of mods. An unrepairable row is given none, since it has no press
that could work.

## Launching with something broken

Pressing Play with a broken mod enabled is the moment the whole feature is for. The manager knows
the game is about to load something that does not match it, and the reader is one click from
finding out the hard way.

**The ask is anchored under the button that caused it.** Not a dialog: a modal takes the screen
away and puts the reader somewhere else to answer a question about where they were. A popover
under Play leaves the button, the count in the status bar and the library all in view.

**Only the enabled mods count.** A broken mod nothing will apply is not what this launch is about,
and warning over one teaches the reader to press through the warning that matters.

**Every way in asks, the split menu included.** A gate the menu walks around is not a gate, and
whether a given entry reaches the mods is a question about patcher state the reader is not
tracking - Launch League applies the overlay when the patcher is already up and applies nothing
when it is not. One rule they can see beats a rule with an exception they cannot. The ask anchors
under the controls either way, so an entry that is gone from the screen by the time it is answered
still has somewhere to be answered.

**It confirms, it does not refuse.** "Launch anyway" is always there and always works. A user who
knows their mod is fine, or who wants to see the break for themselves, is not somebody to stop -
the manager's job here is to make sure the choice was made rather than stumbled into.

**The way out is the drawer, not a repair.** The other button opens the list rather than repairing
on the spot, because a repair rewrites files and the reader has just said they want to play. What
they need first is to see which mods, and the drawer is the surface that both shows and repairs.
Where no repair can reach any of them it says so, and offers only the look.

**Ctrl+P is not gated.** A keyboard shortcut is a thing you learn on purpose, and it has no
pointer near a button to hang an ask under. It stays the way out for somebody who already knows
what their library is carrying.

**The title says what was found, and the line under it says which errand.** "Detected issues with
mods" is the same in every state, because the reader's next question is not what happened but what
they are meant to do - and that has three answers, not one. All fixable is "**repairing is
recommended**", none fixable is "look for updated versions", and a mixed list names both. A panel
whose first row is a paragraph about itself has spent its best line on framing, so this is one
line and it is the ask.

**Its inner edge is the handle.** The drawer's own border resizes it, the gesture the editor's side
panels already answer to. It stops before it has eaten the whole window, and the width it is left
at outlives the close - reopening gives back the panel the reader shaped.

**The handle is last in the tab order and never the first thing focused.** It is the one control
that changes nothing but the shape of the panel, and a drawer that opens with a lit bar down its
edge has spent its first impression on the least of what it does.

**Its counts come from the live verdicts, not from the sweep's report.** A repair refreshes each
mod's verdict as it goes, so both surfaces empty themselves as the press lands rather than
standing there naming mods that are already fixed.

## When a check runs

| Trigger                    | How                                                       |
| -------------------------- | --------------------------------------------------------- |
| A game patch               | The startup sweep, because every verdict's basis moved    |
| A manager release          | The same, because a release is how a table ships          |
| An install, single or bulk | A background check per imported mod, off the install path |
| Check Health, in the menu  | On demand, answered by a toast either way                 |
| The badge's re-check       | On demand, from the popover                               |
| A repair                   | The repair records the post-repair verdict itself         |

The install's check runs on a detached thread and announces once at the end
(`mod-health-verdicts-updated`), so importing thirty mods costs the import nothing and the badges
arrive when the results do. The sweep runs on the startup thread the other three passes already
use, reports through a toast per mod, and announces the same event when it finishes.

The menu's toast exists because a clean check draws no badge: without an answer the click
would look ignored. "No problems found" is the answer.

## Decided questions

| Question                                         | Answer                                             |
| ------------------------------------------------ | -------------------------------------------------- |
| Where do verdicts live?                          | `mod-health-verdicts.json`, a map beside the index |
| What makes a stored verdict stale?               | Its basis: the game build and the manager version  |
| Does the manager repair a mod on its own?        | No. Repair all is one press, and it is the user's  |
| Does the item draw when nothing was re-checked?  | Yes. It answers to the verdicts, not to the sweep  |
| Where does the item sit?                         | A cell at the right of the status bar              |
| Can a reader dismiss it?                         | No. It leaves when nothing is wrong any more       |
| Does it move the library when it appears?        | No. It overlays, so no card shifts under a reader  |
| Does one mod failing stop Repair all?            | No. It is recorded, and the rest are repaired      |
| Does a check write anything to the mod?          | No. The archive stays byte for byte                |
| What does a repair do with the original archive? | Replaces it, and keeps no copy - ADR-0005          |
| Can a repair run for a build the user is not on? | No. Dormant rules' findings are cut from the run   |
| Is a repaired mod repairable again next patch?   | Yes. The rules stay quiet about a repaired value   |
| Does one broken mod stop a batch check?          | No. It is logged, skipped, and has no verdict      |
| Does a repair disturb the mod's setup?           | No. Id, slug, profiles and layers all stay         |
| Can the patcher run during a repair?             | No. A check yes - it only reads                    |
| Is a mod's content part of what makes it stale?  | No. Only the manager writes it, and it re-checks   |

## Open questions

1. What notices a basis that moves while the manager is open? A patch installed in the background
   and a League path changed in Settings both move it, and neither re-sweeps until the next
   launch. The path is the cheap half, since Settings already knows when it changed. The patch
   needs something watching `content-metadata.json`, and a sweep that starts while a user is
   halfway through installing mods is its own question.
2. Where do the other ambient items go? The bar now has a region for them and exactly one
   tenant. The game build, the overlay's age and the notification count are all candidates, and
   the order they sit in is a decision nobody has had to make yet.
