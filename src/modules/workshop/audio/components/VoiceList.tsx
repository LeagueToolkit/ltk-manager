import { MinusCircleIcon } from "@phosphor-icons/react";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";

import { ContextMenu } from "@/components";
import { NO_OVERSCROLL, useRemeasure, useZoomedPx } from "@/hooks";
import { m } from "@/i18n";
import type { EventNode, MediaLocation, SetFile } from "@/lib/tauri";
import { measureRow, twMerge } from "@/utils";

import { nameColumnStyle, RowAction } from "../../shared/components/PropertyRowParts";
import { createGuideStore, GuideStoreContext } from "../../shared/state/treeGuides";
import { instantScroll } from "../../shared/utils/instantScroll";
import type { EventPlayer } from "../hooks/useEventPlayer";
import type { TreePicks } from "../hooks/useTreePicks";
import { useTypeAhead } from "../hooks/useTypeAhead";
import { useNodeNames } from "../state/nodeNames";
import { usePanelCommands } from "../state/panelCommands";
import { beginRowDrag, useRowDrops } from "../state/rowDrag";
import {
  dropAction,
  type DragPayload,
  type DropAction,
  type DropSlot,
  type ListPlace,
} from "../utils/dropTargets";
import { eventLabel } from "../utils/eventTree";
import { type AudioCommandId, resolveCommand } from "../utils/keymap";
import { rowLanes } from "../utils/lanes";
import { resetEdit } from "../utils/nodeFields";
import { type NodeNames, nodeText } from "../utils/nodeNames";
import { headIndex, movedIndex, pageRows, treeStep } from "../utils/rowKeys";
import { pickMode } from "../utils/rowSelection";
import { isEditable, type TreeEditing } from "../utils/treeEditing";
import {
  type ContainerNode,
  type FieldCell,
  foldKey,
  movedCell,
  type RowCells,
  rowAction,
  rowCells,
  takesMediaPick,
  type VoiceCell,
  voiceCells,
  type VoiceLine,
  voiceLine,
  voiceParent,
  type VoiceRow,
} from "../utils/voices";
import { AddNodeLine } from "./AddNodeLine";
import { AUDIO_LIST_GROUP } from "./audioRow";
import type { NodeActions } from "./EventMenu";
import { EditedMark, Lead, PlayButton, RowFrame, rowId } from "./EventRowParts";
import { FieldValue } from "./FieldRows";
import { PlayedByCell } from "./PlayedBy";
import { EventContent, Status } from "./RowContent";
import { RowDragGhost } from "./RowDragGhost";
import {
  ActionName,
  GroupName,
  groupText,
  headerStems,
  MediaPicker,
  VoiceCells,
  VoiceName,
  voiceNameColumns,
} from "./VoiceRowParts";

interface VoiceListProps {
  readonly rows: readonly VoiceRow[];
  /** Opens or folds the row `key`, with the fold keys of `foldKey`. */
  readonly onExpand: (key: string, open: boolean) => void;
  /** The key of the row that the keyboard is on. */
  readonly selected: string | null;
  /** The picked rows, which the node actions take. */
  readonly picks: TreePicks;
  readonly player: EventPlayer;
  /** Plays a new pick of `row`, and stops what played before. */
  readonly onPlay: (row: VoiceRow) => void;
  /** Plays once what an edit on `row` changed. */
  readonly onReplay: (row: VoiceRow) => void;
  /** Plays `media` under the row `key`, and stops what played before. */
  readonly onPreview: (key: string, media: MediaLocation) => void;
  /** Copies the names and IDs of the picked rows. */
  readonly onCopy: () => void;
  /** The node actions on the picked rows, or null for a view that takes no edit. */
  readonly actions: NodeActions | null;
  /** The key of the add row whose menu is open. */
  readonly adding: string | null;
  /** Opens the menu of an add row, or closes it with null. */
  readonly onAdding: (key: string | null) => void;
  /** The key of the add row that a menu command asks to open its media picker. */
  readonly mediaRequest?: string | null;
  /** The add row opened its media picker for `mediaRequest`. */
  readonly onMediaRequestTaken?: () => void;
  /** The context menu items of `row`. */
  readonly menu: (row: VoiceRow) => ReactNode;
  /** The waveform column of `row`. */
  readonly thumbnail: (row: VoiceRow) => ReactNode;
  /** The open document that the rows edit, or null for a view that takes no edit. */
  readonly editing: TreeEditing | null;
  /** The files of the bank set, which the media picker lists the media of. */
  readonly files: readonly SetFile[];
  /** The row that a request from another view asks the list to scroll to, once per token. */
  readonly reveal?: { readonly key: string; readonly token: number } | null;
  /** The keys of the rows whose nodes are cut and wait for a paste. */
  readonly cut: ReadonlySet<string>;
  /** Runs a drop of a file on a row. A move within a playlist runs in the list. */
  readonly onDropAction: (action: DropAction) => void;
}

/** Returns the name that the type-ahead matches and the drag ghost shows for `row`. */
function rowLabel(row: VoiceRow, names: NodeNames): string {
  if (row.kind === "event") return eventLabel(row.event);
  if (row.kind === "voice") return nodeText(names, row.line.voice.node);
  if (row.kind === "action") return row.action.label ?? "";
  if (row.kind === "group" && row.group.container !== null) {
    return nodeText(names, row.group.container);
  }

  return "";
}

/** The height of a row in px at 100% zoom: `min-h-6` is six spacing units of 4.5px. */
const ROW_HEIGHT = 27;

/** The entry name of the target of an action, which the name cell of its row opens. */
const TARGET_CELL = "target";

/** Returns `true` if the source of the voice of `line` takes a pick of another media. */
function swappable(line: VoiceLine | null, editing: TreeEditing | null): line is VoiceLine {
  return line !== null && editing !== null && takesMediaPick(line);
}

/** Returns the object that `row` stands for under its parent: a voice's node, a header's container. */
function placedNode(row: VoiceRow): { node: EventNode; parent: ContainerNode | null } | null {
  if (row.kind === "voice")
    return { node: row.line.voice.node, parent: voiceParent(row.line.voice) };
  if (row.kind === "group" && row.group.container !== null) {
    return { node: row.group.container, parent: voiceParent(row.group) };
  }

  return null;
}

/**
 * The event tree of an event bank: each event expands into its actions, a header per container
 * and switch state, and the voices at the leaves, windowed.
 *
 * A header row draws its container's name and knobs in the columns of the voice rows, and folds
 * the rows under it. An action row draws its class, target and delay. One tab stop with
 * `aria-activedescendant`. Up and Down move between rows, Left and Right between the cells of a
 * row and fold a header, and Enter or F2 opens the entry of the cell. Per "Event tree", "Group
 * headers" and "Selection" in docs/ux/AUDIO.md.
 */
export function VoiceList({
  rows,
  onExpand,
  selected,
  picks,
  player,
  onPlay,
  onReplay,
  onPreview,
  onCopy,
  actions,
  adding,
  onAdding,
  mediaRequest = null,
  onMediaRequestTaken,
  menu,
  thumbnail,
  editing,
  files,
  reveal = null,
  cut,
  onDropAction,
}: VoiceListProps) {
  const scroller = useRef<HTMLDivElement>(null);
  const listId = useId();
  const byKey = useMemo(() => new Map(rows.map((row) => [row.key, row])), [rows]);
  const openKeys = useMemo(
    () => new Set(rows.flatMap((row) => (row.open ? [row.key] : []))),
    [rows],
  );
  const lanes = useMemo(() => rowLanes(rows), [rows]);
  const names = useNodeNames();
  const nameCols = useMemo(() => voiceNameColumns(rows, names), [rows, names]);
  const stems = useMemo(() => headerStems(rows, names), [rows, names]);
  const [guides] = useState(createGuideStore);
  const [entering, setEntering] = useState<string | null>(null);
  const [picking, setPicking] = useState<string | null>(null);
  const [cellName, setCellName] = useState<VoiceCell>("media");
  const [menuRow, setMenuRow] = useState<VoiceRow | null>(null);

  /* A field that commits or drops its text leaves focus on no element, and the list takes it
     back, so a run of edits stays on the keyboard. */
  function returnFocus() {
    requestAnimationFrame(() => {
      const active = document.activeElement;
      if (active === null || active === document.body) scroller.current?.focus();
    });
  }

  const zoomed = useZoomedPx();
  const rowHeight = zoomed(ROW_HEIGHT);
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scroller.current,
    estimateSize: () => rowHeight,
    overscan: 12,
    getItemKey: useCallback((index: number) => rows[index]?.key ?? index, [rows]),
    scrollToFn: instantScroll,
    measureElement: measureRow,
  });
  useRemeasure(virtualizer, rowHeight);

  const revealIndex = reveal === null ? -1 : rows.findIndex((row) => row.key === reveal.key);
  useEffect(() => {
    if (revealIndex >= 0) virtualizer.scrollToIndex(revealIndex, { align: "center" });
  }, [reveal?.token, revealIndex, virtualizer]);

  const selectedIndex = rows.findIndex((row) => row.key === selected);
  const selectedRow = rows[selectedIndex];
  useEffect(() => guides.set({ active: selectedRow?.parent ?? null }), [guides, selectedRow]);

  function fold(row: VoiceRow, open: boolean) {
    onExpand(foldKey(row), open !== row.defaultOpen);
  }

  function selectAt(index: number, range = false) {
    const row = rows[Math.max(0, Math.min(rows.length - 1, index))];
    if (row === undefined) return;

    picks.pick(row.key, range ? "range" : "only");
    virtualizer.scrollToIndex(rows.indexOf(row), { align: "auto" });
  }

  function cellsOf(row: VoiceRow | undefined): VoiceCell[] {
    const cells = rowCells(row);
    return cells === null ? [] : voiceCells(cells.fields, cells.columns);
  }

  /** Returns the cell that the arrows reached on `row`: the last one named, else the first. */
  function activeCell(row: VoiceRow | undefined): VoiceCell | null {
    const cells = cellsOf(row);
    return cells.includes(cellName) ? cellName : (cells[0] ?? null);
  }

  function enterCell(row: VoiceRow, cell: VoiceCell): boolean {
    if (cell === "media") {
      const target = rowCells(row)?.fields.target;
      if (target != null) {
        if (editing === null || !target.editable) return false;

        setEntering(`${row.key}:${TARGET_CELL}`);
        return true;
      }
      if (!swappable(voiceLine(row), editing)) return false;

      setPicking(row.key);
      return true;
    }

    const field = rowCells(row)?.fields.cells[cell];
    if (editing === null || field?.editable !== true) return false;

    setEntering(`${row.key}:${cell}`);
    return true;
  }

  /** Returns the container that the node of `row` sits in, if it takes edits there. */
  function editableParent(row: VoiceRow) {
    const parent = placedNode(row)?.parent ?? null;
    return parent !== null && isEditable(editing, parent.id) ? parent : null;
  }

  function removeVoice(row: VoiceRow) {
    const parent = editableParent(row);
    if (editing === null || parent === null || row.kind !== "voice") return;

    void editing.edit({ kind: "delete", object: row.line.voice.node.id, parent: parent.id });
  }

  function closeAdding() {
    onAdding(null);
    returnFocus();
  }

  /** Returns the place of `row` in the playlist of its random parent, which a move reorders. */
  function placeOf(row: VoiceRow): ListPlace | null {
    const placed = placedNode(row);
    const parent = editableParent(row);
    if (placed === null || parent?.kind !== "random") return null;

    const id = placed.node.id;
    const index = parent.playlist.findIndex((item) => parent.children[item.child]?.id === id);
    return index < 0 ? null : { list: `c:${parent.id}`, index };
  }

  /** Moves `row` to `index` of the playlist of its random parent. */
  function moveTo(row: VoiceRow, index: number) {
    const placed = placedNode(row);
    const parent = editableParent(row);
    if (editing === null || placed === null || parent?.kind !== "random") return;
    if (index < 0 || index >= parent.playlist.length) return;

    void editing.edit({ kind: "moveChild", container: parent.id, child: placed.node.id, index });
  }

  /** Returns what a drop on `row` reads, or null for a row that takes no drop. */
  function slotOf(row: VoiceRow): DropSlot | null {
    if (editing === null) return null;
    if (row.kind === "add") return { kind: "add", key: row.key, into: row.into };
    if (row.kind === "group") return { kind: "container", key: row.key, place: placeOf(row) };

    const line = voiceLine(row);
    if (line === null) return null;

    const node = line.voice.node;
    const source = node.kind === "sound" ? node.source : null;
    return { kind: "sound", key: row.key, source, place: placeOf(row) };
  }

  /** Returns what a drag of `row` carries: a named event, or a row of a playlist. */
  function payloadOf(row: VoiceRow): DragPayload | null {
    if (row.kind === "event") {
      return row.event.name === null ? null : { kind: "event", name: row.event.name };
    }

    const place = placeOf(row);
    return place === null ? null : { kind: "row", key: row.key, place };
  }

  useRowDrops(scroller, (key, payload) => {
    const row = byKey.get(key);
    const slot = row === undefined ? null : slotOf(row);
    const action = slot === null ? null : dropAction(payload, slot);
    if (action === null) return false;

    const moved = action.kind === "move" ? byKey.get(action.key) : undefined;
    if (moved !== undefined && action.kind === "move") moveTo(moved, action.index);
    else onDropAction(action);
    return true;
  });

  const typeAhead = useTypeAhead(
    () => rows.map((row) => rowLabel(row, names)),
    selectedIndex,
    (index) => selectAt(index),
  );

  /** Plays `row`, or stops it if it plays. */
  function togglePlay(row: VoiceRow) {
    if (player.playing === row.key) player.stop();
    else onPlay(row);
  }

  /** Opens the entry of the active cell or the add row, or plays a row without either. */
  function enterRow(key: string, row: VoiceRow) {
    const cell = activeCell(row);
    if (cell !== null && enterCell(row, cell)) return;
    if (row.kind === "add") {
      onAdding(row.key);
      return;
    }
    if (key === "Enter") onPlay(row);
  }

  /** Returns the edit that sets the field of the active cell of `row` to its default, or null. */
  function cellReset(row: VoiceRow) {
    const cell = activeCell(row);
    const field = cell === null || cell === "media" ? undefined : rowCells(row)?.fields.cells[cell];
    return field === undefined ? null : resetEdit(field);
  }

  /** Sets the field of the active cell of `row` to its default. */
  function resetCell(row: VoiceRow): boolean {
    const edit = cellReset(row);
    if (editing === null || edit === null) return false;

    void editing.edit(edit).then((applied) => {
      if (applied) onReplay(row);
    });
    return true;
  }

  /** Moves between the cells of `row` with ArrowLeft and ArrowRight, then folds or walks the tree. */
  function stepCells(key: string, row: VoiceRow) {
    if (key === "ArrowRight" && row.kind === "group" && !row.open) {
      fold(row, true);
      return;
    }

    const cells = cellsOf(row);
    const at = cells.indexOf(activeCell(row) ?? "media");
    const next = cells.length > 1 ? movedCell(key, at, cells.length) : null;
    const cell = next === null ? undefined : cells[next];
    if (cell !== undefined) {
      setCellName(cell);
      return;
    }

    const step = treeStep(key, rows, selectedIndex, openKeys);
    const stepped = step?.kind === "expand" ? byKey.get(step.key) : undefined;
    if (step?.kind === "expand" && stepped !== undefined) fold(stepped, step.open);
    if (step?.kind === "select") selectAt(step.index);
  }

  /** Runs the node action of `command` on the picks. A bank that takes no edit swallows the key. */
  function runAction(command: AudioCommandId) {
    if (actions === null) return;

    if (command === "wrap") actions.wrap?.("random");
    if (command === "add") actions.add?.();
    if (command === "duplicate") actions.duplicate?.();
    if (command === "remove") actions.remove?.();
    if (command === "cut") actions.cut?.();
    if (command === "paste") actions.paste?.();
  }

  /**
   * Runs `command`, which the key `key` resolved to, on the selected `row`.
   *
   * Returns `true` if the list answers the key, which then reaches no handler above the list.
   */
  function run(command: AudioCommandId, key: string, row: VoiceRow | undefined): boolean {
    switch (command) {
      case "moveRow":
      case "movePage":
      case "moveEnd":
      case "extendRange": {
        const page = pageRows(scroller.current, rowHeight);
        const target = movedIndex(key, selectedIndex, rows.length, page);
        if (target !== null) selectAt(target, command === "extendRange");
        return true;
      }
      case "nextEvent":
      case "previousEvent": {
        const at = headIndex(rows, selectedIndex, command === "nextEvent" ? 1 : -1, "event");
        if (at !== null) selectAt(at);
        return true;
      }
      case "selectAll":
        picks.pickAll();
        return true;
      case "copy":
        onCopy();
        return true;
      case "add":
      case "duplicate":
      case "remove":
      case "wrap":
      case "cut":
      case "paste":
        runAction(command);
        return true;
      default:
        break;
    }

    if (row === undefined) return false;

    switch (command) {
      case "play":
        togglePlay(row);
        return true;
      case "playAll": {
        const head = rows.find((each) => each.kind === "event" && each.eventId === row.eventId);
        if (head !== undefined) onPlay(head);
        return true;
      }
      case "stop":
        if (player.playing !== null) player.stop();
        else if (picks.picked.size > 1) picks.pick(row.key, "only");
        else return false;
        return true;
      case "stepRight":
      case "stepLeft":
        stepCells(key, row);
        return true;
      case "enter":
        enterRow(key, row);
        return true;
      case "reset":
        return resetCell(row);
      case "moveUp":
      case "moveDown": {
        const place = placeOf(row);
        if (place !== null) moveTo(row, place.index + (command === "moveUp" ? -1 : 1));
        return place !== null;
      }
      default:
        return false;
    }
  }

  const resetRow =
    selectedRow !== undefined && editing !== null && cellReset(selectedRow) !== null
      ? selectedRow
      : null;
  usePanelCommands(
    "events",
    { reset: resetRow === null ? undefined : () => resetCell(resetRow) },
    "list",
  );

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.target !== event.currentTarget) return;

    if (event.key === "Escape") {
      picks.clear();
      event.preventDefault();
      event.stopPropagation();
      return;
    }

    const command = resolveCommand(event, "voices");
    const handled = command === null ? typeAhead(event) : run(command, event.key, selectedRow);
    if (!handled) return;

    event.preventDefault();
    event.stopPropagation();
  }

  function closePicking() {
    setPicking(null);
    returnFocus();
  }

  function enterChange(key: string, open: boolean) {
    setEntering((current) => (open ? key : current === key ? null : current));
  }

  function cellParts(row: VoiceRow, cells: RowCells) {
    const active = row.key === selected ? activeCell(row) : null;
    const enteringCell = entering?.startsWith(`${row.key}:`)
      ? (entering.slice(row.key.length + 1) as FieldCell)
      : null;
    const target = cells.fields.target;
    const targetKey = `${row.key}:${TARGET_CELL}`;

    return {
      active,
      target: target !== null && (
        <FieldValue
          field={target}
          editing={editing}
          entering={entering === targetKey}
          onEntering={(open) => enterChange(targetKey, open)}
          onLeave={returnFocus}
          onCommitted={() => onReplay(row)}
        />
      ),
      cells: (
        <VoiceCells
          cells={cells}
          editing={editing}
          entering={enteringCell}
          onEntering={(cell, open) => enterChange(`${row.key}:${cell}`, open)}
          onLeave={returnFocus}
          onCommitted={() => onReplay(row)}
          active={active}
        />
      ),
    };
  }

  function voiceParts(row: VoiceRow, line: VoiceLine) {
    const node = line.voice.node;
    const picker =
      picking === row.key && editing !== null && node.kind === "sound" ? (
        <MediaPicker
          files={files}
          stream={node.stream}
          current={node.source}
          onPreview={(candidate) => onPreview(row.key, candidate.media)}
          onPick={(candidate) => {
            void editing
              .edit({ kind: "source", sound: node.id, source: candidate.media.source })
              .then((applied) => {
                if (applied) onPreview(row.key, candidate.media);
              });
            closePicking();
          }}
          onClose={closePicking}
        />
      ) : null;

    return {
      ...cellParts(row, line),
      picker,
      onSwap: swappable(line, editing) ? () => setPicking(row.key) : undefined,
    };
  }

  function line(row: VoiceRow, index: number): ReactNode {
    const lane = lanes[index];
    const slot = slotOf(row);
    const payload = payloadOf(row);
    const plays = row.kind === "event" || row.kind === "group" || row.kind === "voice";
    const frame = {
      row,
      open: row.open,
      selected: row.key === selected || picks.picked.has(row.key),
      playing: player.playing === row.key,
      cut: cut.has(row.key),
      drops:
        slot === null
          ? undefined
          : slot.kind === "container"
            ? ("row" as const)
            : ("file" as const),
      onDragPress:
        payload === null
          ? undefined
          : (event: ReactPointerEvent) =>
              beginRowDrag(event, payload, listId, rowLabel(row, names)),
      onPlay: plays ? () => togglePlay(row) : undefined,
      blocks: lane?.blocks ?? [],
      ends: lane?.ends,
      index,
      onSelect: (event: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }) =>
        picks.pick(row.key, pickMode(event)),
      onExpand: (next: boolean) => fold(row, next),
      onHover: () => guides.set({ hover: row.parent, hoverAt: index }),
    };
    const lead = <Lead {...frame} expandable={row.expandable} />;
    const play = (playable: boolean) => (
      <PlayButton
        playable={playable}
        playing={frame.playing}
        onToggle={() => {
          if (!picks.picked.has(row.key)) picks.pick(row.key, "only");
          if (player.playing === row.key) player.stop();
          else onPlay(row);
        }}
      />
    );
    const failed = player.failed.has(row.key) && (
      <span className="text-meta text-danger-text">{m.audio_event_play_failed_label()}</span>
    );

    switch (row.kind) {
      case "event":
        return (
          <RowFrame {...frame}>
            {lead}
            {play(row.event.mediaCount > 0)}
            <EventContent event={row.event} />
            {row.play !== null && (
              <span className="shrink-0 text-meta text-surface-400">
                {m.audio_event_play_label({ ms: String(row.play.delay) })}
              </span>
            )}
            {editing !== null && row.play !== null && editing.edited.has(row.play.id) && (
              <EditedMark />
            )}
            {failed}
            <PlayedByCell event={row.event} />
            <span className="w-24 shrink-0 pl-3">{thumbnail(row)}</span>
          </RowFrame>
        );
      case "group": {
        const parts = cellParts(row, row.cells);
        const object = row.group.container?.id ?? rowAction(row)?.id ?? null;
        const text = groupText(row.group, stems.get(row.key) ?? null, row.weighted);
        return (
          <RowFrame {...frame}>
            <GroupName
              group={row.group}
              text={text}
              lead={
                <>
                  {lead}
                  {play(row.group.count > 0)}
                </>
              }
              active={parts.active === "media"}
              target={parts.target}
            />
            {parts.cells}
            {editing !== null && object !== null && editing.edited.has(object) && <EditedMark />}
            {failed}
          </RowFrame>
        );
      }
      case "action": {
        const parts = cellParts(row, row.cells);
        return (
          <RowFrame {...frame}>
            <ActionName
              action={row.action}
              lead={lead}
              active={parts.active === "media"}
              target={parts.target}
            />
            {parts.cells}
            {editing !== null && editing.edited.has(row.action.id) && <EditedMark />}
          </RowFrame>
        );
      }
      case "voice": {
        const parts = voiceParts(row, row.line);
        const node = row.line.voice.node;
        const removable = editing !== null && editableParent(row) !== null;
        return (
          <RowFrame {...frame}>
            <VoiceName
              line={row.line}
              lead={
                <>
                  {lead}
                  {play(node.kind === "sound" && node.media !== null)}
                </>
              }
              active={parts.active === "media"}
              picker={parts.picker}
              onSwap={parts.onSwap}
            />
            {parts.cells}
            {editing !== null && editing.edited.has(node.id) && <EditedMark />}
            {removable && (
              <RowAction
                label={m.audio_edit_remove_child_action()}
                icon={MinusCircleIcon}
                onAct={() => removeVoice(row)}
              />
            )}
            {failed}
            <span className="ml-auto w-24 shrink-0 pl-3">{thumbnail(row)}</span>
          </RowFrame>
        );
      }
      case "add":
        return (
          <RowFrame {...frame}>
            {lead}
            {editing !== null && (
              <AddNodeLine
                into={row.into}
                editing={editing}
                files={files}
                exclude={row.exclude}
                opening={adding === row.key}
                onOpening={(next) => (next ? onAdding(row.key) : closeAdding())}
                onPreview={(media) => onPreview(row.key, media)}
                onLeave={returnFocus}
                mediaRequested={mediaRequest === row.key}
                onMediaRequestTaken={onMediaRequestTaken}
              />
            )}
          </RowFrame>
        );
      case "empty":
        return (
          <RowFrame {...frame}>
            {lead}
            <span className="text-meta text-surface-400">{m.audio_event_actions_empty()}</span>
          </RowFrame>
        );
      case "loading":
        return (
          <RowFrame {...frame}>
            {lead}
            <span className="text-meta text-surface-400">{m.audio_event_loading_label()}</span>
          </RowFrame>
        );
      case "failed":
        return (
          <RowFrame {...frame}>
            {lead}
            <Status tone="danger">
              <span className="select-text">{row.message}</span>
            </Status>
          </RowFrame>
        );
    }
  }

  return (
    <GuideStoreContext value={guides}>
      <ContextMenu.Root>
        <ContextMenu.Trigger
          onContextMenuCapture={() => setMenuRow(selectedRow ?? null)}
          ref={scroller}
          role="tree"
          tabIndex={0}
          aria-label={m.audio_voices_tree_label()}
          aria-multiselectable
          aria-activedescendant={selected === null ? undefined : rowId(selected)}
          onKeyDown={handleKeyDown}
          onClick={(event) => {
            if ((event.target as HTMLElement).closest('[data-ui="RowFrame"]') === null) {
              picks.clear();
            }
          }}
          onFocus={(event) => {
            if (
              event.target === event.currentTarget &&
              selectedIndex < 0 &&
              event.currentTarget.matches(":focus-visible")
            ) {
              selectAt(0);
            }
          }}
          onPointerLeave={() => guides.set({ hover: null, hoverAt: null })}
          data-ui="VoiceList"
          className={twMerge(
            AUDIO_LIST_GROUP,
            "min-h-0 flex-1 overflow-auto text-row scrollbar-md select-none focus-visible:outline-none",
          )}
          {...NO_OVERSCROLL}
        >
          <div
            className="relative w-full min-w-max"
            style={{ height: virtualizer.getTotalSize(), ...nameColumnStyle(nameCols) }}
          >
            {virtualizer.getVirtualItems().map((item) => {
              const row = rows[item.index];
              if (row === undefined) return null;

              return (
                <div
                  key={item.key}
                  ref={virtualizer.measureElement}
                  data-index={item.index}
                  className="absolute top-0 left-0 w-full"
                  style={{ transform: `translateY(${item.start}px)` }}
                  onContextMenu={() => {
                    if (!picks.picked.has(row.key)) picks.pick(row.key, "only");
                    setMenuRow(row);
                  }}
                >
                  {line(row, item.index)}
                </div>
              );
            })}
          </div>
        </ContextMenu.Trigger>
        {menuRow !== null && <ContextMenu.Content>{menu(menuRow)}</ContextMenu.Content>}
      </ContextMenu.Root>
      <RowDragGhost source={listId} />
    </GuideStoreContext>
  );
}
