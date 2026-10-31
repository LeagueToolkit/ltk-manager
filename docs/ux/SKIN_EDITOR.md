# Skin editor

The skin editor is the shell a `SkinCharacterDataProperties` object draws in: the posed
character, and the panes a skin is read and edited through. It is one class view of the bin
editor, and this document covers what is the skin's own.

What a class view is, how a layout declares a shell, how a shell's panes are arranged, the
sandbox and what an edit is are in docs/ux/BIN_EDITOR.md, under "Class views", "The shell",
"How the panes are arranged" and "Editing". A section named in quotes here with no document
is a section of that one. The clip table's plan is docs/plans/animation-graph-table.md, and
the plan of the pose modifiers and sockets is docs/plans/pose-dynamics-preview.md.

## Changes

| Date       | Change                                                                   |
| ---------- | ------------------------------------------------------------------------ |
| 2026-10-31 | Name clips and events from game data, file names and `mName`             |
| 2026-10-31 | Correct clip, condition, material and socket behaviour                   |
| 2026-10-31 | Add the skin and animation graph menu bars                               |
| 2026-10-28 | Draw a skin's character inking in the preview                            |
| 2026-10-22 | Add the Conditions section, and apply a condition in the preview         |
| 2026-10-15 | Add, rebone and remove idle effects in the VFX section                   |
| 2026-10-04 | Add the Skeleton and Physics panes, and simulate a skin's pose modifiers |
| 2026-10-04 | Split out of docs/ux/BIN_EDITOR.md, with the skin's preview              |

Each edit of this document adds a row at the top. The table keeps the last ten rows.

## The shell

The skin declares a shell, per ADR-0036, of two panes: the preview, first and the wider, and
the inspector holding every section. The posed character is what a reader of a skin is looking
at, and a square beside the mesh fields made it the smallest thing on screen.

The other panes start beside those two. Clips and Spells share a tab strip under the preview.
Material and Skeleton share one above the inspector, and Physics is a tab behind the
inspector. The arrangement is the skin shell's own, so moving its panes leaves another
shell's where they were.

A Clips, Material, Skeleton or Physics pane that a saved arrangement does not hold comes back
when the arrangement is read again, whether the reader closed the pane or the arrangement was
saved before the pane existed. Clips lands over the inspector, Material and Physics as tabs
behind the inspector, and Skeleton as a tab behind Material.

The shell writes the object's path on the header row beside its class, because the class only
says what kind of object the tab holds and a skin tab is opened to read one skin.

## The preview

The preview draws the skin on its skeleton, posed by a clip of its animation graph and wearing
its idle effects, per ADR-0035. An effect that draws the character draws over the skin, and a
child set naming bones spawns on the joints it names. The transport under it plays, pauses and
scrubs the clip, sets its speed and names it: an idle clip first, and the bind pose where the
graph holds none. A graph the skin's own file does not declare is read out of the files it
links, which is where the engine finds it. The camera frames the character when it lands, and
again on Frame the character. A clip no table or game data declaration names takes the part of its
`.anm` file name that hashes to its key, and an event takes its `mName` the same way. A clip that
none of these names reads as its bare hash, dimmed, which is what a modder pastes elsewhere.

**The transport is one row.** It holds play, restart, the scrub, the time and the speed, and
after them what plays, which is the clip picker and a parametric clip's slider. The picker is
as wide as the clip's name, up to a cap, and draws without a box. The scrub takes what the
rest leaves and keeps a least length. Only under a pane too narrow to hold both do the clip's
controls drop to a second row.

**The scrub follows the clock every frame.** It is a rail filled up to the playhead, which is a
line over it, and the time beside it reads the same frame. A press on the rail seeks there. A
drag holds the clock, and a playing clip plays on from where the drag lets go. A drag stops just
short of the clip's end, which is the start of its next pass.

**The backdrop menu stands the skin on a map.** It lists None and the install's maps by folder,
and four switches under them: Particles, Event effects, Structures and props, and Sky. Particles
plays the map's placed systems. Event effects adds the systems an event shows, such as the Hall
of Legends banners, and stays off until Particles is on. Every switch but Event effects starts
on, and each is kept with the preview's other display settings.

**The preview draws a skin's character inking.** Each submesh that an
`OutlineCategorySubmeshes` entry names gets an outline, drawn with the entry's
`materialOverride`, else its category's `Material`. The game draws the outline only in a mode
whose `ConfigsClient` lists an object of class `0xb9ce95d8`, such as Map453's. The preview has no
mode, and almost every shipped skin that names a category is built for a mode that draws it, so the
preview draws the outline by default whenever the skin names one, and View - Character outline turns
it off. The category and its material are declared
in a map bin, which the skin does not link, so the read finds them through the object index, or in
the target of the project's module that creates them. With game shaders on, the outline draws with
`Jade_CharacterOutline` translated. Otherwise a stock material draws the same shell from the
material's width, colour, mask, camera distance and depth offset. The outline draws in the Lit view
alone. The death fade of the material's `dynamicMaterial` is not drawn.

**The inspector and the character point at each other.** The pointer on a material override
dims every submesh but the one it dresses, and a click on the character dims the same way and
scrolls that submesh's override into view, marked while it holds. The pointer leaving an override
returns to the clicked submesh. A click that misses the character lets go. The ray is cast on the click alone, because casting it on every move of the
pointer would skin the whole mesh each time.

**The viewport follows the pane the reader uses.** Clips and Inspector restore the character
preview. Spells restores the selected ability preview, including its playback position. Closing
Spells or leaving its selected ability restores the character preview. A separately placed
Inspector takes ownership when its tab or content receives focus.

**The preview takes the viewer's keys**, the camera menu with Fit, the axis gizmo and the speed
detents, per "The viewer". Its clip plays on its own clock under its own transport, and it has
no timeline. The keys answer while focus is anywhere in the preview or its transport.

## Menu bar

A skin and an `AnimationGraphData` each draw the menu bar of "Menu bar" in docs/ux/BIN_EDITOR.md.
The bar mirrors the rail, the transport, the toolbars and the context menus, which all stay. An
item shows the key that the preview answers, because the key handler and the menu read one table.

| Menu      | Items of a skin                                                                                                                                                      |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| File      | Bake tangents, for a skin in a project layer                                                                                                                         |
| View      | View mode, Camera, Frame the character. Map backdrop, Visibility, Sun, Post effects. Move, Stage, Midlane. Armature, Joint names, Shaders, Sound, Submeshes. Hide UI |
| Animation | Play or pause, Restart. The frame steps and the six-frame steps, Focus playhead. Slower, Faster, Playback speed. Clip, Parameter                                     |
| Skin      | Effects, Open effect. Add effect, Remove effect. Add condition, Remove condition, Apply in the preview                                                               |
| Physics   | The overlay and its parts, the simulated frame rate. Add pose modifier, Add socket, Selected joint. Previous, Next, Simulate in the preview, Remove                  |
| Spells    | Focus spell filter, Preview spell, Back to the spell list. Create, Open, Preview, Save and Remove ability. Cast, Replay, Speed, Range guides                         |

An `AnimationGraphData` adds one Clip menu: Focus clip filter and the map of the pane, Sort clips
by, Open animation, Open animation to the side, and Weigh mask. Its view has no viewport or
transport, so a click on a clip row selects the row that Open animation acts on and poses nothing.

A command that does not apply stays listed and disabled, with its reason under its words where the
menu item shows one:

- In Properties, each command of the layout reads "Applies in the Skin view".
- If a pane is closed, a command of that pane names the pane to open. In the narrow stack, a
  command of a pane that only the shell draws reads that the tab must be wider.
- If the document takes no edit, each edit names the reason of the document.
- A command that waits for a pick names the pick, such as "Select a joint".

Hide UI hides the preview's controls and leaves the keys in force, so Esc is listed under Gestures.
Sun, Post effects and Visibility open the popup of the rail's control, so they apply while the
rail shows them. Add effect focuses the picker of the VFX section, and Remove effect lists the idle
effects. The effects of a condition are edited in its row. Cast, Replay, Speed and Range guides
apply while the preview pane shows the ability, per "The viewport follows the pane the reader
uses".

## The spells pane

The Spells pane of the skin shell lists named `SpellObject` declarations below the character's
`Characters/{name}/Spells` path in the installed game. New layouts place it beside Clips. Saved
layouts can open it from the Panes menu.

A filter narrows the current character's spell names. Nested paths share a heading for their
first segment below `Spells`, while flat paths appear under Ungrouped. Rows show the spell's
leaf name without repeating its group. The pane does not show install-wide unknown-name counts,
declaration counts or containing files.

The pane checks preview support before enabling a row. A click on a supported spell opens its
preview directly in the selected skin's context. Unsupported spells, unreadable data and
conflicting declarations remain disabled. No row expands or navigates to a bin file. Discovery
retains all declarations internally, but the preview does not choose between conflicting ones.

A spell opens an editable visual recipe beside the main character preview. Its written
`mAnimationName` selects the animation through the skin's graph, including wrappers with one
child. An unresolved name or a graph with multiple branches requires an explicit animation
choice. A spell without an animation can preview effects on the character's bind pose.
Animation-only spells are supported, including Galio Q.

Spell previews suggest release time from written `spellCastTime` or `mCastTime`. Matching values
need no choice. Conflicting values require a selection or an edited release time. Missile delay
starts after release. Hit effects use the selected skin's resolver, with exact names as a fallback
for missing keys. An explicit false `bHaveHitEffect` disables the automatic impact selection.

Target distance uses rank one of the display range, then `castRangeValues.values`, then
`castRange`. Missing or unusable distances retain the editor's 500-unit default. Range guides
are optional, editable ground outlines for cast range, primary and secondary target radii, and
a cone aimed at the target. The cone control uses its full opening angle in degrees. These are
visual approximations, with no collision or server targeting behavior.

**Create ability** starts an authored recipe. Its controls select an animation, cast bone,
cast effect, optional projectile, release time, flight duration, impact effect, emission duration
and target position. Resolver keys select effects for the current skin. An ambiguous key is
not selected automatically. **Preview sequence** applies the draft to the main viewport.
**Save recipe** stores it in the project's `.ltk/editor.json`. Saved recipes appear only for
the current character and can be reopened or removed.

The cast effect follows its bone and stops emitting at release. The projectile starts at the
bone's position after the missile delay and travels to the target. Impact starts at arrival,
or at release when there is no projectile. Each action owns its emission stop. The animation
holds its final pose while particle tails finish. Animation graph particle events and idle
effects are not added automatically, so recipe actions do not duplicate them.

The preview shares one clock for animation and effects. Play, pause, replay, quarter speed and
scrubbing sample the same seeded fixed-step simulation. Character and effect assets must finish
loading before playback starts. A preparation scan measures the first step after the last action
with no particles or child effects left and uses it as the timeline endpoint. A changed recipe
cancels the scan and starts a fresh run. A 60-second limit bounds persistent effects.

Recipes describe visual staging. Server scripts, collision, damage, branching, automatic
multi-spell ordering and non-linear missile trajectories remain outside this player. Written
fixed-speed or fixed-time movement can seed the initial flight duration. The recipe's timing
and target remain editable. Project asset override resolution is a later stage of
`docs/plans/ability-preview.md`.

The standalone missile player remains available to callers without a character scene. It
supports fixed-speed and fixed-time flights with manual anchors and the same measured endpoint.

## The clips pane

The Clips pane of the skin shell lists the skin's animation graph, and the Clips section of a
stack lists the same under the hero. Riot's own Character Animation Graph Editor draws the graph
as a clip table with tabs for the maps the clips key into, section 2 of
docs/research/bin-editor-higher-order-views.md, and the pane draws the same over the read the
preview already makes. The plan is docs/plans/animation-graph-table.md.

The graph is read typed, through one command over all four of its maps, and the pane draws out
of that answer rather than out of the rows. A graph the skin's own file does not declare is read
out of the files it links, as the preview reads it, and the file it was found in is what the
inspector reads a clip's rows from.

**A row per entry of `mClipDataMap`, whatever its kind.** The rows sort by name, the ones no
table names after them, and a filter below the pane's tab strip narrows them by name or hash. The
columns are Name with the kind of clip as a chip after it, File, Track, Rate, Mask, Sync group
and Events. Mask and Sync group draw only while some clip of the graph names one, because most
graphs name them on a handful of clips or on none and a column of nothing costs the width the
names want. The kind is the class name without `ClipData`: Atomic, Selector, Sequencer. File is
one mark, the animation kind's, which names the `.anm`'s path and archive on hover and opens it
on a click, because the path repeats the clip's name for most of its length and the table is
read by name. A `.anm` nothing on the machine holds draws the missing warning in its place. A
track, a mask and a sync group are chips, and a click on one switches the pane to that map's
tab and marks the entry's row. A key the map does not declare is drawn dim with a warning, and
no rule is raised for it. Rate is the `.anm`'s frames per second over the ticks a second
`mTickDuration` makes, `30/30`, and the file's half is read for the rows on screen alone.
Events counts `mEventDataMap`. A composite clip carries no file, no tick and no rate.

**A row click poses the preview, and its caret unfolds the clip.** A click on a row is the
transport's own pick: the preview plays the clip, the transport's picker names it, and a play
glyph marks the row. The caret at the row's start unfolds the clip's own rows under it, as
field rows, and its event map, its pair lists and its accessories fold open as any struct does,
over a Plays strip naming the clips it plays, each a chip that unfolds that row and poses the
preview with it. Any number of rows stand unfolded at once, and the inspector keeps the skin's
sections throughout, because a reader compares clips side by side and the inspector is one
place. Right and Left arrows unfold and fold the focused row.

**Every kind of clip plays.** An atomic clip plays its file. A sequencer plays its children one
after another and loops over the whole. A parametric clip plays the pair whose value lies
nearest a parameter the transport carries as a slider over the span its pairs cover, opening on
the first pair's value, which stands in for the blend the engine makes between the two pairs
around it. The slider is the ruler the library sizes its cards with, a tick labelled with each
pair's value and the held one lit, and a drag lands on the nearest tick, because a value between
two pairs plays the same clip as the nearer of them and offers nothing of its own. Every other
composite plays the first child that reaches a file, which stands in for the pick the engine
makes at runtime from a condition or a chance, and an event controlled selector tries its default
clip first. The picker's tooltip names the atomic clip playing while it differs from the pick, and
a child chip under a parametric clip carries the value it plays at. A clip that reaches no file
on this machine is not offered and its row poses nothing. A pick of another clip opens that clip
on its first pair's value. The row of the clip that the preview opened on is marked before any pick.

**The clip's events play with it.** A submesh visibility event hides and shows what it names
from its start frame, matched to the `.skn`'s submeshes by hash, and one with an end frame puts
back what it changed there. The pass starts over from the skin's own hidden set, as the engine
puts the skin back when a clip ends. A particle event spawns the system its key resolves to
through the skin's resolver, in the skin's own file or in one it links, on the joint each pair
names, when its frame comes, stopped where its end frame falls and playing out otherwise. A
seek across the frame replays the system to where it stands, and the pass starting over stands
it down until the frame comes again. A joint snap event stands one joint where another is,
offset in that joint's frame, from its start frame to its end frame or the pass's end, and
what hangs off the joint follows: the skin it weighs, the armature, and the effects riding it.
A conform to path event bends the joints its mask weighs along the unit's path over the span.
The stage's unit stands still on flat ground, so the event moves nothing until the reader
moves the unit with the Move gizmo. A kill event, a key the resolver does not map and every
other kind of event draw nothing. A frame is `mTickDuration` seconds, else one over the
`.anm`'s rate. The events of each step of a sequencer fall where that step plays. The Effects
switch hides these with the idle effects, and stands in the controls while a clip carries one.

**Tracks, Masks and Sync groups are tabs.** A segmented control beside the filter lists the
four maps. These controls sit in a separate row beneath the pane tabs and wrap when space is
tight. Each sibling map draws as a small table of its entries: the name, then the
struct's own fields as columns. A mask's row counts the joints it weighs out of the joints its
list covers, and its caret unfolds them, each by slot, by the name the skin's skeleton gives
the slot, and by weight. A click on a mask's row weighs it on the character: every vertex a
weighed joint does not reach dims, as a submesh dims while another is highlighted, and a
vertex between a weighed joint and one not weighed grades between them as its skin does. The
click also turns the armature on, because a dimmed mesh says where a mask reaches and the
armature says which joints, and the weighed joints take the accent while the rest dim. A
second click lets the mask go and leaves the armature as it stands.

**The armature is the skeleton over the character.** Armature in the preview's controls draws
a dot per joint and a line to its parent, posed with the character and drawn through the mesh,
so a joint inside the body still reads. The kebab grouped with it holds Names, which writes
each joint's name beside its dot in the fine type, dimmed with the joint under a mask, and is
ticked while the armature is on. The names are painted on one canvas over the scene each
frame rather than laid out as text, because a hundred labels the layout moves each frame is
what a reader feels as lag. The controls are icons named on hover, because five words in a
row over the character cost more of it than five glyphs. Both are display preferences and
last across skins.

**Submeshes show and hide by hand.** The Submeshes menu in the preview's controls lists the
`.skn`'s submeshes, each ticked while it draws. A tick shows or hides the submesh over
whatever the skin's `initialSubmeshToHide` and the playing clip's events say, and the button
takes the accent while any is overridden. A last row lets them all go, and the choices are
the view's own, as the weighed mask is.

The pane sits under the preview in the shell's default arrangement, and a skin tree saved
before the pane existed gains it over the inspector. The tab, the filter, the unfolded rows and
the weighed mask are the view's own and last as long as the tab does. The graph's own layout
draws the same tables as a Clips section of the stack, with the blend table and the rest under
Other, and no skeleton to name a mask's joints by.

**Cells edit in place once leaf writing lands.** Track, mask and sync group become dropdowns
over the map's keys, the tick rate and the flags become fields, the event map a sub-table with
a frame column, and a row's name renames its key. Until then every cell is a value and a chip,
per "A cell is a row".

## The VFX section

The VFX section of the inspector lists the skin's idle effects, as "What a layout reads" in
docs/ux/BIN_EDITOR.md describes. The section edits them when the view edits and the skin's own
file declares its resolver.

**Add effect adds an idle effect.** The combobox lists the systems that Add child lists: every
system of the file, then each system that a resolver of the file maps. A pick appends an effect
on the skeleton's first joint, keyed to the system. The effect takes the key that the resolver
maps to the system. If no key maps to it, the add writes a key named after the last segment of
the system's path, numbered from 2 if another system holds that name. The picker waits for the
skeleton, because an effect is added on a joint. In a file that the project holds, the add is one undo step. In a declared game bin, each write is its own step, so the
game's keys and effects stay out of the layer.

**A row picks its bone from the skeleton.** The bone cell is a joint combobox, and a remove
button ends the row. A removed effect leaves its resolver key, because a clip event or a spell
can read the same key.

## The Conditions section

The Conditions section lists the skin's `PersistentEffectConditions`. The engine spawns the
effects of an entry and applies its submesh changes while its `OwnerCondition` and its
`SourceCondition` are true, as <https://meta-wiki.leaguetoolkit.dev/classes/persistenteffectconditiondata/>
describes.

**A condition is one row.** The row holds a fold, the preview switch, the owner condition's
class, then the source condition's after "Source", the number of effects and a remove button.
A driver with a `Spell` shows the last segment of the spell's path, and a driver with
`mDrivers` shows how many it holds. A condition that sets neither driver reads "Always".

**The fold opens the condition.** It lists the effects as the VFX section does, with the same
bone picker, remove button and Add effect, and the add appends to the condition's
`PersistentVfxs`. The Show and Hide lines list `SubmeshesToShow` and `SubmeshesToHide` by the
`.skn`'s names, each with a remove, and a picker of the submeshes that the line does not list
yet. A hash that matches no submesh shows as its hash. The other fields, the drivers among
them, are field rows, so a driver's class is swapped and its fields are edited as in the tree.

**Add condition appends a `HasBuffDynamicMaterialBoolDriver` owner condition**, which is the
driver most shipped conditions start from, and opens the new row. The edits follow the rules of
the VFX section: one undo step in a file that the project holds, and narrow writes in a
declared game bin.

**The preview applies a condition by hand.** The preview does not evaluate a driver, so no
condition is applied when the skin opens. The switch on a row draws the condition's effects on
their joints and applies its submesh changes over the skin's own and the clip's: the show sets
of the applied conditions are joined, and a submesh in any hide set is hidden. The Submeshes
menu still overrides the result, and the effects switch hides the condition's effects with the
idle effects. The choice writes nothing and lasts as long as the tab. A change of the number of
conditions clears every switch, because the switches are keyed by index, and a change of the number
of pose modifiers clears the Physics pane's preview eyes for the same reason.

**A skin with no conditions still offers Add condition**, so the first condition creates the list.

**An effect's system is read from the file that declares it.** Most skins keep their systems in
the shared bins they link, and a skin can map a key to another skin's system. A condition's
effect and an idle effect resolve their key through the skin's resolver and read the system from
the skin's own file or from a linked file, as a clip's particle event does.

## The material pane

A skin's shell holds a Material pane, per ADR-0047, above the inspector. It draws one material
the skin draws with as the tables of "The material shell", beside the character that material
dresses, so an edit is judged on the mesh its textures were painted for. Clicking a submesh on
the character shows that submesh's material, and the pane's own list picks any other until the
next click. A submesh whose override names only a texture draws with no material, and only an
override that names PBR maps alone keeps the skin's material. The character shows an edit only under the game's shaders, so the pane offers to
turn them on while they are off. A material another file declares says so in place of the
tables.

## The skeleton pane

A skin's bone physics and its sockets are added from a joint, so the skin shell has a pane that
lists the joints: the `.skl`'s outline, each joint marked with what it is to the skin's pose
modifiers and sockets. The marks are the tree root, a simulated joint, an excluded joint, a
spring's joint, a joint an orientation turns, a joint a conform turns and a socket's parent,
and a socket is listed under the joint it rides. A joint's menu simulates from it, leaves it
out of a tree, hangs a socket, a spring or a joint orientation on it, and stands a collider on
it.

A click on a row selects its joint, and a second click on the selected row clears the selection.
The selected joint is the skin choice's, so the viewport marks the same one, with the bones of
every joint under it, which is what a tree rooted there would simulate. The mark is hidden with
the viewport's controls. The outline is one tab stop: the up and down arrows, Home and End move
the selection through the joints shown, and the left and right arrows fold and unfold the
selected joint.

A row is as dense as an outliner's: a bone glyph before a joint's name and an anchor before a
socket's, in the interface's own face, since the name is a label here and not a value.

The pane's header holds a filter and the armature switch. The filter narrows the outline to
the joints and sockets whose name holds what is typed, listed without their indent. A reader
who knows where a joint is and not what it is called picks it in the viewport: with the
armature on, a click on a joint's dot selects the joint. The outline opens down to it. The
click picks no submesh.

The pane shows a notice while the skin loads and for a skin that names no skeleton.

## The physics pane

The Physics pane lists a skin's pose modifiers and its sockets and edits their fields. It is a
tab behind the inspector: a toolbar and the picked item's row, which stay in place, over one
body. The pane shows a notice while the skin loads and for a skin that names no skeleton, as
the Skeleton pane does.

The toolbar holds the tabs that switch between the pose modifiers and the sockets, each with
its count, and the add for the list shown. For the modifiers that is a menu of every class the
game has, each added at the class's defaults. For the sockets it adds one on the selected
joint.

The row under it is the picked item: its kind, the joints it works on, where it stands in the
list, a step to the item before it and to the one after, its preview eye and its remove.

The body is the list or the fields of the picked item, and never both, so the fields are not
squeezed into what the list leaves. The picked row's caret unfolds the list, one short row per
item. A click on a row, Enter or Space opens the item: the list folds and the item's fields take
the whole body. The arrow keys, Home and End move the pick through an unfolded list, which is
one tab stop. The steps of the picked row move it while the list is folded, which is how a
reader goes through the tails of a skin. An item added from the pane or from a joint's menu is
opened. A row of the list carries the preview eye, so several modifiers are left out of the
preview from the list, and a mark where the item or anything under it holds a diagnostic.

An item of a kind the preview shows nothing for says in one line over its fields what the
modifier does and why the preview is still, and carries no preview eye. The fields are every
field the item's class declares at the installed build, each a field row, as "The primitive"
draws a primitive's: the rows are the document's own, so a name opens the field card, a field
the file leaves out draws dimmed at its default and is written by its first edit, and a row is
marked, reset and undone as any row is. A chain's groups are sections of their own under the
chain's fields, and a group's section lists its trees.

A chain parameter is one row and not the three its struct holds: its value, the shape of the
curve that scales the value from the tree's root to its tip, and the joined Constant and Curve
control of "A value family in a layout". The curve dock does not take the holder, so the row
unfolds to the curve's keys. A parameter is one value and one curve for the whole group, so a
joint is tuned by the curve at its place along the tree. Pointing at a row tints the simulated
joints by the parameter. A rod parameter the file leaves out is not drawn while rod physics is
off. An item's eye leaves its modifier out of the preview and writes nothing, which is how a
reader compares with and without it. An item states, over its fields, what the game would take
silently, such as a tree whose root is no joint.

A conform's row names the chain it turns, from its starting joint to its ending joint. Its
chain's joints carry a mark in the outline. A conform whose default mask weighs nothing shows
in the preview only on a clip whose event blends a mask in, and only while the reader moves
the unit.

A joint orientation draws two of its fields itself. Its joints are a list of names,
each with a remove, and the joint selected in the outline or the viewport is offered to join
them. Its source is a class picked from the ones the field takes, over that class's own fields.
The five fields of the class that no table names read as what the game does with them: the
tilt axis, the aim axis and its sign, the flip, and the largest turn. The preview cannot read a
source, which the game evaluates against the live unit, so it aims the joints at a place on the
ground ahead of the unit, and the pane says so.

A socket is placed in the viewport and not by its numbers alone. The overlay draws each socket
as its three axes and a line to the joint it rides, so a socket that stands far off its joint
still reads as that joint's. The viewport draws one gizmo at a time: the unit's Move gizmo while
Move is on, else the picked socket's while the Sockets list shows. Picking a socket turns Move off,
and turning Move on hides the socket's gizmo until a press on a socket's buttons takes it back. The
picked row and a bar in the viewport's corner hold the gizmo's buttons: move (W), turn (E), and local
axes (X), which is on by default so a move runs along the socket's own orientation. Ctrl snaps a drag
to 5 units or 15 degrees, and Esc during a drag puts the handle back and writes nothing. A press
pauses the clip, so a drag is measured on the pose it started on. A release writes the offset the
drag left: a move writes `PositionOffset`, with any frozen axis taken into account, and a turn writes
`RotationOffset`. A press that moves nothing writes nothing. A world socket has no rotation, and a
frozen angle comes from the bind pose, which no offset reaches by itself, so such a socket offers no
turn and says why. During a drag the preview's keys do nothing, apart from Ctrl and Esc. A drag whose
frozen axes leave the position unsolvable, at a turn near a quarter off the bind pose, writes nothing.

A socket's parent joint is a hash in the file, which a reader cannot type. Its field is a
list of the skeleton's joints by name, narrowed by what is typed in it.

An event of a clip that plays other clips, a parametric or a sequencer clip, plays in the
preview where the game fires it: always for a sequencer, and for a parametric clip that turns
its own events on. So a joint orientation that a parametric clip's event turns on shows when
that clip is the one chosen, and not when one of the atomic clips under it is.

The viewport's action row holds the Physics switch beside the armature's, which draws the
overlay: a dot on every joint a modifier writes, a chain's collision radii and lateral links,
the ground the chains rest on, the colliders and the sockets. Its menu ticks the simulated
joints, the colliders and the sockets apart, so a reader placing colliders hides the joints,
and one reading the motion hides the colliders.

A capsule runs between any two joints. A joint's menu offers one to its parent and one to the
selected joint, and the selected joint's own menu offers one to the joint selected before it, so
two clicks in the viewport name both ends.

A chain's fields list its colliders: a sphere with its joint, radius and offset off the joint,
and a capsule with its two joints and a radius per end. The colliders are a file of their own,
which the first one creates beside the skeleton, under the skeleton's name and the skin object's
hash so that skins with one skeleton keep their shapes apart, and names on the chain, in the skin's layer or,
for a declared skin, the layer its declarations are written to. The file is outside the
document's undo. Their lines are laid out as field rows and are not rows: a number saves the
file when its field is left, and text that is no number, or a radius under zero, is marked and
saves nothing. An edit shows before its save answers, and the shapes return to the file's when
the save fails.

A simulated pose needs movement, and the stage's unit stands still. The reader moves it by hand:
with the viewport's Move gizmo on, a drag or a turn of the character swings the chains, the
springs and the tails as it happens, and they settle when the character is let go. The live pose
starts settled on the clip's pose with the clip's events in force, and a seek backwards puts the
events in force as of the new time. With the gizmo off, the pose is the baked pass, which shows
what the clip's own motion does and scrubs to any time. A drag is not part of the pass, so a
scrub does not replay it.

The frame rate the pose is simulated at, since the game steps a chain once per frame, is in
the menu of the viewport's Physics switch, under what the overlay draws. It is set rarely, so
it takes no room in the transport. A change of a modifier, the clip or the rate bakes the pass
again. The decisions are in `docs/plans/pose-dynamics-preview.md`, ADR-0062 and ADR-0063.
