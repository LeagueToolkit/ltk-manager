# ADR-0023: A setting id and a UI path are two id spaces

- **Status:** Proposed
- **Date:** 2026-09-03
- **Crates:** none (`src/modules/settings/`, and `parse_settings` in `crates/ltk-manager-core/src/deep_link.rs`)
- **Related:** ADR-0016, ADR-0017, ADR-0019, ADR-0024

## Context and problem statement

`?focus=` addresses a row or a group today. Both ids are two segments, a tab namespace and a name -
`general.launchMode`, `patching.mod-safety` - and the namespace exists to settle which tab holds the
target before the panel holding it has mounted.

The settings page wants a link at every level a reader can see: a tab, a card, a group, a row.
`docs/ux/SETTINGS.md` closed that question the other way on 2026-08-25 - _`focus` addresses a group
or a row, and never a card_ - because a card target buys "a third kind of thing an id can name".

The objection is about kinds, so the tempting answer is to remove the kinds by making the id a path
and letting depth carry what the kinds carried. That answer fails on the requirement underneath the
feature: **a setting has to stay reachable when the page around it is rebuilt, and a link minted
before the rebuild has to keep pointing at it.** A path through the page makes the public id a
function of the most volatile thing on the page. The groups migration of 2026-08-25 moved most rows
on four tabs into bands that had not existed the week before, and it moved no ids at all. Under a
path-through-the-page it would have invalidated every link in existence to say nothing new.

So one id space cannot serve both. A setting is a domain fact and it does not move. A card is a
place on a page and it does.

## Decision drivers

- A setting id is a public promise, minted into links, bug reports and wiki pages.
- The page's grouping is the part that churns, and it must stay free to churn.
- One search param, because the route has one rule.
- The palette lists every addressable thing without mounting the page, so ids are known statically.
- A link to a place that no longer exists should land as near as it can.

## Considered options

1. **Two spaces.** A setting id names a domain. A UI path names a position on the page. Different
   separators, different stability promises, one param that dispatches on the separator.
2. **One space, a path through a taxonomy.** Every node - tab, card, group, row - is a path in one
   declared tree, and the page renders that tree without being it.
3. **One space, flat.** Today's `tab.name` for every level, told apart by which table answers.

## Decision

**Settings carry two id spaces, and a value's separator says which one it is in.**

|                         | Setting id                            | UI path                                     |
| ----------------------- | ------------------------------------- | ------------------------------------------- |
| Shape                   | `launch.mode`, dot-separated          | `general/league/launching`, slash-separated |
| Names                   | a domain                              | a position on the page                      |
| Stability               | stable, retired with a record         | free to move with the page                  |
| Retired spellings       | a retired-id table, ADR-0024          | not kept                                    |
| A link that outlives it | lands on the replacement, and says so | truncates outward, down to the tab          |
| Nesting                 | none, and depth is domain depth alone | immediate-parent, and checked               |

- A setting id's first segment is a **domain**, not a tab. Five of the eight tabs are domain names
  and two hold no setting, so the change lands on the nine settings filed under `general`, which is
  a bucket rather than a domain. Six more ids lose a suffix that repeats or over-describes its
  domain - `workshop.workshopPath` to `workshop.path` - because this is the last moment before they
  freeze. The tab a setting draws on is a column of the index rather than the id's first segment,
  and an id nothing knows opens the default tab.
- A UI path is contiguous: every tab, card and group a reader sees is a node, with no judgement
  about which ones deserve one. `general/league/launching` requires `general/league`, which requires
  `general`, and each renders inside the one before it. A card titled as its tab shares the tab's
  node, so `patching` is the tab and its Patching card. A path is declared rather than derived from
  its title, so a retitle does not move it.
- Both spaces are declared in one index, which is what makes an id statically known and a link
  minted in-app a compile error when it is wrong.
- Both are message keys under ADR-0019, under prefixes that name the kind: `setting.<id>.<role>`
  and `settingsUi.<path>.<role>`. Paraglide preserves `/` verbatim in the exported key, so the id
  pasted out of a link finds its catalog line.

## Consequences

- **Positive:** the card question closes itself. A card is addressable because it is a place, and
  the promise attached to its path is the honest one - it lasts as long as the place does.
- **Positive:** regrouping the page stays free, and costs no retired id. The rows in a card that moved
  never named the card.
- **Positive:** truncation means something, because a UI path is a real position. A link to a band
  that has since been split opens the card, then the tab.
- **Negative:** two shapes for one param. A reader holding `general/league` and a reader holding
  `launch.mode` have to understand that these are different kinds of promise, and only the
  separator says so.
- **Negative:** a UI link is allowed to rot. Somebody will paste one into a wiki page and find it
  landing a level out a year later, and that is the design working rather than failing.
- **Negative:** five cards share their tab's node, so `Copy ID` on the Library card copies
  `library`, and a stale link to one of its groups lands on the tab with nothing marked.
- **Negative:** the domain names are invented once, and a wrong one costs a retired row for as
  long as anyone holds the old link. `league.path` and `tray.startUnlessUpdate` are judgement calls
  that outlive the people who made them.
- **Revisit when:** a setting has to move between domains. It is renamed and leaves a retired id,
  and if that happens often the domain layer is wrong rather than the mechanism.

## Pros and cons of the options

### Option 1: two spaces (chosen)

- Good: each half makes the promise it can keep. VS Code reaches the same split - setting ids are
  config-schema paths, and `settingsLayout.ts` declares the editor's tree with its own ids under a
  `/` separator.
- Bad: two shapes in one param, and a reader has to learn which is which.

### Option 2: one space, a path through a taxonomy

- Good: one shape, one rule, and depth available at every level.
- Bad: the taxonomy is an assertion about meaning that nothing mechanical can check, so the path
  can lie. Worse, containment either binds the path to the layout - the thing this decision exists
  to prevent - or it does not hold, in which case truncation walks a reader sideways.

### Option 3: one space, flat

- Good: it is what the code does today.
- Bad: the shape the closed question rejected. Three kinds in one space told apart by which table
  answers, and no ancestor to fall back to.
