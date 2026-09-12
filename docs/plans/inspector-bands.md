# Inspector bands

The emitter inspector redrawn: a rich value on a band of its own, a rail for the birth roll, a
sticky group header in place of the tab strip, and the chance pin in the transport.

The design is "The inspector" in `docs/ux/BIN_EDITOR.md`. This plan is the route from the code as
it stands to that spec. Each stage stands on its own and leaves the pane usable.

## What is wrong today

The pane draws four competing readings of the same emitter. `RANDOM AT BIRTH` writes
`birthVelocity` as `2 channels` and the `BIRTH` group writes it again as three boxes plus a chip,
300 px apart. The value column holds a 130 px box, three narrow boxes, a 40 px sparkline with no
number and a full-bleed gradient, all starting at one x and ending at four. The tab strip and the
fold headers both mean "show me one group". A struct row reads its class where every other row
reads a value.

## The decisions

| #   | Question              | Decision                                                  |
| --- | --------------------- | --------------------------------------------------------- |
| 1   | Who owns the spread   | The rows. `RANDOM AT BIRTH` is deleted                    |
| 2   | The value column      | A rich value takes a band under its name                  |
| 3   | Tabs against folds    | The tabs go. The crumb's group menu inherits              |
| 4   | A struct row          | A caret and a class chip, and no value                    |
| 5   | A randomized vector   | Takes the band as well                                    |
| 6   | The shared roll       | A rail in a gutter of its own                             |
| 7   | The band's reach      | Every `FieldRow`, bleeding to the row's own indent        |
| 8   | Picking a group       | Scrolls to it. The body always draws every group          |
| 9   | The rail's continuity | Segments, broken at a row the roll does not reach         |
| 10  | The gutters           | The rail outside at the pane edge, the caret inside       |
| 11  | A nested band         | Starts at its own indent, ends at the pane's padding      |
| 12  | Position              | The sticky header moves and the crumb holds still         |
| 13  | The class chip        | Overflows, and the name column's arithmetic never sees it |
| 14  | The flicker warning   | The rail's segment, in the warning tone                   |
| 15  | The row's targets     | Name is the card, band is the dock, rail is the roll      |
| 16  | The chance pin        | Moves to the transport. The header reads the pinned value |

## The stages

### 1. The band

`FieldRow` in `src/modules/workshop/bin/ClassCells.tsx` grows a second line. A row is rich when its
value is a curve with keys, a colour ramp, or a vector whose axes carry ranges. The band is a
sibling of the name line inside the row's own hover container, so one fill, one `data-row-key` and
one menu cover both lines.

The band's left edge is the container's, which `NestedRows` has already indented by `pl-3` per
level, and its right edge is the scroller's padding. The name column keeps its `width` prop and the
band ignores it.

This lands in every layout that draws field rows at once: `GroupSection`, `ClassSections`
(`SectionBody`, `NamedFields`), `NestedRows` and `SkinSections` (`MeshCard`). Judge it on the skin
inspector before the VFX one, because the skin has no rail to confuse the reading.

`EmitterTable` is untouched. A table cell keeps the mark, per "A value family in a layout".

### 2. The class chip

Already true, and the decision describes what the code does rather than a change to it.
`StructValue` in `BinRow.tsx` draws a `ClassCard` and then a `ValueMarkCell` that is null until the
read lands, so a struct property row already carries its caret, its class outside the measured name
span, and no value. `nameColumn()` in `textCut.ts` never sees the class. Verify it and write no
diff.

### 3. The tabs go

Delete from `EmitterInspector.tsx`: `GroupTabs`, `GroupTab`, the `focus` filter over `all`,
`measureInView`, the `ResizeObserver` around it, and `groupInView` with its caller. `reportInView`
leaves `useEmitters` with them.

Keep the `IntersectionObserver` inside `GroupSection`. It gates curve reading, not tab
highlighting, and the read bound in "What a layout reads" rests on it.

`GroupSection`'s header becomes `sticky top-0` over an opaque surface rung, not a veil, or the rows
scroll through it. Reach for the token through the `design-system` skill.

`chooseGroup` stops filtering and only scrolls. `open.group` survives as the crumb's label and
`jumpRequest` as the way to aim the same group twice. `ShellCrumb` carries the group menu.

The jump has to clear the sticky header, so the section's `scroll-mt-1` becomes the header's own
height.

### 4. The roll rail

A new `rollRail.ts` answers, for one row and its mark, whether the rail reaches it: `roll` for a
field of the one birth roll (`drawnAtBirth` in `randomDraw.ts`), `flicker` for a table the engine
re-rolls every frame (`rerollsEveryFrame`), and null for every other row.

The two are separate marks rather than one tinted by the other, because `Color` and `scale0` are
the per-frame fields and neither of them is a birth field. A rail gated on the birth roll alone
could never carry the warning tone at all, so the rail says when a value is rolled rather than
which roll it belongs to. A field that is random under neither clock keeps its chip and takes no
segment.

The gutter is the scroller's own left padding, outside the fold carets and outside every indent. A
segment is a row's own absolutely placed bar inside that gutter, so a break needs no logic - a row
the rail does not reach draws none - and a segment covers a banded row's two lines because it is
placed on the row's container.

The gutter belongs to the particle inspector. `FieldRow` takes the segment as a `rail` prop, so a
layout with no roll passes none and pays nothing for it.

**Not built:** a click on a segment lighting its roll and focusing the chance slider. Stage 5 moves
that slider out of the inspector, so the gesture needs a cross-pane focus seam the shell does not
have. The segment is a labelled marker until that seam exists.

Delete `RandomSection`, `RandomFields`, `RandomRow` and `sectionShape`. `randomDraw`, `drawSummary`
and `drawnAtBirth` all survive, read per row instead of per section.

### 5. The chance pin

`ChancePin` moves out of the inspector into the timeline's transport row and the preview's mini
transport. `CurveToolbar` keeps its own slider, which the spec already gives it. The inspector's
header carries a read-only `Chance 0.55` chip while a pin holds and nothing otherwise.

## What this costs

```
src/modules/workshop/bin/
|-- EmitterInspector.tsx    -180 lines of 591, and no new section
|-- ClassCells.tsx          FieldRow grows the band. 8 callers
|-- BinRow.tsx              RowValue stops drawing a struct's class
|-- ChancePin.tsx           moves to the transport's row
|-- rollRail.ts             new
|-- __tests__/rollRail.test.ts   new
```

## The traps

**A folded group hides its share of the roll.** The deleted section read the birth fields whatever
was folded, so the roll was always on screen. A rail segment belongs to a row, so folding Birth
takes its segments with it. This is the spec, and it reads fewer curves than today rather than
more.

**The rail wants a gutter three things already share.** `FoldCaret` sits at `-ml-3 w-3` and
`NestedRows` indents by `pl-3`. The rail is a third column outside both, not a fourth use of
theirs.

**A sticky header needs an opaque background.** Every surface in this pane is a veil today.

**The flicker warning moved but did not multiply.** The random chip goes on reading
`random every frame` in every layout without a rail. Only the inspector hands that job to the rail,
which is why the sentence in "The row's two triggers" names the exception.

## Messages

Gone: `workshop_bin_inspector_all_label`, `workshop_bin_inspector_groups_label`,
`workshop_bin_inspector_random_title`, `workshop_bin_inspector_random_hint`.

New: an aria-label for a rail segment, naming the roll it belongs to.

`workshop_bin_random_chance_label` and the pin and unpin actions move with `ChancePin` and keep
their keys.

## Verifying

`pnpm check` is the gate, run whole and never piped. `ClassView.test.tsx` and
`ClassView.skin.test.tsx` cover the rows a band changes, and `emitterGroups.test.ts` and
`textCut.test.ts` both have to pass untouched - the grouping and the column arithmetic are what
this work is not allowed to move.

Judge stages 1 and 4 on screen. A band and a rail are geometry, and geometry passes tests it does
not deserve.
