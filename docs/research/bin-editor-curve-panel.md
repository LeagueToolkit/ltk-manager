# A curve is a column of keys, and its editor docks under the object tab

Research note, and the record of what it proposes. Sections 1 to 4 are evidence gathered on
2026-09-07 against this repository at `300f671` (`feat/bin-class-views`), the LTK meta API's
dataset of 2026-08-24, ritobin-lsp issue 55, and one screenshot of Riot's two particle editors
side by side. Section 5 is the proposals and section 6 what only the maintainer can answer.

The maintainer answered section 6 on 2026-09-07, over four rounds. What was decided is the body
of EPIC #455, and writing it into an ADR and into `docs/ux/BIN_EDITOR.md` is issue #456. Three of
the answers reach past what this note proposed: Probability ships as a third tab, the caption
carries the wire path under the label chain, and the time axis fits the curve's own span rather
than the 0 to 1 both editors plot.

The question was how the object tab grows a graph editor over the value family, `ValueFloat`,
`ValueVector2`, `ValueVector3` and `ValueColor`, and whether a React library carries any of it.
It follows `bin-editor-higher-order-views.md`, whose section 6.9 left "a curve widget over
`keyTimes` and `keyValues`" for later, and whose section 8 decided that the float family draws
its constant only.

Four findings decide the rest:

- **A key is a column.** `times` is one list and `values` one list of vectors, so key `i` is
  one time and one value per channel. A horizontal drag moves every channel's key, and a
  vertical drag moves one channel's component. Each channel has a probability table of its
  own, and the list is fixed at the channel count.
- **Riot draws the dynamics' own values, not their product with the constant.** In the
  screenshot Initial Scale holds `100.000` on X and the graph's X curve runs from 1 to 0. The
  wiki documents none of the value classes, so what the game does with constant and curve is
  written nowhere this note can cite, and the graph does not need to know.
- **Both generations of Riot's editor dock the graph under the property view, with tabs.**
  Syrup's tabs are Curve Editor, Probability Editor and Graph Editor. RiotEditor's are Graph
  Editor and Table Editor. Neither uses a popover.
- **No package on npm is a keyframe curve editor.** The one candidate, visx, is SVG primitives
  over d3 that restyle to the design tokens anyway. The graph is a few hundred lines of SVG,
  and the chrome around it is components the repository already ships.

## Sources

- One screenshot, 2000 by 632, of Syrup on the left and RiotEditor on the right, both open on
  `Lux_Base_R_mis_beam`, supplied in the session that wrote this note
- [ritobin-lsp issue 55](https://github.com/alanpq/ritobin-lsp/issues/55), items 3 to 5, the
  gradient webview and the curve editor per channel
- `rito-meta` (`@leaguetoolkit/meta-cli` 1) against `meta-api.leaguetoolkit.dev`, dataset
  generation 2026-08-24, `class` and `docs` for every class section 2 names
- `docs/ux/BIN_EDITOR.md`, "A value family on its row", "A cell is a row", "What an edit is"
  and "Undo"
- `docs/research/bin-editor-higher-order-views.md`, sections 3, 6.7, 6.9 and 8
- `src/modules/workshop/bin/valueRows.ts`, `useValueMarks.ts`, `ColorMark.tsx`, `BinRow.tsx`,
  `VfxSections.tsx` and `ClassCells.tsx`
- `src/modules/editor/components/SidePanel.tsx` and `src/components/`
- `package.json`, `pnpm-lock.yaml`, and `npm view` on 2026-09-07 for every package section 4
  names

## 1. What the screenshot shows

Two editors on one particle system, each with a graph docked under its property view.

### 1.1 Syrup

The older editor. A Property Editor on the right lists `beam: Scale`, with `Initial Scale` as
`X: 100.0  Y: 1.0  Z: 1.0` and `Particle Scale` as `X: 1.0  Y: 1.0  Z: 1.0`, each component
followed by two small buttons. Under the whole window sits a Curve Editor panel with three
tabs, `Curve Editor`, `Probability Editor` and `Graph Editor`, the third open. Its caption reads
`beam: Scale: Initial Scale`. A row of fields reads `Time: [ ]  Value: [ ]  Time Snap: [0.050]
Value Snap: [0.025]`. The plot has `Value` on the vertical axis at `1.000`, `0.0` and `-1.000`,
`Time` on the horizontal at `0.000`, `0.25`, `0.5`, `0.75` and `1.000`, and a legend of `X`,
`Y` and `Z` in red, green and blue. Lock icons sit at the ends of the value axis and at the
time origin, and what they lock the screenshot does not say. Keys are diamonds. The X curve
holds at 1 to about `0.1` and drops to 0, and Y and Z hold at 1.

### 1.2 RiotEditor

Particle Editor Properties on the right, under the breadcrumb `Lux_Base_R_mis_beam > beam >
Scale`. Its rows are `Is Uniform Scale` as a checkbox, `Initial Scale` as `X 100.000  Y 1.000
Z 1.000` in spin fields followed by three small icons, `Particle Scale` as `1.000 1.000 1.000`,
`Flex Scale 0.000`, `Scale by Radius 0.000`, `Flex Initial Scale None`, `Flex Scale Emit Offset
None` and `Scale Birth Scale By Bound Object 0.000`. Under the emitter cards sits a Graph Editor
panel captioned `complexEmitterDefinitionData[2].birthScale0`, with a legend of `X`, `Y` and `Z`
swatches, `+` and `-` buttons, both axes from 0 to `1.00`, and tabs `Graph Editor` and `Table
Editor`. A Particle System Preview viewport sits beside it.

What the two say about the editor:

1. **The graph is keyed on a path.** RiotEditor's caption is the wire path,
   `complexEmitterDefinitionData[2].birthScale0`, the form ADR-0027 addresses a node by.
   Syrup's is the label chain, `beam: Scale: Initial Scale`.
2. **The property row keeps the constant and an affordance.** The graph lives in its own
   panel, in both.
3. **Time runs 0 to 1.** Both plots, and the domain issue 55's lint names.
4. **Segments are linear.** The drop from 1 to 0 is a straight edge in both.
5. **A table is the graph's sibling.** RiotEditor's Table Editor tab.
6. **Snap is a pair of fields.** Syrup's Time Snap and Value Snap.

## 2. The shape of a value

Every class below is the meta API's answer at dataset 2026-08-24. `docs` answers
`not-documented` for each of them, so the wiki has no prose on what the game does with any
field here.

| Class                             | Hash         | Fields                                                                                                                                         |
| --------------------------------- | ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `ValueFloat`                      | `0x04300058` | `constantValue: F32` `0xb4b427aa`, `dynamics: Pointer<VfxFloatBase>` `0xbc037de7`                                                              |
| `ValueVector2`                    | `0x69dc3449` | `constantValue: Vec2`, `dynamics: Pointer<VfxVector2fBase>`                                                                                    |
| `ValueVector3`                    | `0x68dc32b6` | `constantValue: Vec3`, `dynamics: Pointer<VfxVector3fBase>`                                                                                    |
| `ValueColor`                      | `0x074f91dd` | `constantValue: Vec4`, `dynamics: Pointer<VfxColorBase>`                                                                                       |
| `VfxAnimatedFloatVariableData`    | `0xfe064c88` | `times: List<F32>` `0x5d68eeb5`, `values: List<F32>` `0x34474c3b`, `probabilityTables: List<Pointer<VfxProbabilityTableData>>[1]` `0xa7084719` |
| `VfxAnimatedVector2fVariableData` | `0x2e0ea245` | the same, `values: List<Vec2>`, `probabilityTables` fixed at 2                                                                                 |
| `VfxAnimatedVector3fVariableData` | `0xacd81180` | the same, `values: List<Vec3>`, `probabilityTables` fixed at 3                                                                                 |
| `VfxAnimatedColorVariableData`    | `0x4349c5f5` | the same, `values: List<Vec4>`, `probabilityTables` fixed at 4                                                                                 |
| `VfxProbabilityTableData`         | `0x53a6c97e` | `keyTimes: List<F32>` `0x40c351da`, `keyValues: List<F32>` `0xe44b7382`, `singleValue: F32` `0xad345dd6`                                       |

The four `Value*` classes share their two field hashes, and the four `VfxAnimated*` classes
share their three. One widget over `(times, values[channel])` therefore reads every family, and
the channel count is the vector's width.

What the shape decides:

- **A key is a column.** Moving key `i` in time is one write to `times[i]`. Moving one channel
  is one write to `values[i]`, a vector. Adding or removing a key is a write to both lists at
  one index, and a file where only one landed is the length mismatch issue 55 lints.
- **The probability editor is the same widget again.** `probabilityTables[channel]` holds a
  `keyTimes` and `keyValues` pair, the shape of `times` and `values` with one channel. What the
  game samples from it is not documented. `singleValue` is a third field a table may carry
  instead of a curve.
- **A colour is four channels of the same thing.** The gradient strip the row draws today is
  the colour's curve rendered as a band rather than as lines.

## 3. What the repository has

- **A three-level read of every value row in view.** `constantRequests`, `dynamicsRequests`
  and `stopRequests` in `src/modules/workshop/bin/valueRows.ts`, driven by `useValueMarks` on
  scroll settle. Level one answers the row's `constantValue` and `dynamics`, and the `dynamics`
  row carries its `len`, so whether a curve exists is known for every family at level one.
  Levels two and three continue for a colour only, and the filter is one line.
- **`ValueMark` is `family`, `constant` and `stops`**, and `ValueMarkCell` in `BinRow.tsx`
  draws a swatch and strip, a `Readout`, or `Components` by the constant's kind. `ColorMark`'s
  strip opens a hover card of every stop as time and hex, which is a read-only Table Editor for
  a colour already.
- **A cell is a row.** `Cell` in `ClassCells.tsx` tags `data-row-key`, and the one menu of a
  view aims at it. Every cell is a path and a value, per "A cell is a row" in
  `docs/ux/BIN_EDITOR.md`, so a widget that edits a curve edits through the patch a row would
  send.
- **A dock exists.** `SidePanel` in `src/modules/editor/components/SidePanel.tsx` is a stack of
  collapsible sections sized by the boundary between them, over Base UI's accordion.
- **The chrome exists.** `src/components/` ships `Tabs`, `SegmentedControl`, `TogglePill`,
  `NumberField`, `Readout`, `Slider`, `Popover`, `Table` and `DataTable`.
- **No plotting dependency.** `package.json` carries `framer-motion`, `react-resizable-panels`,
  `react-zoom-pan-pinch`, `@dnd-kit` and `@tanstack/react-table`, and the lockfile holds no
  `d3-*`, `@visx/*`, `@use-gesture/*` or `react-colorful`, directly or transitively.
  `AccentColorPicker` under settings is a preset picker, not a colour picker.
- **Editing is Proposed.** "What an edit is" lists seven operations and no batch, and "Undo" is
  an inverse-patch stack per document. Nothing sets a null pointer to a class.

## 4. Libraries

Checked with `npm view` on 2026-09-07.

| Package                                         | Version, modified | Verdict                                                                                                                                 |
| ----------------------------------------------- | ----------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `react-bezier-curve-editor`                     | 2.1.0, 2024-04    | One easing bezier with two control points. Not a key track                                                                              |
| `chartjs-plugin-dragdata`                       | 2.3.1, 2026-02    | Drags points on a Chart.js canvas. Imperative theming, and it fights column keys and a per-channel drag                                 |
| Recharts, nivo                                  |                   | Read-only charts, no key editing                                                                                                        |
| theatre.js                                      |                   | A whole animation application, not an embeddable component                                                                              |
| `@visx/scale`, `shape`, `axis`, `drag`, `event` | 4.0.0, 2026-06    | Airbnb's React SVG primitives over d3, one package each. The only real candidate, and every axis and tick restyles to the tokens anyway |
| `d3-scale`                                      | 4.0.2, 2023-04    | Pulls `d3-format`, `d3-interpolate`, `d3-time` and `d3-time-format` for one linear scale                                                |
| `d3-array`                                      |                   | `ticks(0, 1, 5)` alone, a few kilobytes. The one import worth its weight                                                                |
| `@use-gesture/react`                            | 10.3.1, 2024-03   | A drag hook. Pointer events with `setPointerCapture` are thirty lines and need no hook                                                  |
| `react-colorful`                                | 5.8.1, 2026-09    | Hex and alpha picker, about three kilobytes gzipped. The colour stop's picker, when editing lands                                       |

`framer-motion` is already present and has drag, but its drag moves a transform and not a
datum, so a key that snaps to a time and a value is the wrong element for it.

## 5. Proposals

### 5.1 A glyph on the row

Section 8 of the earlier note decided that the float family draws its constant only, and this
keeps that for the value. After the constant, a row of any family draws one small curve glyph
when `dynamics` is non-null, and nothing when it is null. Level one already answers that, so the
glyph costs no call. A click on the glyph targets the panel, and on a colour a click on the
strip does the same while hover keeps the card. The row menu and the cell menu gain Show curve,
aimed at `data-row-key` the way Show in properties is.

A sparkline in place of the glyph is deferred. It costs levels two and three for every visible
float and vector row, and the panel is the thumbnail.

### 5.2 The dock

A `SidePanel` under the object tab, with one section, Curve. Collapsed until a row targets it,
open from then on, and its height holds for the life of the tab the way the mode does. It sits
under both modes, the layout and Properties, because the value-family rule is keyed on class
and field and holds in the tree too. It is the object tab's. Show curve on a file tab's row
opens the object tab with the panel targeted, the way Show in properties switches the mode.

The panel holds one target, a path per ADR-0027, and draws the label chain as its caption,
`beam . birthScale0`, as Syrup does. Copy path on the menu carries the wire form.

```
+-------------------------------------------------------------------------------+
| ~ beam . birthScale0                 [X][Y][Z]   Graph | Probability | Table   |
|  1.00 +-\----------------------------------------------------------------+     |
|       |  \                                                                |     |
|  0.50 |   \                                                               |     |
|       |    \                                                              |     |
|  0.00 +-----+=====================================================+-------+     |
|       0.00        0.25          0.50          0.75          1.00                |
|  key 2 of 3   t 0.100   x 0.000   y 1.000   z 1.000         [+ key] [- key]    |
+-------------------------------------------------------------------------------+
```

A popover is the wrong container. A modder drags a curve while reading the emitter's `rate`
and `lifetime` beside it, and a popover closes on the first click into a cell. Both of Riot's
editors dock.

### 5.3 Three tabs

Syrup's three, on the target's own lists:

- **Graph** is `times` against `values[channel]`, one polyline per channel, linear segments,
  keys as diamonds. Time is fixed at 0 to 1 and value fits the keys with a margin. Channel chips
  in the header toggle a channel's line and pick the channel a vertical drag moves. The
  selected key's time and components read out under the plot.
- **Probability** is `keyTimes` against `keyValues` of `probabilityTables[channel]`, the same
  plot with one line, and `singleValue` as a field where `keyTimes` is empty. What the game
  samples from it is undocumented, and the tab draws the lists and says nothing more.
- **Table** is one row per key and one column per channel, the strip's card grown to every
  family, and the precise and the accessible path to every number.

A colour draws its gradient band over the time axis in Graph and a swatch column in Table, so
issue 55's gradient webview is this panel, and its stop list is the strip's card.

### 5.4 The read

The panel reads its target through the three levels `valueRows.ts` runs, with the colour filter
on levels two and three removed. `ValueMark` grows `keys`, each a time and a vector, and a
colour derives its `stops` from them. A target change costs two calls, because level one is in
the marks already whenever the row is in view.

### 5.5 Editing

Every gesture ends in patches, per "A cell is a row", and the panel holds no state of its own
past the drag in progress. A drag is local state committed on pointer up as one undo step, the
way a text field commits on blur. Moving a key is Set value on `dynamics.times[i]` and on
`dynamics.values[i]`. Adding a key at time `t` is Add element on both lists at one index, with
the value interpolated between its neighbours, and removing one is Remove element on both.

Two gaps in "What an edit is":

- **No batch.** The two writes of an add or a remove have to land together or the file holds
  the mismatch. A batch operation, a list of operations validated as one and undone as one, is
  the smaller change. A Set curve operation carrying both lists is the other.
- **No set of a pointer to a class.** Add curve on a row whose `dynamics` is null needs one,
  and the same operation is what every null `pointer` in the tree needs once editing lands.

Snap is Syrup's pair of fields, off by default, and later. The read-only panel ships first,
because editing is Proposed and every row is read-only today.

### 5.6 The render

Inline SVG with a `viewBox`, no plotting library. A linear scale is
`(v - d0) / (d1 - d0) * range` and its inverse. The line is `M x y L x y`. A key is a `<rect>`
rotated by 45 degrees, focusable. Drag is pointer events with `setPointerCapture` on the key,
inverted through the scale, with the arrow keys nudging a focused key and Delete removing it.
Ticks come from `d3-array`'s `ticks` if anything is imported at all.

The chrome is the repository's: `Tabs` for the three tabs, `TogglePill` for the channel chips,
`Readout` for the key readouts and `NumberField` for them once editing lands, and `SidePanel`
for the dock. Channel colours are one new token set, decided in the `design-system` skill.
Riot's are red, green and blue for X, Y and Z.

### 5.7 Order

1. The glyph and Show curve, on level one alone
2. The panel read-only, with Graph and Table, in the dock
3. Probability
4. Editing, after leaf editing lands, with the batch operation and the snap fields
5. Issue 55's lints as Problems rules

What it changes in `docs/ux/BIN_EDITOR.md`: "A value family on its row" gains the glyph, a
section "The curve panel" under "The object tab" holds 5.2 to 5.4, and "What an edit is" gains
the batch and the set of a pointer.

## 6. Questions, and what was decided

Answered over four rounds on 2026-09-07 and recorded as ADR-0032 and "The curve panel" in
`docs/ux/BIN_EDITOR.md`.

1. **Glyph or sparkline.** _Both, by surface._ The emitter panel's own rows draw a sparkline,
   because one group is eight-odd rows and two more levels over eight rows is bounded. Every
   other surface keeps the glyph. The same rule over the emitter table's four value columns is
   240 curves on one screen, and the generic tree scrolls a thousand rows.
2. **Batch or Set curve.** _A batch._ An add is two writes on a pair of lists, which is the shape
   of any paired-list edit rather than of this one. It waits on editing, which is Proposed.
3. **The caption.** _Both, on two lines._ The label chain is what the reader clicked. The wire
   path under it is what a bug report needs.
4. **The file tab.** _The object tab, and there is one dock in the app._ A mark on a file tab's
   row opens the object tab with the dock already targeted, the way Show in properties switches
   the mode.
5. **`d3-array` or nothing.** _Nothing._ The time axis fits the curve's own first and last key,
   which is a min, a max and a division. No plotting dependency is added.
6. **Probability.** _Draw it, and claim nothing._ The tab plots `probabilityTables` for the
   channel the graph's chips chose, and draws `singleValue` in place of a plot where a table
   holds no keys. What the game samples from one stays undocumented.
7. **Channel colours.** _Riot's red, green and blue,_ in the graph. A sparkline is too small to
   tell three lines apart, so its channels share one colour.
8. **Add curve on null.** _Draw nothing._ A value whose `dynamics` is null draws no mark and its
   row menu offers no curve, because setting a null pointer to a class is a write nothing in the
   editor makes yet.
