# Mod health

## Changes

| Date       | Change                                                       |
| ---------- | ------------------------------------------------------------ |
| 2026-09-12 | An unbidden panel is told from one the reader opened         |
| 2026-09-07 | The panel names a selection, and select mode is retired      |
| 2026-09-04 | The list ends in a line the informative findings fold under  |
| 2026-09-03 | An archive repair reads the archive where it lies            |
| 2026-09-02 | A press about one mod opens the panel on that mod            |
| 2026-09-02 | A pick no longer withholds the panel from a press            |
| 2026-09-02 | The library is checked by hand, over all of it or a pick     |
| 2026-09-02 | The announcement is spent on the findings, not on the launch |
| 2026-09-02 | Severity decides the hue, and the verdict decides the words  |
| 2026-09-01 | A rule's own severity comes from the build, not the store    |
| 2026-09-01 | The count is a count, and the repair's reach is words beside |

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

| Feature               | Status    | Note                                                              |
| --------------------- | --------- | ----------------------------------------------------------------- |
| The verdict model     | Available | `ModHealthVerdict`: health, fixable count, live counts            |
| The check             | Available | `check_mod_health`, both storages, never writes the mod           |
| The repair            | Available | `repair_mod`, both storages, applies every live fix               |
| The verdict store     | Available | `mod-health-verdicts.json` beside the index, one row per mod      |
| The badge             | Available | On the card, only when something is wrong                         |
| The popover           | Available | Plain counts, Repair, re-check, and when it was checked           |
| Check at import       | Available | A background check per install, and the import never waits        |
| Check Health, by hand | Available | In the card menu. Says what it waits for, or answers a press      |
| Checking the library  | Available | A toolbar press over all of it, a selection bar press over a pick |
| The library sweep     | Available | Every mod whose basis moved, at startup, skipping the rest        |
| The startup sync      | Available | The cache is filled in front of the sweep that reads it           |
| Hashtables first      | Available | No check or repair runs without them - ADR-0009                   |
| The alarm ladder      | Available | Three rungs. The hue is the severity, the words the verdict       |
| The status bar item   | Available | A light cell at the right of the bar, and its drawer              |
| Stopping a run        | Available | An ✕ beside the progress. What was written stays written          |
| Repair all            | Available | Behind the footer's caret. The press repairs what is enabled      |
| The launch ask        | Available | Play confirms under itself when a broken mod is enabled           |
| Verdict pruning       | Available | A sweep forgets the verdicts of mods the library dropped          |
| The full findings     | Planned   | Behind a disclosure, for the user who wants the detail            |
| One health surface    | Proposed  | The skinhack and missing-deps warnings join the badge             |

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
none does. There is no fourth word for a check that could not do its job - see
[The hashtables come first](#the-hashtables-come-first).

**Severity decides whether the mod is broken at all, and `Info` never is.** A finding at `Info` is
worth knowing and says nothing is wrong, so a mod holding only those reads `healthy` and the
badge, the drawer and the status bar item all stay quiet about it. `counts` still carries them, so
anything drawing a tally draws them, and the Problems panel lists them as it lists everything else.
This is what the flat drawer bought: the list is ordered by severity and no longer grouped under a
repairable and an unrepairable heading, so the verdict word is free to mean "is anything wrong"
rather than "did a rule say anything". The cost is that a repair reaching only informative findings
is not offered from the library - `audio/bank-id` is the one - and is applied from the project's
Problems panel instead.

The verdict counts only **live** findings: a dormant rule is waiting on the
machine - for a patch the installed game has not taken yet, or for an install to read at all - and
the Problems panel shows those findings with the fix withheld. A surface with no panel makes the same cut itself, which is why a repair can never
break a mod on the build the user plays tonight.

Verdicts are remembered in `mod-health-verdicts.json` beside the library index, one row per mod
id. The file is a cache of a computation, not a record - a lost or unreadable file starts empty
and refills on the next check. It was `check-verdicts.json` before the feature took the word
"health" everywhere, and the first sweep after that release deletes the old file rather than
reading it: every row in it predates the basis below, so all of them are due again anyway.

### What the store keeps

**The store keeps what the run observed, and nothing the build owns.** A remembered brief is a rule
id, the counts under it and the type pairs it found. Everything the rules declare about themselves
is rebuilt on load from the manager that is running, so a release that rewrites a title, a why-not
or a description reads correctly out of every verdict already on disk.

That has to hold for more than the sentences. A rule that reports at one severity whatever it is
run over is declaring a fact about the check, exactly as its title is - and a release that demotes
one to `Info` because the state turned out to be worth knowing rather than wrong has to stop the
amber triangle on every stored verdict at once. Nothing in [the basis](#the-basis) moves when a
rule changes, so a remembered severity would stand until Riot shipped a patch.

| What a brief holds | Who answers                                    |
| ------------------ | ---------------------------------------------- |
| Title, description | The running build, from the rule               |
| Why-not sentence   | The running build, from the rule               |
| Severity           | The running build, where the rule declares one |
| Counts, type pairs | The run that found them                        |

One rule declares none. `bin/property-type` costs a mod a crash on an install that has taken the
change and a warning on one that has not, so what a finding costs is a question about the machine
and only the run that read it can answer. The severity a brief keeps is there for that rule, and
for a rule this build no longer ships, which has nobody left to answer for it.

### The basis

A verdict is a claim about one mod under one set of rules, on one game build, against one set of
names and one set of types, and it stays true only for as long as all four hold. So each one
records what it was taken under.

| Field     | What it is                                                        |
| --------- | ----------------------------------------------------------------- |
| `build`   | The installed game build, absent where none could be read         |
| `manager` | The manager version, which is what a migration table ships in     |
| `tables`  | The shared hashtable cache's generation, absent where it is empty |
| `schema`  | The meta schema database's generation, absent where none was open |

The build is there because Riot ships a patch and a dormant rule wakes up. The manager version is
there because a table update is a manager release - see
["Why the table ships in the build"](PROJECT_PROBLEMS.md#why-the-table-ships-in-the-build) - so a
release adding a table has to make every verdict due again on the same game.

**The tables are there because a check reads a different mod without them.** A newer cache names
paths an older one did not, and one repair turns on exactly that - see
[The hashtables come first](#the-hashtables-come-first). So a sync makes every stored verdict due
again, which is what shipped broken in 1.15: syncing changed nothing, and the poisoned badges stood
until the next game patch. Its generation stamp moves only when a sync installs something, so a
press that changes nothing makes nothing due.

**The schema is there because it decides `bin/property-type` outright.** The game compares a bin's
type tag against its own registrar by exact equality and silently discards a value that does not
match, so a check taken against an older database was a claim about other types. Its generation is
the publisher's own stamp, so - like the tables - a sync that installs nothing makes no verdict
stale.

Nothing else is in the basis. A mod's own content is not, because the manager is the only thing
that writes it: an install and a repair each record a fresh verdict as they finish, so a mod's
verdict cannot fall behind its files without the manager knowing.

### The hashtables come first

**A check does not run until the hashtable cache is there.** The rules name a mod's content through
it, and one repair - a `Hash` the game now wants as a `File` - can only be derived from the path
behind that hash. A check with no tables therefore reports findings as unrepairable that a synced
machine repairs in one press, and "look for a new version" is the one thing a verdict must not say
wrongly.

So the cache is a precondition, not a caveat on the answer. A mod the manager cannot judge properly
stays **unchecked** - no verdict, no badge, no sentence - which is a claim about nothing, and the
library already draws a never-checked mod exactly that way. The launch fills the cache in front of
the sweep, and a manual sync sweeps as it finishes, so the state clears itself without the user
learning what a hashtable is.

**This is deliberately not a user-facing state.** An earlier draft gave the verdict a fourth word,
a muted "couldn't fully check" pill and a line sending the reader to Settings, and was rejected for
handing the manager's own unfinished setup to somebody who installed a skin - see
[ADR-0009](../adr/0009-a-health-check-requires-the-hashtables.md). Standing down is the same fact
with none of the cost.

**It is machine-wide rather than per mod.** A mod shipping complete tables of its own could in
principle be judged with an empty cache, but knowing that means scanning it first - which is most
of what a check costs, thrown away when the answer is no. The window is seconds after launch, so
the simple precondition is worth more than the mods it defers.

### What Check Health says while it waits

The card menu's Check Health is the one surface that offers the check by hand, so it is the one
that has to answer **before** the press rather than after it. A live-looking row that refuses when
clicked is how 1.15 taught users the command was broken. The row is therefore one of three things:

| The tables          | The row reads         | The press             |
| ------------------- | --------------------- | --------------------- |
| Open                | Check Health          | Runs the check        |
| On their way        | Syncing hashtables…   | Nothing, and it spins |
| Absent, none coming | Hashtables not synced | Nothing               |

"On their way" is a sync holding the cache's update lock - the launch's own, or one pressed in
Settings - or a launch whose startup pass has not reported yet, since that pass fetches the tables
in front of the sweep and holds the lock for only part of that. Anything else with no tables is the
third row: nothing is fetching them but a sync the reader starts, and a spinner there would be
waiting on nobody.

The badge's re-check is disabled by the same fact. A verdict outlives the tables it was taken
against, so that popover can open on a launch that has none.

**Repair answers with an error rather than a drawn state.** It is on the same precondition - a
repair with no names applies what it can, withholds the rest, and records a verdict calling the
remainder unrepairable - but it is reached only by a stored verdict outliving its tables, which
is rare enough that a permanently-drawn wait would cost every other reader for nobody. So the
press refuses, in words.

Those words are read off the same three states, because "try again in a moment" is a lie on a
machine where nothing is fetching anything:

| The tables   | The sentence                                                                       |
| ------------ | ---------------------------------------------------------------------------------- |
| On their way | Still syncing the hashtables a repair needs. Try again in a moment.                |
| None coming  | The hashtables a repair needs are not synced. Sync them in Settings and try again. |

Check Health refuses the same way, in its own noun, for the press that lands in the moment the
answer changes.

## The check and the repair, per storage

The write is what once kept the rules out of the library - see "The library waited" in
[Problems](PROJECT_PROBLEMS.md). The answer is that both operations meet the rules on a mod
project, wherever the mod keeps its content:

| Storage   | Check                             | Repair                                              |
| --------- | --------------------------------- | --------------------------------------------------- |
| `project` | Analyze the mod's own tree        | Fix in the tree                                     |
| `archive` | Analyze the archive where it lies | Fix where it lies, and edit the fixed files back in |

**A bin no table names is reached by its chunk hash.** The check lists such a bin under the
sixteen hex digits an unpack writes it as, the unpack writes the same, and the edit puts the fixed
bytes back into the chunk that hex names - so the site a user pressed on and the file the fix
rewrites are one address at every step. See
["What makes a file a bin"](PROJECT_PROBLEMS.md#what-makes-a-file-a-bin). A repair keeps no way
back either way, and the path it hashes away goes into the mod's own tables exactly as a named
bin's would.

A project-storage repair is the project editor's fix run on the mod's directory. An
archive-storage repair is the same fix run over the files the check read, holding what it writes
until the archive is edited - see ADR-0025 - and it keeps no copy of the original - see ADR-0005.
An archive the edit refuses is unpacked, fixed and repacked whole. Either way a repair that
applied nothing leaves the mod untouched, byte for byte.

**What a repair promises is a name, not reversal.** Neither storage keeps a way back. What
both keep is the mod's own `hashes/game.hashes.txt`: every path a fix hashes away is written
there first, so a repaired mod still names what it holds - see
[ADR-0006](../adr/0006-a-repair-preserves-names-instead-of-keeping-a-restore-point.md). A user
who wants the mod as it was reinstalls it.

It is not a promise about content. Most repairs rewrite the value they came for and leave the
rest of the file as they found it, but where a format admits no such edit the fix rebuilds what
it touches and the author's fidelity goes with it - see
[ADR-0011](../adr/0011-a-repair-may-lose-fidelity-where-no-in-place-edit-exists.md). Which
repairs spend it is a property of each rule, and each says so.

A repair records the mod's fresh verdict itself, so the badge updates without a second scan.
Any repair that wrote also flushes the next overlay build, so the fix reaches the game without
a manual rebuild.

A modpkg is not checked or repaired. Its content only exists inside its archive, and there is
no unpacked form to run the rules over - the same boundary as ADR-0001.

## How loud a finding is drawn

**The verdict says what a repair can do. The severity says how much it matters.** Every surface mod
health has reads both, because `unrepairable` covers a mod the game will refuse to load and a mod
that plays with one effect missing, and those two do not deserve the same colour. So there are
three rungs, not two, and the hue is the severity's while the words stay the verdict's.

| Rung         | The mod                                     | Hue   | The errand                  |
| ------------ | ------------------------------------------- | ----- | --------------------------- |
| `repairable` | A repair reaches at least one finding       | Amber | Press the button            |
| `broken`     | No repair, and a fatal or an error          | Red   | Go and find a newer version |
| `flagged`    | No repair, and nothing worse than a warning | Grey  | Nothing. Keep playing it    |

There is no fourth rung, because `Info` alone never makes a mod unhealthy - see
[The verdict](#the-verdict).

**A repair on offer leads, whatever else is in the list.** Where a surface answers for several mods
at once, `repairable` outranks the other two: the press is what the reader is being sent to, and a
library five presses from fixed is not one to paint red over the one mod that has to be replaced
instead. Below that the loudest wins, so one mod the game refuses is enough to make a list red.

**This is what 1.15 got wrong, and it is why a user shipped a screenshot of it.** The hue was the
verdict's alone: the moment no repair reached the library, the bar went red and the card said the
mod could not be repaired. A mod whose only finding was a warning - `bin/property-type` on an
install that has not taken the change - therefore read exactly like a mod the game refuses to load,
and readers went looking for replacements that did not exist for a mod that was working.

**Neither `broken` nor `flagged` is a fourth verdict word.** The stored verdict is still one of
three, and the split is in what a surface reads rather than in what the check concludes, so nothing
in `mod-health-verdicts.json` changes shape and the counts every rung needs are already on each
row.

## The badge

The badge sits on the mod card beside the missing-dependency badge, and it
draws only when something is wrong. A healthy mod shows nothing, and so does a mod never
checked - a badge on every card would bury the few that matter.

It is one mod's [rung](#how-loud-a-finding-is-drawn), drawn as a pill.

| Rung         | Pill                                     | Headline                    |
| ------------ | ---------------------------------------- | --------------------------- |
| `repairable` | Amber wrench pill with the fixable count | This mod needs a repair     |
| `broken`     | Red alert pill with the finding count    | This mod cannot be repaired |
| `flagged`    | Grey warning pill with the finding count | This mod loads with a fault |

The popover behind the pill carries the verdict in plain counts, when the check ran, one
Repair button, and a re-check. It never shows a property path - the full findings wait for the
disclosure row above.

The two unrepairable rungs say different things, because their users have different problems. The
red one says to look for an updated version of the mod, because "stop trying" is the actionable
half of that verdict. The grey one says the mod loads and something in it will not behave, and it
does not tell anyone to go looking - a mod whose worst finding is a warning is a mod most people
should keep and play.

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
| Checked against older hashtables     | Checks it again          |
| Checked against an older meta schema | Checks it again          |
| Any of the above, with no hashtables | Stands down entirely     |
| Checked under the basis it is on now | Skips it                 |
| Faulted, or a modpkg                 | Never checked at all     |
| Gone from the library                | Its verdict goes with it |

**The sweep fills the cache before it reads it.** A launch whose hashtables are empty or behind the
published release fetches first, because everything the sweep is about to conclude turns on what
those tables name. It is the only one of the startup passes that waits on a network, so it sits
immediately in front of the sweep rather than at the head of the four - the three above it are what
the library view is drawing. A sync that fails takes the sweep with it: with no tables there is
nothing a verdict could honestly say, so the pass prunes what the library dropped and stops there.

One mod that cannot be read is logged and stepped over. It records no verdict, so the next sweep
tries it again rather than treating an unreadable archive as an answer.

**Startup is one of three triggers.** The second is a hashtable sync that installed something,
which sweeps as it finishes rather than leaving the badges to the next launch - the press has just
disproved every verdict on screen. The third is a reader pressing for one, which is
[its own section](#checking-the-library-by-hand) because it takes the library on different terms. A patch that lands while the manager is open is not noticed
until the next launch, and neither is a League path pointed somewhere else in Settings. Both leave
the badges and the bar's item describing the build the manager started on. Read
[open question 1](#open-questions).

**A sweep prunes before it checks.** Nothing else drops a verdict, so without that step the file
grows for the life of the library and an uninstalled mod's verdict outlives it forever.

## Checking the library by hand

**A reader who suspects their library does not have to open twenty card menus to find out.** The
card menu answers for one mod and the startup pass answers when a basis moved, which between them
leave nothing at all for the reader who changed something the manager cannot see, or who simply
wants to know now. Two presses in the library are that answer.

| The press         | What it takes              |
| ----------------- | -------------------------- |
| The toolbar       | Every mod in the library   |
| The selection bar | The mods the reader picked |

**A press takes the verdicts again, whatever their basis says.** That is the whole difference
between it and the startup pass. Skipping a mod whose stored verdict is still current is what makes
the automatic sweep affordable, and it is what would make a pressed one look broken - a reader who
asked is owed a check, not a report on how little there was to do.

**It answers before the press, and refuses after it.** With no hashtables the automatic pass stands
down silently, because nobody asked it anything - see
[The hashtables come first](#the-hashtables-come-first). A press has somebody waiting, so each
control draws the wait in its tooltip in the card menu's own three states, and the run refuses in
words for the press that lands in the moment the answer changes.

**One run at a time.** A pressed run is the startup sweep's own machinery, so it shares the progress
toast, the verdict file and the one cancel. A press while a sweep is going says so and changes
nothing, because two runs would leave the reader watching two counters fight over one line.

**The press reopens the question the announcement answers.** A library that comes back exactly as it
went in still owes the reader a sentence, and the announcement is otherwise spent on those findings
for good. So the run announces what it found in whichever form the
[rung](#how-loud-a-finding-is-drawn) calls for, and a run that found nothing wrong says "No problems
found" - a clean check draws no badge, and a press with no answer looks ignored.

## The status bar item and the drawer

What the library's mod health amounts to is one cell at the right of the status bar, and the
drawer it opens. Those two are the whole of what a mod user has to understand.

**The cell follows the library.** The status bar spans the app and the drawer is the library's, so
away from a library page the cell draws nothing rather than becoming a press that opens nothing.
The library page reports itself, so the cell can never offer a drawer no page is there to mount.
The launch ask is the exception that has to cross: its controls are in that same app-wide bar, so
"Repair first" goes to the library and the drawer takes the request when it mounts.

```
[ search ]  [ filters ]  ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
                         ░░░░░░╭─────────────────────────╮░░░░
  ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░│ 🐺 Detected issues    ✕ │░░░░
                         ░░░░░░│    with mods            │░░░░
  ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░│    Repairing is         │░░░░
                         ░░░░░░│    recommended, though… │░░░░
  ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░├─────────────────────────┤░░░░
                         ░░░░░░│ 📦 Charizard  [⏻ Repair]│░░░░
  ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░│ 📦 Old Ashe Rework  ⛔2 │░░░░
                         ░░░░░░│ 📦 Pengu Graves     ⚠ 4 │░░░░
  ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░├─────────────────────────┤░░░░
  ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░│          [⏻ Repair 2 ▲] │░░░░
                         ░░░░░░╰─────────────────────────╯░░░░
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

**It carries a count, and the drawer carries the words.** `19 repairs`, `1 broken` where the game
would refuse one of them, and `1 flagged` where no repair reaches the library and nothing in it
stops a mod loading. A cell has room for a number and little else, and the title saying what to do
about it is one press away.

**`broken` is spent only where the game is what pays.** It is the loudest word the bar has, and a
word that describes every unhealthy library is a word that describes none of them - which is how a
library of working mods came to wear a red cell reading `1 broken`.

**It is ambient, so it is not dismissible.** It appears when the library has something wrong and
leaves when the library is clean. There is no dismiss and no dismissed-for-this-session state,
which is also why it no longer waits for a sweep to have just run: a launch that checked nothing
still says what the library is carrying.

**It is a dialog in the middle of a dimmed page, not a panel floating inside one.** It was the
second for a while and the list was hard to read: a panel drawn in the same surfaces as the grid,
at the same brightness, in the corner where a toast also lands. A scrim and a blur behind it settle
all of that at once - the panel is the only lit thing on screen, and the cards stop competing with
the list about them. The middle is then the only placing that owes nothing to where the trigger
happened to be, and a reader who was sent here by a launch has their eye there already.

**The sheet down the right edge is kept, and is not what opens.** Both draw one panel, so the two
are a placing apart and cannot say different things about the same library. The sheet is the one
that can be resized, because an edge is a thing to drag and a centred dialog has no such edge.

**It takes focus while it is open.** A list of twenty mods with a press on each is read, not
glanced at, so Tab belongs inside it, Escape closes it, and a click on the dimmed page behind it
means "I'm done here". Nothing outside is reachable in the meantime, which is the honest reading of
a panel this size.

**It still reflows nothing.** A panel that pushed the cards aside would move the one somebody was
reaching for.

That is a rule about a panel that arrives unbidden. Findings come looking for a reader, so
whatever they push aside is pushed aside at a moment the reader did not choose. A panel the reader
opened is a different object: the reflow is the answer to their own press, and they close it the
moment it is in the way. The Library's own documents panel reflows for exactly that reason - see
"The documents panel" in [LIBRARY.md](LIBRARY.md).

**A selection does not withhold it.** The panel did step aside for a reader picking mods while it
was a sheet over the grid, which was a sheet fighting the cards being picked from. A centred
dialog covers the grid whatever is picked, so all the rule did by then was leave "Show me" and the
selection's own Check health pressing nothing at all - and a press that draws nothing is the one
thing every control here owes an answer to. Escape and Ctrl+A belong to the panel while it is
showing, so leaving it does not also drop the selection underneath.

**It announces itself once, when the library first turns out to be unhealthy.** A cell in the
status bar is a thing you learn to look at, and nobody has learned it on their first run - so mod
health says what is wrong instead of waiting to be asked. Once per run, whether or not a sweep just
ran, and a reader who has answered it has answered: it does not come back when the next verdict
lands. Everything after that is the cell, which is where a reader who wants it knows to look.

**What spends it is the findings, not the run.** A library somebody has decided to keep is not news
twice, and an announcement that greets a reader every launch over the same mods is one they learn
to dismiss unread. So what they were told outlives the launch: each unhealthy mod, and how much is
wrong with it. A launch that finds that same library says nothing and leaves it to the cell. A mod
that turned up, got worse or got repaired is a different library, and that one is announced.

There is no dismiss control, for the same reason the cell has none. Meeting it is what spends it,
and letting the toast go is a way of meeting it. Only what is wrong is compared, so re-ordering the
library is not a change, and neither is an `Info` count that moved - by
[The verdict](#the-verdict) that is not a fault in the first place.

**What the announcement is depends on the rung.** Taking the screen away is worth it for a library
the game will refuse and is not worth it for one it will load, so `flagged` announces itself as an
info toast carrying the drawer's own poro, one line, and a Show me that opens the panel.
`repairable` and `broken` still open the drawer outright. The announcement is one either way:
whichever form it takes, it is spent, and the cell carries the rest.

**The press sits where a dialog's confirm sits.** Bottom right of a footer band of its own, at the
size every other dialog in the app confirms at. It was the panel's whole bottom edge for a while,
which made the list look like a thing wrapped around a button rather than a finding with an action
under it - and a panel that is a dialog everywhere else should not have one control that is a
banner.

**The footer is there whether or not anything can be repaired.** A library no repair can reach
still has a dialog to answer, and drawing the band only when there was a run to start left that
list ending on an edge, with the ✕ in the corner as the whole of the way out. The dismissal takes
the confirm seat itself when it is the only press, and stands as the quiet half of the pair when a
repair is on offer.

**The press repairs what the next game carries. Repair all is behind the caret.** A disabled mod
reaches no overlay, so repairing it is work the game does not need - and it is still the reader's
mod, so the library-wide run stays one press away rather than gone. The footer is a split button
in `PlayButton`'s idiom, and it collapses to one plain button when every broken mod is switched on,
because two presses that do the same thing is a question nobody asked.

**It collapses at the other end too.** With nothing broken switched on there is no next-game work
to lead with, and splitting there offered "Repair 0 enabled mods" as the recommendation while the
only run that did anything sat behind the caret. The press becomes Repair all, which is the whole
of what is on offer.

Either scope repairs each mod it names, and a mod that cannot be repaired is recorded rather than
stopping the rest. That is the answer to "do it for me" that this feature owes: a user who has
never heard of a bin property type still gets their mods working.

**"Repair first" repairs.** The launch guard's way out starts the enabled-only run and opens the
drawer for it to report in. Opening the list and leaving the reader to find the button again is
the same press asked for twice.

**Nothing is repaired without the press.** An archive repair keeps no copy of the original
(ADR-0005), so a rewrite of every mod in the library is not a thing to do to somebody who did not
ask. The press is what makes it theirs.

**A run can be called off, and what it wrote stays written.** The ✕ beside the progress stops
every worker at its next file - a repair is not a transaction, and the mods it finished are
repaired. A mod it had started and not finished forgets its verdict, so the next sweep owes it a
check rather than trusting one that did not happen.

**The run is drawn where the press was, not over it.** A repair of a whole library takes long
enough to need reporting, and the panel is already naming every mod it is working through - so a
toast would cover the list in order to report on it. The footer becomes the progress while the run
lasts, and goes back to holding the button when it ends. The bar spans that band rather than
sitting where the button sat, because a progress bar reports a whole run and has no reason to be
the width of one press. The outcome stays a toast: by
then the drawer has usually emptied itself and gone.

**A press about one mod opens the panel on that mod.** The library-wide surfaces stay quiet about a
mod whose findings are all `Info` - that is [the verdict](#the-verdict) doing its job, and none of
it is a fault. A reader who pressed Check Health on that mod asked anyway, so its row joins the
list, the panel scrolls to it and unfolds it. The title is the one thing that cannot carry over: a
panel drawing nothing that is wrong says "No problems found" rather than calling them issues, and
the row is sent nowhere, since it is missing no press.

That row leaves with the panel. Nothing about it is remembered, because nothing about it is wrong -
the next time the panel opens it holds what the library is carrying and no more.

**The same offer stands over the whole library, on a line at the end of the list.** A reader who
checked one mod that way learns those findings exist, and then a sweep of the library draws none of
them - the list is what is wrong, and an `Info` never is. So the list ends in an `Info` line
counting the mods that hold nothing worse, and folding open onto their rows.

**A line rather than a pill in the footer, because the boundary is the point.** What is under it is
not what the panel is reporting, and a reader triaging the list above has to be able to see where
that list ends - a pill by the Close button reveals rows without ever saying which rows it revealed.
It sits last because severity is what orders the rows either way and nothing under it outranks
anything over it, so the line falls exactly where the list was already going to trail off. It is
drawn only where there is something to fold.

What the fold does not touch is anything the panel is announcing. The title, the sentence under it,
the hue and the repair's own count all still read the mods something is wrong with, so opening the
line can never send a reader on an errand. The choice outlives a close, unlike the pressed row: a
reader who wants the fuller list is not asked for the press every time the panel opens. A press
about one mod under the line opens the line with it, since a press answered by a row the reader
still has to go and find is not answered.

**The drawer holds the whole finding.** A header that says what to do, one row per mod, and the
one press. The rows run flat, as the Problems panel lists one file per row, and a row is a mod
name and a tally of what is wrong with it by severity - a glyph and a count per rung, with the
empty rungs drawn as nothing. It counts every finding rather than only the subset a repair can
reach. It never shows a property path, for the same reason the badge's popover does not: that is
the modder's half, and it lives in the Problems panel.

**Severity orders the list, because severity is what a reader is triaging by.** The rows the
footer press targets lead, then the worst mod, then the largest. Repairability was the old
ordering and it ranked the list wrongly: a mod one repair reaches and six hundred findings do not
sat above a mod with a single fatal, because the split asked whether _any_ finding was fixable
rather than how much of the mod was owed.

**A row with no repair says so in the press's own seat.** A missing Repair button is not a
message, and a flat list has no header to say the word once over a class of rows. What replaces
it is not a column of `unfixable` per row, which was the noise the old grouping folded away: the
row stays clean at rest, and `Needs an updated version` appears in the seat the press would have
taken, on hover and on focus. A reader asks the question only at the moment they reach for the
button, so that is where it is answered.

Where to go next is said once, by the header, and only where it is the whole story: a library no
repair can reach at all reads "look for updated versions". A mixed list does not repeat it per
row - the header's one line belongs to the repair that most of the list is still owed, and a row
has no second line to spend on the same sentence twenty times.

**A row unfolds into its rules.** The tally says how much and nothing else, so the row's name
is a disclosure: folding it open lists the rules behind it - `Meta property type
mismatch (2)` behind its own severity glyph, with the rule's id as a chip, and the actual
disagreement under it: `Expected File, found Hash`, one line per type pair the findings hold, with
the rule's own sentence standing in only where a rule reports no types. That line is where the
cause stops: never a site or a property path, per the line above.

**The glyph is the rule's worst finding, not the rule's own rank.** A rule can report the same
state at two costs - `bin/property-type` is fatal on an install that has taken the change and a
warning on one that has not - so a group of findings is only as good as its worst member.

**The count is a count.** How far a repair gets is said in words beside it, and only where the
press falls short: `not auto-fixable` on a rule it will not touch, `1 not auto-fixable` where it
reaches the rest. One line and one mechanism, so a rule the press half-reaches and a rule it cannot
reach at all read the same way and differ by a number. `(1 of 3)` said it as a fraction, which is
the shape of a page indicator rather than of a tally, and it borrowed the warning tone to say it -
which put a second colour on a line whose glyph is already carrying severity.

Those words are marked only inside a mod the press is offered for: a library no repair reaches at
all is the header's one sentence, not twenty rows of it. A verdict recorded before briefs existed
unfolds into nothing, so its row stays plain text until the next check rewrites it.

**A rule line says its cause once.** The why-not sentence used to follow the cause on a line of its
own, and the two read as the panel saying one thing twice: both are grey prose at the same size,
and a rule whose description already names where the keys live does not need a second line saying
they are not in the mod. The cause keeps the line, and the why-not becomes the count's tooltip -
which is the seat the question is asked from, the same answer the row gives when a reader reaches
for a Repair press that is not there.

**An enabled mod's mark takes the accent.** The footer press repairs what the next game carries,
and `Repair 2 enabled mods` is a promise about rows the list had no way to point at. The row's
package mark in the accent is that word made visible - and a disabled mod's sits a rung dimmer -
so the press and its targets can be read against each other. The same fact orders each group:
enabled mods lead, and within each half the mod with the most problems does.

**The count gives up its seat to the hover Repair.** The two share the row's right edge rather
than sitting side by side, because a column of counts indented to leave room for a button that is
not there reads as misalignment, not as a reveal.

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

**Only what the game pays for asks.** The same argument, one rung down: a mod that loads and plays
is not a press to interrupt, so a `flagged` mod is carried into the game without a word. What holds
a launch up is a `broken` mod, and a `repairable` one - a repair is one press, and it is worth
offering before the game starts whatever the finding was going to cost. The count in the ask is
what it is asking about, so a library of one of each says `1 broken mod`.

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

**The tone fades off the mark rather than boxing the header.** The wash and the rule under it are
a gradient out of the glyph that names the finding, so the header is amber where the wolf is and
plain surface by the time it reaches the close button. Boxed, it read as a banner stuck on top of
the panel - a second rim inside the panel's own, in a hue that then had to stop somewhere. Fading
gives it no edge to stop at. The rule is a background rather than a border, because a border cannot
be a gradient without giving up the radius the panel is cut with.

**The title says what was found, and the line under it says which errand.** "Detected issues with
mods" is the same in every state, because the reader's next question is not what happened but what
they are meant to do - and that has three answers, not one. All fixable is "**repairing is
recommended**", none fixable is "look for updated versions", and a mixed list names both. A panel
whose first row is a paragraph about itself has spent its best line on framing, so this is one
line and it is the ask.

**The sheet's inner edge is its handle.** That form's own border resizes it, the gesture the
editor's side panels already answer to. It stops before it has eaten the whole window, and the
width it is left at outlives the close - reopening gives back the panel the reader shaped.

**Neither form opens focused on its own chrome.** The sheet's first tab stop is that handle, the
dialog's is Close, and both are the least of what the panel does. Focus starts on the panel itself,
so the first impression is the list rather than the way out of it.

**Its counts come from the live verdicts, not from the sweep's report.** A repair refreshes each
mod's verdict as it goes, so both surfaces empty themselves as the press lands rather than
standing there naming mods that are already fixed.

## When a check runs

| Trigger                      | How                                                       |
| ---------------------------- | --------------------------------------------------------- |
| A game patch                 | The startup sweep, because every verdict's basis moved    |
| A manager release            | The same, because a release is how a table ships          |
| A hashtable sync             | The same, and the sync sweeps itself rather than waiting  |
| An install, single or bulk   | A background check per imported mod, off the install path |
| Check Health, in the menu    | On demand, answered by a toast either way                 |
| Check health, in the library | A press over the whole library or over the selection      |
| The badge's re-check         | On demand, from the popover                               |
| A repair                     | The repair records the post-repair verdict itself         |

The install's check runs on a detached thread and announces once at the end
(`mod-health-verdicts-updated`), so importing thirty mods costs the import nothing and the badges
arrive when the results do. The sweep runs on the startup thread the other three passes already
use, reports through a toast per mod, and announces the same event when it finishes.

The menu's answer exists because a clean check draws no badge: without one the click would look
ignored. A mod with nothing at all in it is told so in a line - "No problems found" - and a mod
whose findings are all informative gets [the panel](#the-status-bar-item-and-the-drawer), because a
count in a toast names those findings without showing them.

## Decided questions

| Question                                         | Answer                                                              |
| ------------------------------------------------ | ------------------------------------------------------------------- |
| Where do verdicts live?                          | `mod-health-verdicts.json`, a map beside the index                  |
| What makes a stored verdict stale?               | Its basis: the build, the manager, the hashtables, the meta schema  |
| Which of a brief's fields does the store keep?   | The counts and the type pairs. The rest is the running build's      |
| May a check run with no hashtables?              | No. The mod stays unchecked until they are there                    |
| Does a launch fetch hashtables before sweeping?  | Yes, and a failed fetch does not stop the sweep                     |
| Does the manager repair a mod on its own?        | No. Every run is a press, and it is the user's                      |
| What decides the hue a finding is drawn in?      | Its severity. The verdict decides the words beside it               |
| Does a warning with no repair read as broken?    | No. It is `flagged`, and it sends the reader nowhere                |
| Does every unhealthy library open the drawer?    | No. A library the game still loads announces itself as a toast      |
| Does the same library announce itself twice?     | No. The announcement is spent on the findings, not on the run       |
| Does a pressed check skip a current verdict?     | No. A press takes them again, which is what a press is for          |
| Does a selection withhold the panel?             | No. Every press that opens it is answered, whatever is picked       |
| Can the panel list a mod with nothing wrong?     | Yes, for the one press that asked about it. It leaves with it       |
| Can it list every such mod at once?              | Yes, behind the `Info` line the list ends in. That outlives a close |
| Does revealing them change what the panel says?  | No. The title, the hue and the repair read the faults alone         |
| Does a press that checked nothing still report?  | Yes. Somebody is waiting on it, and the run has pruned either way   |
| Does a `flagged` mod hold up a launch?           | No. Only a repair on offer or a mod the game refuses does           |
| Does the item draw when nothing was re-checked?  | Yes. It answers to the verdicts, not to the sweep                   |
| Where does the item sit?                         | A cell at the right of the status bar                               |
| Can a reader dismiss it?                         | No. It leaves when nothing is wrong any more                        |
| Does it move the library when it appears?        | No. It overlays, so no card shifts under a reader                   |
| Does one mod failing stop Repair all?            | No. It is recorded, and the rest are repaired                       |
| Does a check write anything to the mod?          | No. The archive stays byte for byte                                 |
| Can a repair reach a bin no hashtable names?     | Yes. It is addressed by its chunk hash throughout                   |
| What does a repair do with the original archive? | Replaces it, and keeps no copy - ADR-0005                           |
| Can a repair run for a build the user is not on? | No. Dormant rules' findings are cut from the run                    |
| Is a repaired mod repairable again next patch?   | Yes. The rules stay quiet about a repaired value                    |
| Does one broken mod stop a batch check?          | No. It is logged, skipped, and has no verdict                       |
| Does a repair disturb the mod's setup?           | No. Id, slug, profiles and layers all stay                          |
| Can the patcher run during a repair?             | No. A check yes - it only reads                                     |
| Does stopping a run put the repaired mods back?  | No. It stops the run. ADR-0006 is why                               |
| Does the cell draw outside the library?          | No. The drawer is the library's, so the cell is                     |
| Can the panel be dragged wider?                  | Only the sheet form. The dialog is centred                          |
| Is a mod's content part of what makes it stale?  | No. Only the manager writes it, and it re-checks                    |

## Open questions

1. What notices a basis that moves while the manager is open? A patch installed in the background
   and a League path changed in Settings both move it, and neither re-sweeps until the next
   launch. The path is the cheap half, since Settings already knows when it changed. The patch
   needs something watching `content-metadata.json`, and a sweep that starts while a user is
   halfway through installing mods is its own question.
2. Where do the other ambient items go? The bar now has a region for them and exactly one
   tenant. The game build, the overlay's age and the notification count are all candidates, and
   the order they sit in is a decision nobody has had to make yet.
