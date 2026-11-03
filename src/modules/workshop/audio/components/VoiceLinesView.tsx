import {
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  use,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";

import { ContextMenu, EmptyState, Spinner, useToast } from "@/components";
import { useCopyToClipboard } from "@/hooks";
import { m } from "@/i18n";
import type { AudienceLine, BinEdit, ValueEdit, VoiceRule, VoiceSituation } from "@/lib/tauri";
import { openKeySheet } from "@/modules/keys";
import { useAudioInspector, useSetAudioInspector } from "@/stores";
import { twMerge } from "@/utils";

import type { ViewContext, WidgetProps } from "../../bin/classes/components/ClassCells";
import {
  ObjectEditItems,
  ObjectFileItems,
  ObjectViewItems,
} from "../../bin/menus/components/ObjectBarItems";
import { useObjectCommands } from "../../bin/menus/hooks/useObjectMenus";
import { LeafEditContext } from "../../bin/tree/hooks/useLeafEdit";
import { rowKey } from "../../bin/tree/utils/binRows";
import { previewDocument } from "../../documents/utils/contentDocument";
import { RowCaret } from "../../shared/components/PropertyRowParts";
import { useOpenDocumentAs } from "../../state";
import { useCopyForSkin, useVoiceEdit, useVoiceLines, ruleTemplate } from "../api/voiceLines";
import { useLinePlayer } from "../hooks/useLinePlayer";
import { useTreePicks } from "../hooks/useTreePicks";
import { useTypeAhead } from "../hooks/useTypeAhead";
import { useNudgeVolume, usePreviewRepeat, useToggleLoop } from "../state/previewTransport";
import { beginRowDrag, useRowDrops } from "../state/rowDrag";
import {
  useBankEventStore,
  useChooseVoiceSkin,
  useRuleFocus,
  useVoiceSkin,
} from "../state/voiceLines";
import { dropAction, type DragPayload, type DropSlot, ruleShortName } from "../utils/dropTargets";
import { type AudioCommandId, type AudioSurface, resolveCommand, typesText } from "../utils/keymap";
import { headIndex, movedIndex, pageRows, treeStep } from "../utils/rowKeys";
import { pickMode } from "../utils/rowSelection";
import { spellOf, CLASS } from "../utils/voiceConditions";
import { ruleChance } from "../utils/voiceConditions";
import {
  addChanceEdits,
  chanceEdits,
  cooldownEdit,
  duplicateEdits,
  fieldPath,
  objectPath,
  priorityEdits,
  removeChanceEdits,
  removeEdits,
  rulesPath,
  shortNameEdits,
  situationsEdit,
} from "../utils/voiceEdits";
import { topicEdits } from "../utils/voiceFieldTopics";
import {
  audienceSummary,
  rowGroups,
  situationKey,
  unresolvedCount,
  voiceLineRows,
  type VoiceLineRow,
} from "../utils/voiceLines";
import {
  lineFor,
  simulateTrigger,
  triggerChoices,
  type TriggerContext,
} from "../utils/voiceTrigger";
import { AudioMenubar, VolumeReadout } from "./AudioMenubar";
import { AUDIO_LIST_GROUP } from "./audioRow";
import { PlayButton, RowFrame, rowId } from "./EventRowParts";
import { RowDragGhost } from "./RowDragGhost";
import { type InspectorSubject, VoiceLineInspector } from "./VoiceLineInspector";
import { type LineActions, VoiceLineMenu } from "./VoiceLineMenu";
import {
  AddRuleLine,
  ColumnHeads,
  LeadSlots,
  type LineCell,
  lineCells,
  RuleCells,
  type RuleRow,
  SituationText,
} from "./VoiceLineRows";
import { VoiceLinesHeader } from "./VoiceLinesHeader";

/**
 * The Voice lines section of a `ContextualActionData` object: the view of its situations and
 * rules, which edits the object's open document when the tab takes edits.
 */
export function VoiceLinesSection({ section, view }: WidgetProps) {
  const editable = use(LeafEditContext) !== null;
  const pathRow = section.rows.find((row) => row.name === OBJECT_PATH_FIELD);
  const path = pathRow?.value.type === "string" ? pathRow.value.value : null;

  return (
    <div className="font-sans text-row">
      <VoiceLinesView view={view} editable={editable} path={path} />
    </div>
  );
}

/** The field that names the object's own path, which the menu row shows. */
const OBJECT_PATH_FIELD = "mObjectPath";

/** The trigger a situation's play simulates before the reader sets one. */
const ANY_TRIGGER: TriggerContext = { target: null, spell: null, audience: "owner" };

/** The length of the `mSituations` field hash that a rule's path from the object's root starts with. */
const SITUATIONS_PREFIX = 8;

interface VoiceLinesViewProps {
  readonly view: ViewContext;
  readonly editable: boolean;
  /** `mObjectPath`, or null if the object does not write it. */
  readonly path: string | null;
}

/**
 * The situations of an object as group headers, each rule one line under its header, beside an
 * inspector of the selected line.
 *
 * The names resolve as one skin, chosen in the header and kept per object. A header plays one
 * simulated trigger, and its menu plays every resolved line. Picked rules take a chance knob,
 * the inspector's fields, Delete, Ctrl+D and the moves together, each as one undo step. Per
 * "Voice lines" in docs/ux/CONTEXTUAL_VOICE.md.
 */
function VoiceLinesView({ view, editable, path }: VoiceLinesViewProps) {
  const objectCommands = useObjectCommands();
  const remembered = useVoiceSkin(view.entry);
  const choose = useChooseVoiceSkin();
  const read = useVoiceLines(view.document, view.entry, remembered);
  const data = read.data;

  const [folded, setFolded] = useState<ReadonlySet<string>>(() => new Set());
  const [filter, setFilter] = useState("");
  const [onlyUnresolved, setOnlyUnresolved] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [cellName, setCellName] = useState<LineCell>("short");
  const [entering, setEntering] = useState<string | null>(null);
  const [trigger, setTrigger] = useState<TriggerContext>(ANY_TRIGGER);
  const [menuRow, setMenuRow] = useState<VoiceLineRow | null>(null);
  const inspecting = useAudioInspector();
  const setInspecting = useSetAudioInspector();
  const player = useLinePlayer();
  const copy = useCopyToClipboard();
  const toast = useToast();
  const open = useOpenDocumentAs();
  const askBank = useBankEventStore((state) => state.ask);
  const list = useRef<HTMLDivElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const looping = usePreviewRepeat() === "loop";

  const send = useVoiceEdit(view);
  const object = view.objectName(view.entry);
  const copyForSkin = useCopyForSkin({ ...view, object });

  const rows = useMemo(
    () =>
      data === undefined
        ? []
        : voiceLineRows(data.lines, folded, { text: filter, unresolved: onlyUnresolved }, editable),
    [data, folded, filter, onlyUnresolved, editable],
  );
  const groups = useMemo(() => rowGroups(rows), [rows]);
  const ruleRows = useMemo(
    () => new Map(rows.flatMap((row) => (row.kind === "rule" ? [[row.key, row] as const] : []))),
    [rows],
  );
  const picks = useTreePicks<RuleRow>(ruleRows, selected, setSelected);
  const choices = useMemo(
    () => (data === undefined ? { spells: [], targets: [] } : triggerChoices(data.lines)),
    [data],
  );

  const listId = useId();
  const toggleLoop = useToggleLoop();
  const nudgeVolume = useNudgeVolume();
  const typeAhead = useTypeAhead(
    () => rows.map(lineLabel),
    rows.findIndex((row) => row.key === selected),
    (index) => selectAt(index),
  );
  /* `handleDrop` and `selectAt` are hoisted, and a drop or a key reads them after this render. */
  useRowDrops(list, handleDrop);

  const focus = useRuleFocus(view.entry);
  const settled = useRef(0);
  useEffect(() => {
    if (focus === null || focus.serial === settled.current) return;

    settled.current = focus.serial;
    const key = `r:${focus.path.slice(SITUATIONS_PREFIX)}`;
    setSelected(key);
    requestAnimationFrame(() =>
      document.getElementById(rowId(key))?.scrollIntoView({ block: "center" }),
    );
  }, [focus]);

  if (read.error !== null && data === undefined) {
    return <EmptyState size="sm" title={m.audio_voice_failed_empty()} />;
  }
  if (data === undefined) {
    return (
      <div className="flex justify-center py-6">
        <Spinner />
      </div>
    );
  }

  const skin = data.skins.find((each) => each.bin === data.skin) ?? null;
  const selectedIndex = rows.findIndex((row) => row.key === selected);
  const selectedRow = rows[selectedIndex];
  const picked = (row: VoiceLineRow): RuleRow[] => {
    if (row.kind !== "rule") return [];
    return picks.picked.has(row.key) && picks.targets.length > 1 ? [...picks.targets] : [row];
  };

  function editSituations(edits: readonly ValueEdit[]): Promise<boolean> {
    return send(situationsEdit(view.entry, edits));
  }

  function editObject(edit: BinEdit): Promise<boolean> {
    return send(edit);
  }

  function lineOf(rule: VoiceRule): AudienceLine | null {
    return lineFor(rule, trigger.audience) ?? audienceSummary(rule.audio).line;
  }

  function playRule(rule: VoiceRule, line: AudienceLine | null = lineOf(rule)) {
    if (line?.event == null) return;
    player.play({ key: `${rule.path}:${line.audience}`, event: line.event });
  }

  function playSituation(situation: VoiceSituation) {
    const rule = simulateTrigger(situation, trigger, Math.random);
    const line = rule === null ? null : lineFor(rule, trigger.audience);
    if (rule === null || line?.event == null) {
      toast.info(m.audio_voice_play_none_label());
      return;
    }

    player.play({ key: `s:${situation.path}`, event: line.event });
  }

  function playAll(situation: VoiceSituation) {
    player.playAll(
      situation.rules.flatMap((rule) => {
        const line = lineOf(rule);
        return line?.event == null
          ? []
          : [{ key: `${rule.path}:${line.audience}`, event: line.event }];
      }),
    );
  }

  async function addRule(situation: VoiceSituation) {
    const text = await ruleTemplate(m.audio_voice_new_rule_name(), "");
    if (text === null) return;

    const added = `r:${rulesPath(situation)}[${situation.rules.length}]`;
    const landed = await editSituations([
      { type: "pasteItem", path: rulesPath(situation), index: null, text, unique: null },
    ]);
    if (!landed) return;

    setSelected(added);
    setEntering(`${added}:short`);
  }

  function chanceOf(row: RuleRow, percent: number) {
    const chances = picked(row).flatMap((each) => {
      const chance = ruleChance(each.rule);
      return chance === null ? [] : [chance];
    });
    return editSituations(chanceEdits(chances, percent));
  }

  /** Adds a chance to the picked rules of `row` that have none, then opens the entry of its knob. */
  async function addChance(row: RuleRow) {
    const landed = await editSituations(
      addChanceEdits(
        picked(row).map((each) => each.rule),
        NEW_CHANCE_PERCENT,
      ),
    );
    if (landed) setEntering(`${row.key}:chance`);
    return landed;
  }

  function composedName(rule: VoiceRule, line: AudienceLine): string | null {
    const spell = rule.conditions.find((each) => each.class === CLASS.spellName);
    const segment = spell === undefined ? null : spellOf(spell);
    return (
      line.candidates.find((name) => segment !== null && name.includes(`_${segment}_`)) ??
      line.candidates[0] ??
      null
    );
  }

  function actionsOf(row: VoiceLineRow): LineActions {
    const none: LineActions = {
      play: null,
      playAll: null,
      add: null,
      duplicate: null,
      remove: null,
      moveUp: null,
      moveDown: null,
      createEvent: null,
      showInBank: null,
      showInTree: null,
      copyShort: null,
      addChance: null,
      removeChance: null,
      pickRandom: null,
    };
    const pickRandom = (situation: VoiceSituation) =>
      editable
        ? {
            checked: situation.chooseRandom,
            toggle: () => void editSituations(randomEdits(situation)),
          }
        : null;
    const showInTree = (path: string) =>
      view.onShowInProperties === undefined
        ? null
        : () => view.onShowInProperties?.(rowKey({ entry: view.entry, path: objectPath(path) }));

    if (row.kind === "add")
      return { ...none, add: editable ? () => void addRule(row.situation) : null };
    if (row.kind === "situation") {
      return {
        ...none,
        play: () => playSituation(row.situation),
        playAll: () => playAll(row.situation),
        add: editable ? () => void addRule(row.situation) : null,
        showInTree: showInTree(row.situation.path),
        pickRandom: pickRandom(row.situation),
      };
    }

    const rules = picked(row);
    const line = lineOf(row.rule);
    const event = line?.event ?? null;
    const [bank] = data?.banks ?? [];
    const name = line === null || event !== null ? null : composedName(row.rule, line);
    const move = (to: number) =>
      editable && rules.length === 1 && to >= 0 && to < row.situation.rules.length
        ? () =>
            void editObject({
              kind: "moveItem",
              entry: view.entry,
              path: objectPath(row.rule.path),
              to,
            }).then((landed) => landed && setSelected(`r:${rulesPath(row.situation)}[${to}]`))
        : null;

    return {
      ...none,
      play: event === null ? null : () => playRule(row.rule),
      add: editable ? () => void addRule(row.situation) : null,
      duplicate: editable
        ? () =>
            void editSituations(
              situationsOf(rules).flatMap(([situation, group]) => duplicateEdits(situation, group)),
            )
        : null,
      remove: editable
        ? () => void editSituations(removeEdits(rules.map((each) => each.rule.path)))
        : null,
      moveUp: move(row.index - 1),
      moveDown: move(row.index + 1),
      createEvent:
        name === null || bank?.asset == null
          ? null
          : () => {
              const asset = bank.asset;
              if (asset === null) return;
              askBank(asset, { kind: "create", name });
              open(previewDocument(asset, bank.path), "default");
            },
      showInBank:
        event?.asset == null
          ? null
          : () => {
              const asset = event.asset;
              if (asset === null) return;
              askBank(asset, { kind: "show", event: event.id });
              open(previewDocument(asset, event.bank), "default");
            },
      showInTree: showInTree(row.rule.path),
      copyShort:
        line === null ? null : () => void copy(line.short, m.audio_voice_copy_short_action()),
      addChance:
        editable && rules.some((each) => ruleChance(each.rule) === null)
          ? () => void addChance(row)
          : null,
      removeChance:
        editable && rules.some((each) => ruleChance(each.rule) !== null)
          ? () => void editSituations(removeChanceEdits(rules.map((each) => each.rule)))
          : null,
      pickRandom: pickRandom(row.situation),
    };
  }

  function fold(row: VoiceLineRow, next: boolean) {
    setFolded((current) => {
      const updated = new Set(current);
      if (next) updated.delete(row.key);
      else updated.add(row.key);
      return updated;
    });
  }

  function selectAt(index: number, range = false) {
    const row = rows[Math.max(0, Math.min(rows.length - 1, index))];
    if (row === undefined) return;

    picks.pick(row.key, range ? "range" : "only");
    document.getElementById(rowId(row.key))?.scrollIntoView({ block: "nearest" });
  }

  function activeCell(row: VoiceLineRow | undefined): LineCell | null {
    if (row === undefined) return null;
    const cells = lineCells(row);
    return cells.includes(cellName) ? cellName : (cells[0] ?? null);
  }

  function returnFocus() {
    requestAnimationFrame(() => {
      const active = document.activeElement;
      if (active === null || active === document.body) list.current?.focus();
    });
  }

  /** Moves between the cells of a rule with ArrowLeft and ArrowRight, then folds or walks the list. */
  function stepCells(key: string, row: VoiceLineRow) {
    const cells = lineCells(row);
    const at = cells.indexOf(activeCell(row) ?? "short");
    const next = cells[at + (key === "ArrowRight" ? 1 : -1)];
    if (row.kind === "rule" && next !== undefined) {
      setCellName(next);
      return;
    }

    const openKeys = new Set(rows.flatMap((each) => (each.open ? [each.key] : [])));
    const step = treeStep(key, rows, selectedIndex, openKeys);
    if (step?.kind === "expand") {
      const stepped = rows.find((each) => each.key === step.key);
      if (stepped !== undefined) fold(stepped, step.open);
    }
    if (step?.kind === "select") selectAt(step.index);
  }

  /** Plays `row`, or stops what plays if it is `row`. */
  function togglePlay(row: VoiceLineRow) {
    if (isPlaying(row, player.playing)) {
      player.stop();
      return;
    }

    actionsOf(row).play?.();
  }

  /**
   * Runs `command`, which the key `key` resolved to, on the selected `row`.
   *
   * Returns `true` if the list answers the key, which then reaches no handler above the list.
   */
  function run(command: AudioCommandId, key: string, row: VoiceLineRow | undefined): boolean {
    switch (command) {
      case "moveRow":
      case "movePage":
      case "moveEnd":
      case "extendRange": {
        const page = pageRows(list.current, LINE_HEIGHT);
        const target = movedIndex(key, selectedIndex, rows.length, page);
        if (target !== null) selectAt(target, command === "extendRange");
        return true;
      }
      case "nextEvent":
      case "previousEvent": {
        const at = headIndex(rows, selectedIndex, command === "nextEvent" ? 1 : -1, "situation");
        if (at !== null) selectAt(at);
        return true;
      }
      case "selectAll":
        picks.pickAll();
        return true;
      default:
        break;
    }

    if (row === undefined) return false;

    const actions = actionsOf(row);
    switch (command) {
      case "play":
        togglePlay(row);
        return true;
      case "playAll":
        if (row.kind !== "add") playAll(row.situation);
        return true;
      case "stop":
        if (player.playing !== null) player.stop();
        else if (picks.picked.size > 1) picks.pick(row.key, "only");
        else return false;
        return true;
      case "stepRight":
      case "stepLeft":
        stepCells(key, row);
        return true;
      case "enter": {
        const cell = activeCell(row);
        if (row.kind === "rule" && cell === "chance" && ruleChance(row.rule) === null) {
          actions.addChance?.();
        } else if (row.kind === "rule" && cell !== null && editable) {
          setEntering(`${row.key}:${cell}`);
        } else if (row.kind === "add") actions.add?.();
        else if (key === "Enter") actions.play?.();
        return true;
      }
      case "add":
        actions.add?.();
        return true;
      case "duplicate":
        actions.duplicate?.();
        return true;
      case "remove":
        actions.remove?.();
        return true;
      case "moveUp":
        actions.moveUp?.();
        return true;
      case "moveDown":
        actions.moveDown?.();
        return true;
      case "copy":
        actions.copyShort?.();
        return true;
      default:
        return false;
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.target !== event.currentTarget) return;

    const command = resolveCommand(event, "lines");
    const handled = command === null ? typeAhead(event) : run(command, event.key, selectedRow);
    if (!handled) return;

    event.preventDefault();
    event.stopPropagation();
  }

  /* The view sits in a bin document with no audio document around it, so it answers the document
     keys that apply to it, from anywhere in the view but a text field. */
  function handleViewKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (typesText(event.target)) return;

    const command = resolveCommand(event, "lines");
    const viewKeys: Partial<Record<AudioCommandId, () => void>> = {
      loop: toggleLoop,
      volumeDown: () => nudgeVolume(-1),
      volumeUp: () => nudgeVolume(1),
      toggleInspector: () => setInspecting(!inspecting),
    };
    const runView = command === null ? undefined : viewKeys[command];
    if (runView === undefined) return;

    event.preventDefault();
    event.stopPropagation();
    runView();
  }

  /** Returns what a drop on `row` reads, or null for a row that takes no drop. */
  function slotOf(row: VoiceLineRow): DropSlot | null {
    if (!editable || row.kind !== "rule") return null;

    return { kind: "rule", key: row.key, place: { list: row.situation.path, index: row.index } };
  }

  /** Points the rule `rule` at the event `name` through the short name of its drawn line. */
  function targetRule(row: RuleRow, name: string) {
    const spell = row.rule.conditions.find((each) => each.class === CLASS.spellName);
    const segment = spell === undefined ? null : spellOf(spell);
    const short = ruleShortName(name, skin?.tags ?? [], segment);
    if (short === null) {
      toast.info(m.audio_drop_target_refused_description({ name }));
      return;
    }

    const audience = audienceSummary(row.rule.audio).line?.audience ?? "owner";
    void editSituations(shortNameEdits(row.rule.path, audience, short));
  }

  /** Runs a drop of `payload` on the row `key`. Returns `true` if the row took it. */
  function handleDrop(key: string, payload: DragPayload): boolean {
    const row = rows.find((each) => each.key === key);
    const slot = row === undefined ? null : slotOf(row);
    const action = slot === null ? null : dropAction(payload, slot);
    if (row?.kind !== "rule" || action === null) return false;

    if (action.kind === "move") {
      const moved = rows.find((each) => each.key === action.key);
      if (moved?.kind === "rule") void moveRule(moved, action.index);
    }
    if (action.kind === "target") targetRule(row, action.name);
    return true;
  }

  /** Moves the rule of `row` to `index` of its situation, and selects it there. */
  async function moveRule(row: RuleRow, index: number) {
    const landed = await editObject({
      kind: "moveItem",
      entry: view.entry,
      path: objectPath(row.rule.path),
      to: index,
    });
    if (landed) setSelected(`r:${rulesPath(row.situation)}[${index}]`);
  }

  const subject: InspectorSubject | null =
    selectedRow?.kind === "situation"
      ? { kind: "situation", situation: selectedRow.situation }
      : picks.targets.length > 0
        ? { kind: "rules", rules: picks.targets.map((each) => each.rule) }
        : selectedRow?.kind === "rule"
          ? { kind: "rules", rules: [selectedRow.rule] }
          : null;

  function line(row: VoiceLineRow) {
    const playing = isPlaying(row, player.playing);
    const selectedLine = row.key === selected || picks.picked.has(row.key);
    const slot = slotOf(row);
    const frame = {
      row,
      open: row.open,
      selected: selectedLine,
      playing,
      drops: slot === null ? undefined : ("row" as const),
      onDragPress:
        slot === null || slot.kind !== "rule"
          ? undefined
          : (event: ReactPointerEvent) =>
              beginRowDrag(
                event,
                { kind: "row", key: row.key, place: slot.place },
                listId,
                lineLabel(row),
              ),
      onPlay: row.kind === "add" ? undefined : () => togglePlay(row),
      onSelect: (event: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }) =>
        picks.pick(row.key, pickMode(event)),
      onExpand: (next: boolean) => fold(row, next),
      onHover: () => undefined,
    };
    if (row.kind === "situation") {
      const resolved = row.situation.rules.some(
        (rule) => lineFor(rule, trigger.audience)?.event != null,
      );
      return (
        <RowFrame {...frame}>
          <span
            className="flex cursor-pointer"
            onClick={(event) => {
              event.stopPropagation();
              fold(row, !row.open);
            }}
          >
            <RowCaret expandable expanded={row.open} />
          </span>
          <SituationText
            situation={row.situation}
            onToggleRandom={editable ? () => void editSituations(randomEdits(row.situation)) : null}
          />
          <span className="ml-auto flex">
            <PlayButton
              playable={resolved}
              playing={player.playing === `s:${row.situation.path}`}
              muted
              onToggle={() =>
                player.playing === null ? playSituation(row.situation) : player.stop()
              }
            />
          </span>
        </RowFrame>
      );
    }
    if (row.kind === "add") {
      return (
        <RowFrame {...frame}>
          <LeadSlots />
          <AddRuleLine onAdd={() => void addRule(row.situation)} />
        </RowFrame>
      );
    }

    const shown = lineOf(row.rule);
    const enteringCell = entering?.startsWith(`${row.key}:`)
      ? (entering.slice(row.key.length + 1) as LineCell)
      : null;
    return (
      <RowFrame
        {...frame}
        onEdit={
          editable ? () => setEntering(`${row.key}:${activeCell(row) ?? "short"}`) : undefined
        }
      >
        <span className="w-3 shrink-0" />
        <span
          className={twMerge(
            "flex",
            !selectedLine && !playing && "opacity-0 group-hover/row:opacity-100",
          )}
        >
          <PlayButton
            playable={shown?.event != null}
            playing={playing}
            muted
            onToggle={() => (playing ? player.stop() : playRule(row.rule))}
          />
        </span>
        <RuleCells
          row={row}
          active={row.key === selected ? activeCell(row) : null}
          entering={enteringCell}
          onEntering={(cell) => {
            setEntering(cell === null ? null : `${row.key}:${cell}`);
            if (cell === null) returnFocus();
          }}
          tags={skin?.tags ?? []}
          banks={data?.banks ?? []}
          edits={
            editable
              ? {
                  chance: (percent) => chanceOf(row, percent),
                  addChance: () => addChance(row),
                  weight: (weight) =>
                    editSituations(
                      picked(row).flatMap((each) =>
                        topicEdits(each.rule.path, "chanceWeight", weight),
                      ),
                    ),
                  name: (name) =>
                    editSituations([
                      {
                        type: "setLeaf",
                        path: fieldPath(row.rule.path, "mRuleName"),
                        value: { type: "string", value: name },
                      },
                    ]),
                  priority: (priority) =>
                    editSituations(
                      picked(row).flatMap((each) => priorityEdits(each.rule.path, priority)),
                    ),
                  short: (short) =>
                    editSituations(
                      shortNameEdits(
                        row.rule.path,
                        audienceSummary(row.rule.audio).line?.audience ?? "owner",
                        short,
                      ),
                    ),
                }
              : null
          }
        />
      </RowFrame>
    );
  }

  const situationKeys = data.lines.situations.map(situationKey);
  const collapsed = situationKeys.length > 0 && situationKeys.every((key) => folded.has(key));

  function rowWithMenu(row: VoiceLineRow) {
    return (
      <div
        key={row.key}
        onContextMenu={() => {
          if (!picks.picked.has(row.key)) picks.pick(row.key, "only");
          setMenuRow(row);
        }}
      >
        {line(row)}
      </div>
    );
  }

  const menuCommands: Partial<Record<AudioCommandId, () => void>> = {
    save: objectCommands.save ?? undefined,
    undo: objectCommands.undo ?? undefined,
    redo: objectCommands.redo ?? undefined,
    ...lineCommands(selectedRow === undefined ? null : actionsOf(selectedRow)),
    play:
      selectedRow === undefined || selectedRow.kind === "add"
        ? undefined
        : () => togglePlay(selectedRow),
    playAll:
      selectedRow === undefined || selectedRow.kind === "add"
        ? undefined
        : () => playAll(selectedRow.situation),
    stop: player.playing === null ? undefined : () => player.stop(),
    loop: toggleLoop,
    volumeUp: () => nudgeVolume(1),
    volumeDown: () => nudgeVolume(-1),
    selectAll: ruleRows.size === 0 ? undefined : () => picks.pickAll(),
    toggleInspector: () => setInspecting(!inspecting),
    expandAll: folded.size === 0 ? undefined : () => setFolded(new Set()),
    collapseAll: collapsed ? undefined : () => setFolded(new Set(situationKeys)),
    help: () => openKeySheet(),
    copyForSkin: editable && skin !== null ? () => void copyForSkin(skin) : undefined,
  };

  return (
    <div
      ref={root}
      data-ui="VoiceLinesView"
      className="flex flex-col rounded-md border border-surface-700/50 bg-surface-900"
      onKeyDown={handleViewKeyDown}
    >
      <VoiceLinesHeader
        data={data}
        onSkin={(bin) => choose(view.entry, bin)}
        onCooldown={editable ? (seconds) => editObject(cooldownEdit(view.entry, seconds)) : null}
        filter={filter}
        onFilter={setFilter}
        unresolved={unresolvedCount(data.lines)}
        onlyUnresolved={onlyUnresolved}
        onOnlyUnresolved={setOnlyUnresolved}
        trigger={trigger}
        onTrigger={setTrigger}
        choices={choices}
        path={path}
        menubar={
          <AudioMenubar
            facts={{
              surfaces: LINES_SURFACES,
              hidden: [],
              commands: menuCommands,
              checked: {
                toggleInspector: inspecting,
                loop: looping,
                pickRandom: selectedRow?.situation.chooseRandom === true,
              },
              reasons: selectedRow === undefined ? selectRowReasons() : {},
            }}
            slots={{
              volume: <VolumeReadout />,
              fileActions: <ObjectFileItems />,
              editActions: <ObjectEditItems />,
              viewActions: <ObjectViewItems part="mode" />,
            }}
            titles={{
              add: m.audio_voice_add_rule_action(),
              playAll: m.audio_voice_play_all_action(),
              copy: m.audio_voice_copy_short_action(),
              remove: m.audio_voice_delete_action(),
            }}
            keyScope={root}
            experimental={false}
          />
        }
      />
      <div className="flex min-w-0 items-start">
        <ContextMenu.Root>
          <ContextMenu.Trigger
            ref={list}
            role="tree"
            tabIndex={0}
            aria-label={m.audio_voice_list_label()}
            aria-multiselectable
            aria-activedescendant={selected === null ? undefined : rowId(selected)}
            onKeyDown={handleKeyDown}
            onContextMenuCapture={() => setMenuRow(selectedRow ?? null)}
            onFocus={(event) => {
              if (event.target === event.currentTarget && selectedIndex < 0) selectAt(0);
            }}
            data-ui="VoiceLinesView:list"
            className={twMerge(
              AUDIO_LIST_GROUP,
              "min-w-0 flex-1 overflow-x-clip pb-1 select-none focus-visible:outline-none",
            )}
          >
            <div className={twMerge(STICKY_GROUND, "top-0 z-10 border-b border-surface-700/50")}>
              <ColumnHeads />
            </div>
            {rows.length === 0 && (
              <p className="px-3 py-2 text-meta text-surface-400">{m.audio_voice_empty()}</p>
            )}
            {groups.map((group, at) => {
              const [head, ...rest] = group.rows;
              return (
                <div
                  key={group.key}
                  className={twMerge("flex flex-col", at > 0 && "border-t border-surface-700/40")}
                >
                  {head !== undefined && (
                    <div className={twMerge(STICKY_GROUND, "top-[calc(1.5rem+1px)] z-[5]")}>
                      <div className="bg-surface-veil-soft">{rowWithMenu(head.row)}</div>
                    </div>
                  )}
                  {rest.map((each) => rowWithMenu(each.row))}
                </div>
              );
            })}
          </ContextMenu.Trigger>
          {menuRow !== null && (
            <ContextMenu.Content>
              <VoiceLineMenu actions={actionsOf(menuRow)} />
            </ContextMenu.Content>
          )}
        </ContextMenu.Root>
        {inspecting && (
          <div className="sticky top-0 self-start">
            <VoiceLineInspector
              subject={subject}
              document={view.document}
              entry={view.entry}
              onEdit={editable ? editSituations : null}
              onPlay={(rule, shownLine) => playRule(rule, shownLine)}
              playing={player.playing}
            />
          </div>
        )}
      </div>
      <RowDragGhost source={listId} />
    </div>
  );
}

/**
 * The ground of the column heads and the situation headers, opaque since the rules scroll under
 * them. A situation header sticks below the heads, whose 1.5rem row and 1px rule it clears.
 */
const STICKY_GROUND = "sticky bg-surface-900";

/** The height of a line in px at 100% zoom, which a page of the list counts. */
const LINE_HEIGHT = 27;

/** Returns the name that the type-ahead matches and the drag ghost shows for `row`. */
function lineLabel(row: VoiceLineRow): string {
  if (row.kind === "situation") return row.situation.name ?? row.situation.path;
  if (row.kind === "rule")
    return audienceSummary(row.rule.audio).line?.short ?? row.rule.name ?? "";

  return "";
}

/** Returns `true` if `playing`, the key of what plays, is a line of `row` or its situation. */
function isPlaying(row: VoiceLineRow, playing: string | null): boolean {
  if (playing === null) return false;
  if (row.kind === "situation") return playing === `s:${row.situation.path}`;
  if (row.kind === "rule") return playing.startsWith(`${row.rule.path}:`);
  return false;
}

/** The percent of a chance that Add chance writes, which plays the line as it played before. */
const NEW_CHANCE_PERCENT = 100;

/** Returns the edits that turn random choice of `situation` on, or off where it is on. */
function randomEdits(situation: VoiceSituation): ValueEdit[] {
  return topicEdits(situation.path, "chooseRandom", !situation.chooseRandom);
}

/** The surface of the view, whose commands the menu bar lists. */
const LINES_SURFACES: readonly AudioSurface[] = ["lines"];

/** The commands of the selected line that wait for a selection, each with the reason. */
function selectRowReasons(): Partial<Record<AudioCommandId, string>> {
  const reason = m.audio_menu_select_row_reason();
  const ids: AudioCommandId[] = [
    "play",
    "playAll",
    "add",
    "duplicate",
    "remove",
    "moveUp",
    "moveDown",
    "copy",
    "createEvent",
    "showInBank",
    "showInTree",
    "addChance",
    "removeChance",
    "pickRandom",
  ];

  return Object.fromEntries(ids.map((id) => [id, reason]));
}

/** Returns the menu commands of the line whose menu runs `actions`, or none without a line. */
function lineCommands(actions: LineActions | null): Partial<Record<AudioCommandId, () => void>> {
  if (actions === null) return {};

  return {
    add: actions.add ?? undefined,
    duplicate: actions.duplicate ?? undefined,
    remove: actions.remove ?? undefined,
    moveUp: actions.moveUp ?? undefined,
    moveDown: actions.moveDown ?? undefined,
    copy: actions.copyShort ?? undefined,
    addChance: actions.addChance ?? undefined,
    removeChance: actions.removeChance ?? undefined,
    pickRandom: actions.pickRandom?.toggle,
    createEvent: actions.createEvent ?? undefined,
    showInBank: actions.showInBank ?? undefined,
    showInTree: actions.showInTree ?? undefined,
  };
}

/** Returns `rules` grouped by their situation, in the order of their first rule. */
function situationsOf(rules: readonly RuleRow[]): [VoiceSituation, RuleRow[]][] {
  const groups = new Map<string, [VoiceSituation, RuleRow[]]>();
  for (const rule of rules) {
    const group = groups.get(rule.situation.path) ?? [rule.situation, []];
    group[1].push(rule);
    groups.set(rule.situation.path, group);
  }
  return [...groups.values()];
}
