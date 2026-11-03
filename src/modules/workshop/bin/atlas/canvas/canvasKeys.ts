import { commandAt, type CommandId, isChord, type KeyPress, shortcutOf } from "@/modules/keys";

import type { LayerStep } from "../engine/edit/targets";
import type { PixelRect } from "../engine/layout/solve";
import { type ViewTransformControl, ZOOM_STEP } from "./useViewTransform";

/** An action that a key of the focused canvas runs. */
export type CanvasAction =
  | "frame"
  | "fit"
  | "actual"
  | "zoomIn"
  | "zoomOut"
  | "nudgeLeft"
  | "nudgeRight"
  | "nudgeUp"
  | "nudgeDown"
  | "forward"
  | "backward"
  | "front"
  | "back"
  | "delete"
  | "clear";

/** The registry command of each action. */
const ACTION_COMMANDS = {
  frame: "atlas.frame",
  fit: "atlas.fit",
  actual: "atlas.actual",
  zoomIn: "atlas.zoomIn",
  zoomOut: "atlas.zoomOut",
  nudgeLeft: "atlas.nudgeLeft",
  nudgeRight: "atlas.nudgeRight",
  nudgeUp: "atlas.nudgeUp",
  nudgeDown: "atlas.nudgeDown",
  forward: "atlas.forward",
  backward: "atlas.backward",
  front: "atlas.front",
  back: "atlas.back",
  delete: "atlas.delete",
  clear: "atlas.clear",
} as const satisfies Readonly<Record<CanvasAction, CommandId>>;

/** The registry command of each action and the keycaps that a surface shows for it. */
export const CANVAS_BINDINGS: Readonly<
  Record<CanvasAction, { readonly command: CommandId; readonly shown: string }>
> = Object.fromEntries(
  (Object.entries(ACTION_COMMANDS) as [CanvasAction, CommandId][]).map(([action, command]) => [
    action,
    { command, shown: shortcutOf(command) },
  ]),
) as Record<CanvasAction, { readonly command: CommandId; readonly shown: string }>;

const NUDGES = [
  CANVAS_BINDINGS.nudgeLeft.shown,
  CANVAS_BINDINGS.nudgeUp.shown,
  CANVAS_BINDINGS.nudgeDown.shown,
  CANVAS_BINDINGS.nudgeRight.shown,
].join(" ");

/** The keys that the canvas's tooltips, shortcut list and menus show. */
export const CANVAS_KEYS = {
  frame: CANVAS_BINDINGS.frame.shown,
  fit: CANVAS_BINDINGS.fit.shown,
  actual: CANVAS_BINDINGS.actual.shown,
  zoomIn: CANVAS_BINDINGS.zoomIn.shown,
  zoomOut: CANVAS_BINDINGS.zoomOut.shown,
  nudge: NUDGES,
  nudgeFar: `Shift+${NUDGES}`,
  forward: CANVAS_BINDINGS.forward.shown,
  backward: CANVAS_BINDINGS.backward.shown,
  front: CANVAS_BINDINGS.front.shown,
  back: CANVAS_BINDINGS.back.shown,
  pan: shortcutOf("atlas.pan"),
  delete: CANVAS_BINDINGS.delete.shown,
  clear: CANVAS_BINDINGS.clear.shown,
  selectAll: shortcutOf("atlas.selectAll"),
} as const;

const ACTION_OF_COMMAND: ReadonlyMap<CommandId, CanvasAction> = new Map(
  (Object.entries(ACTION_COMMANDS) as [CanvasAction, CommandId][]).map(([action, command]) => [
    command,
    action,
  ]),
);

/** The keys that the sprites pane shows on its active row. */
export const SPRITE_KEYS = {
  replace: shortcutOf("atlas.replaceSprite"),
  export: shortcutOf("atlas.exportSprite"),
} as const;

export interface KeyTargets {
  readonly transform: ViewTransformControl;
  readonly selected: PixelRect | null;
  readonly clear: () => void;
  readonly nudge: (dx: number, dy: number) => void;
  /** Move the primary selection along its siblings' draw order. */
  readonly arrange: (step: LayerStep) => void;
  /** Delete the selection. */
  readonly remove: () => void;
}

/** Runs `action`, for a key of the canvas or an item of its menu bar. */
export function runCanvasAction(
  action: CanvasAction,
  { transform, selected, clear, nudge, arrange, remove }: KeyTargets,
): void {
  switch (action) {
    case "frame":
      if (selected === null) transform.fit();
      else transform.frame(selected);
      return;
    case "fit":
      transform.fit();
      return;
    case "actual":
      transform.zoomTo(1);
      return;
    case "zoomIn":
      transform.zoomBy(ZOOM_STEP);
      return;
    case "zoomOut":
      transform.zoomBy(1 / ZOOM_STEP);
      return;
    case "nudgeLeft":
      nudge(-1, 0);
      return;
    case "nudgeRight":
      nudge(1, 0);
      return;
    case "nudgeUp":
      nudge(0, -1);
      return;
    case "nudgeDown":
      nudge(0, 1);
      return;
    case "forward":
    case "backward":
    case "front":
    case "back":
      arrange(action);
      return;
    case "delete":
      remove();
      return;
    case "clear":
      clear();
      return;
  }
}

/** Runs the canvas's action for `press`, and returns whether it had one. */
export function canvasKey(press: KeyPress, targets: KeyTargets): boolean {
  const command = commandAt(press, "focus:atlas.canvas");
  const action = command === null ? undefined : ACTION_OF_COMMAND.get(command);
  if (action === undefined) return false;

  runCanvasAction(action, targets);
  return true;
}

/** Returns `true` if `press` is `atlas.selectAll`. */
export function isSelectAllKey(press: KeyPress): boolean {
  return isChord(press, "atlas.selectAll");
}
