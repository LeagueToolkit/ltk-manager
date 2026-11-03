import { type KeyboardEvent as ReactKeyboardEvent, useMemo } from "react";

import { useCopyToClipboard } from "@/hooks";
import { m } from "@/i18n";
import type { PropertyEdit } from "@/lib/tauri";

import { objectDocument } from "../../../documents/utils/contentDocument";
import type { OpenIntent } from "../../../palette/utils/types";
import { useOpenDocumentAs } from "../../../state";
import {
  type PaneCommand,
  type PaneCommands,
  type PaneFocusProps,
  usePaneCommands,
} from "../../menus/state/paneCommands";
import { alignEdits, distributeEdits } from "../engine/edit/arrange";
import { layerEdits, sceneMoveEdits } from "../engine/edit/targets";
import type { LayoutSettings, PixelRect } from "../engine/layout/solve";
import { labelOf } from "../engine/model/layers";
import { exportedSprite } from "../engine/model/sprites";
import { sceneOf, type ViewTree } from "../engine/model/tree";
import type { View } from "../engine/model/view";
import { type ElementDeleter, useDeleteElements } from "../hooks/useDeleteElements";
import { type ObjectGate, useObjectBlock } from "../hooks/useObjectBlock";
import { type SpriteExport, useSpriteExport } from "../hooks/useSpriteExport";
import type { AtlasEdit } from "../state/atlasEdit";
import { useAtlasPreviewActions } from "../state/atlasPreview";
import {
  alignCommand,
  arrangeCommand,
  ATLAS_COMMANDS,
  listedCommand,
} from "../utils/atlasCommands";
import { editReason, objectBlockReason } from "../utils/atlasReasons";
import { ALIGNMENTS, LAYER_STEPS } from "./arrangeTables";
import { elementsAt } from "./canvasGeometry";
import {
  type CanvasAction,
  canvasKey,
  isSelectAllKey,
  type KeyTargets,
  runCanvasAction,
} from "./canvasKeys";
import { previewKey } from "./previewKeys";
import { type ViewTransformControl, ZOOM_MAX, ZOOM_MIN } from "./useViewTransform";

const CANVAS_SOURCE = "atlas.canvas";

/** How many source pixels an arrow key nudges by, and with Shift down. */
const NUDGE = 1;
const NUDGE_FAR = 10;

const MIN_ALIGNED = 2;
const MIN_DISTRIBUTED = 3;

export interface CanvasCommandInputs {
  readonly view: string;
  /** The canvas draws one element of a scene bin, whose keys delete nothing. */
  readonly focus: boolean;
  readonly source: View | null;
  readonly tree: ViewTree | null;
  readonly settings: LayoutSettings;
  /** Each element's rect on the screen. */
  readonly solved: ReadonlyMap<string, PixelRect> | null;
  /** Each element's rect on the board. */
  readonly placed: ReadonlyMap<string, PixelRect> | null;
  /** The drawn elements, bottom first. */
  readonly order: readonly string[];
  /** The elements that select all takes, null for every element of `tree`. */
  readonly only: ReadonlySet<string> | null;
  readonly selection: readonly string[];
  readonly selected: string | null;
  readonly hiddenElements: ReadonlySet<string>;
  readonly hiddenScenes: ReadonlySet<string>;
  /** Each element's rect as the canvas draws it, with a drag applied. */
  readonly shown: ReadonlyMap<string, PixelRect> | null;
  readonly nudge: (dx: number, dy: number) => void;
  readonly transform: ViewTransformControl;
  readonly edit: AtlasEdit | null;
}

/** The commands of the canvas as its surface reads them. */
export interface CanvasCommands {
  readonly paneFocus: PaneFocusProps;
  /** Runs the action of a key of the focused canvas, and returns whether it had one. */
  readonly answerKey: (event: ReactKeyboardEvent) => boolean;
}

/** What the builders of the offers read beside the inputs. */
interface CommandContext extends CanvasCommandInputs {
  readonly targets: KeyTargets;
  readonly deleter: ElementDeleter;
  readonly gate: ObjectGate;
  readonly exports: SpriteExport;
  readonly actions: ReturnType<typeof useAtlasPreviewActions>;
  readonly open: ReturnType<typeof useOpenDocumentAs>;
  readonly copy: ReturnType<typeof useCopyToClipboard>;
  /** The elements at the centre of the primary selection, topmost first. */
  readonly stack: readonly string[];
  readonly editable: boolean;
  /** The reason that an edit of the selection is disabled. */
  readonly editBlocked: string;
}

/**
 * Offers the actions of the canvas to the menu bar of its tab, and answers the canvas's keys.
 *
 * The canvas stays mounted in Properties mode and in the stack frame, so the bar reads these offers
 * in both. A key and its item run one action through `runCanvasAction`.
 */
export function useCanvasCommands(inputs: CanvasCommandInputs): CanvasCommands {
  const { view, focus, tree, only, placed, order, selection, selected, shown, edit } = inputs;
  const actions = useAtlasPreviewActions();
  const open = useOpenDocumentAs();
  const copy = useCopyToClipboard();
  const deleter = useDeleteElements(view, tree);
  const gate = useObjectBlock(view);
  const exports = useSpriteExport();

  const targetsAt = (step: number): KeyTargets => ({
    transform: inputs.transform,
    selected: selected === null ? null : (shown?.get(selected) ?? null),
    clear: () => actions.select(view, null),
    nudge: (dx, dy) => inputs.nudge(dx * step, dy * step),
    remove: () => void deleter.run(focus ? [] : selection),
    arrange: (layerStep) => {
      if (tree !== null && selected !== null && edit?.editable === true) {
        void edit.apply(layerEdits(tree, selected, layerStep));
      }
    },
  });

  const answerKey = (event: ReactKeyboardEvent): boolean => {
    if (isSelectAllKey(event) && tree !== null) {
      actions.setSelection(view, [...(only ?? tree.elements.keys())]);
      return true;
    }

    if (event.ctrlKey || event.metaKey || event.altKey) return false;
    if (previewKey(event, actions)) return true;

    return canvasKey(event, targetsAt(event.shiftKey ? NUDGE_FAR : NUDGE));
  };

  const stack = useMemo(() => {
    const rect = selected === null ? undefined : placed?.get(selected);
    if (rect === undefined || placed === null) return [];

    return elementsAt(order, placed, rect.x + rect.w / 2, rect.y + rect.h / 2);
  }, [selected, placed, order]);

  const editable = edit?.editable === true;
  const editBlocked = editable ? m.workshop_bin_menu_atlas_selection_reason() : editReason(edit);

  const paneFocus = usePaneCommands(
    CANVAS_SOURCE,
    canvasCommands({
      ...inputs,
      targets: targetsAt(NUDGE),
      deleter,
      gate,
      exports,
      actions,
      open,
      copy,
      stack,
      editable,
      editBlocked,
    }),
  );

  return { paneFocus, answerKey };
}

function canvasCommands(context: CommandContext): PaneCommands {
  const { targets, transform, tree, view, only, focus, actions } = context;
  const zoom = transform.view.zoom;
  const action = (each: CanvasAction): PaneCommand => ({
    run: () => runCanvasAction(each, targets),
  });

  const commands: Record<string, PaneCommand> = {
    [ATLAS_COMMANDS.fit]: action("fit"),
    [ATLAS_COMMANDS.actual]: action("actual"),
    [ATLAS_COMMANDS.zoomIn]: limited(action("zoomIn"), zoom >= ZOOM_MAX),
    [ATLAS_COMMANDS.zoomOut]: limited(action("zoomOut"), zoom <= ZOOM_MIN),
    [ATLAS_COMMANDS.frame]: {
      ...action("frame"),
      title:
        context.selected === null
          ? m.workshop_preview_zoom_fit_label()
          : m.workshop_bin_menu_atlas_frame_selection_action(),
    },
    [ATLAS_COMMANDS.nudgeLeft]: selectionEdit(context, "nudgeLeft"),
    [ATLAS_COMMANDS.nudgeRight]: selectionEdit(context, "nudgeRight"),
    [ATLAS_COMMANDS.nudgeUp]: selectionEdit(context, "nudgeUp"),
    [ATLAS_COMMANDS.nudgeDown]: selectionEdit(context, "nudgeDown"),
    [ATLAS_COMMANDS.selectAll]: {
      run:
        tree === null
          ? null
          : () => actions.setSelection(view, [...(only ?? tree.elements.keys())]),
    },
    ...selectedElementCommands(context),
    ...layerRows(context),
    ...sceneRows(context),
  };

  for (const { step } of LAYER_STEPS) {
    commands[arrangeCommand(step)] = selectionEdit(context, step);
  }

  const alignReason = m.workshop_bin_menu_atlas_align_reason();
  for (const { how } of ALIGNMENTS) {
    commands[alignCommand(how)] = arranged(context, MIN_ALIGNED, alignReason, (each, solved) =>
      alignEdits(each, context.settings, solved, context.selection, how),
    );
  }

  const distributeReason = m.workshop_bin_menu_atlas_distribute_reason();
  commands[ATLAS_COMMANDS.distributeHorizontal] = arranged(
    context,
    MIN_DISTRIBUTED,
    distributeReason,
    (each, solved) => distributeEdits(each, context.settings, solved, context.selection, 0),
  );
  commands[ATLAS_COMMANDS.distributeVertical] = arranged(
    context,
    MIN_DISTRIBUTED,
    distributeReason,
    (each, solved) => distributeEdits(each, context.settings, solved, context.selection, 1),
  );

  if (!focus) commands[ATLAS_COMMANDS.delete] = deleteCommand(context);

  return commands;
}

function selectionEdit(context: CommandContext, action: CanvasAction): PaneCommand {
  const { editable, selected, targets, editBlocked } = context;

  return {
    run: editable && selected !== null ? () => runCanvasAction(action, targets) : null,
    reason: editBlocked,
  };
}

/** Returns an edit of the whole selection that needs at least `minimum` elements selected. */
function arranged(
  context: CommandContext,
  minimum: number,
  reason: string,
  edits: (tree: ViewTree, solved: ReadonlyMap<string, PixelRect>) => readonly PropertyEdit[],
): PaneCommand {
  const { edit, tree, solved, selection, editable } = context;
  if (!editable || edit === null) return { run: null, reason: editReason(edit) };
  if (tree === null || solved === null || selection.length < minimum) return { run: null, reason };

  return { run: () => void edit.apply(edits(tree, solved)) };
}

function deleteCommand({ deleter, gate, edit, selection, targets }: CommandContext): PaneCommand {
  if (!deleter.available) return { run: null, reason: objectBlockReason(gate, edit) };
  if (selection.length === 0) {
    return { run: null, reason: m.workshop_bin_menu_atlas_selection_reason() };
  }

  return { run: () => runCanvasAction("delete", targets) };
}

/** Returns the commands that act on the primary selection and write no edit. */
function selectedElementCommands(context: CommandContext): PaneCommands {
  const { tree, selected, view, actions, copy, exports, hiddenElements, hiddenScenes } = context;
  const target = selected === null ? undefined : tree?.elements.get(selected);
  if (target === undefined || tree === null) {
    const idle: PaneCommand = { run: null, reason: m.workshop_bin_menu_atlas_selection_reason() };

    return {
      [ATLAS_COMMANDS.selectGroup]: idle,
      [ATLAS_COMMANDS.copyName]: idle,
      [ATLAS_COMMANDS.copyPath]: idle,
      [ATLAS_COMMANDS.openObject]: idle,
      [ATLAS_COMMANDS.openBeside]: idle,
      [ATLAS_COMMANDS.spriteExport]: idle,
      [ATLAS_COMMANDS.hideElement]: idle,
      [ATLAS_COMMANDS.hideScene]: idle,
    };
  }

  const group = tree.groupOf.get(target.key);
  const path = target.path ?? target.label;
  const sprite = exportedSprite(tree, target.key);
  const scene = sceneOf(tree, target.key);
  const sceneNode = scene === null ? undefined : tree.scenes.get(scene);
  const sceneLabel =
    sceneNode === undefined ? "" : labelOf(sceneNode.label, sceneNode.path, sceneNode.key);

  return {
    [ATLAS_COMMANDS.selectGroup]:
      group === undefined
        ? { run: null, reason: m.workshop_bin_menu_atlas_group_reason() }
        : { run: () => actions.select(view, group) },
    [ATLAS_COMMANDS.copyName]: {
      run: () => void copy(target.label, m.workshop_bin_name_label()),
    },
    [ATLAS_COMMANDS.copyPath]: { run: () => void copy(path, m.workshop_bin_path_label()) },
    [ATLAS_COMMANDS.openObject]: openElement(context, target.key, "default"),
    [ATLAS_COMMANDS.openBeside]: openElement(context, target.key, "beside"),
    [ATLAS_COMMANDS.spriteExport]:
      sprite === null
        ? { run: null, reason: m.workshop_bin_menu_atlas_image_reason() }
        : {
            run: exports.exporting ? null : () => void exports.run(sprite),
            title: m.workshop_bin_menu_atlas_export_action({ sprite: sprite.label }),
          },
    [ATLAS_COMMANDS.hideElement]: {
      run: () => actions.toggleElement(view, target.key),
      title: hiddenElements.has(target.key)
        ? m.workshop_bin_atlas_element_show_action()
        : m.workshop_bin_atlas_element_hide_action(),
    },
    [ATLAS_COMMANDS.hideScene]:
      scene === null || sceneNode === undefined
        ? { run: null, reason: m.workshop_bin_menu_atlas_scene_reason() }
        : {
            run: () => actions.toggleScene(view, scene),
            title: hiddenScenes.has(scene)
              ? m.workshop_bin_atlas_scene_show_action({ scene: sceneLabel })
              : m.workshop_bin_atlas_scene_hide_action({ scene: sceneLabel }),
          },
  };
}

function openElement(context: CommandContext, element: string, intent: OpenIntent): PaneCommand {
  const { source, tree, open } = context;
  const target = tree?.elements.get(element);
  const base = source?.files.find((file) => file.role === "base");
  const asset = base?.asset ?? null;
  if (target === undefined || base === undefined || asset === null) {
    return { run: null, reason: m.workshop_bin_menu_atlas_open_reason() };
  }

  const path = target.path ?? target.label;

  return {
    run: () => open(objectDocument(asset, target.key, path, base.path, target.class), intent),
  };
}

/** Returns the rows of Select layer, and the reason that the list holds none. */
function layerRows({ tree, stack, selected, view, actions }: CommandContext): PaneCommands {
  const rows: Record<string, PaneCommand> = {
    [ATLAS_COMMANDS.selectLayer]: {
      run: null,
      reason:
        selected === null
          ? m.workshop_bin_menu_atlas_selection_reason()
          : m.workshop_bin_menu_atlas_select_layer_reason(),
    },
  };
  if (stack.length < 2) return rows;

  stack.forEach((each, at) => {
    const node = tree?.elements.get(each);
    rows[listedCommand(ATLAS_COMMANDS.selectLayer, at)] = {
      run: () => actions.select(view, each),
      checked: each === selected,
      title: node === undefined ? each : labelOf(node.label, node.path, each),
    };
  });

  return rows;
}

/** Returns the rows of Move to scene, and the reason that the list holds none. */
function sceneRows({ tree, edit, selected, selection, editable, editBlocked }: CommandContext) {
  const rows: Record<string, PaneCommand> = {
    [ATLAS_COMMANDS.moveScene]: {
      run: null,
      reason:
        editable && selected !== null ? m.workshop_bin_menu_atlas_move_scene_reason() : editBlocked,
    },
  };
  if (!editable || edit === null || tree === null || selected === null) return rows;

  const current = sceneOf(tree, selected);
  [...tree.scenes.values()]
    .filter((scene) => scene.key !== current)
    .forEach((scene, at) => {
      rows[listedCommand(ATLAS_COMMANDS.moveScene, at)] = {
        run: () =>
          void edit.apply(selection.flatMap((each) => sceneMoveEdits(tree, each, scene.key))),
        title: labelOf(scene.label, scene.path, scene.key),
      };
    });

  return rows;
}

function limited(command: PaneCommand, atLimit: boolean): PaneCommand {
  if (!atLimit) return command;

  return { run: null, reason: m.workshop_bin_menu_atlas_zoom_limit_reason() };
}
