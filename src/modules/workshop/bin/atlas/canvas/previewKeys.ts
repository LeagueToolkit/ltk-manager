import { commandAt, type CommandId, type KeyPress, shortcutOf } from "@/modules/keys";

/** The registry command of each preview toolbar action that the canvas runs on a key. */
const PREVIEW_COMMANDS = {
  transform: "atlas.transform",
  interact: "atlas.interact",
  safeZone: "atlas.safeZone",
  showDisabled: "atlas.showDisabled",
  effects: "atlas.effects",
  samples: "atlas.samples",
  stackScenes: "atlas.stackScenes",
  buttonState: "atlas.buttonState",
  play: "atlas.play",
} as const satisfies Readonly<Record<string, CommandId>>;

/** The keys that the preview toolbar's tooltips name. */
export const PREVIEW_KEYS = Object.fromEntries(
  Object.entries(PREVIEW_COMMANDS).map(([name, command]) => [name, shortcutOf(command)]),
) as Readonly<Record<keyof typeof PREVIEW_COMMANDS, string>>;

/** What the preview keys act on. */
export interface PreviewKeyActions {
  readonly chooseTransform: () => void;
  readonly toggleInteract: () => void;
  readonly toggleSafeZone: () => void;
  readonly toggleShowDisabled: () => void;
  readonly toggleEffects: () => void;
  readonly toggleSamples: () => void;
  readonly toggleStackScenes: () => void;
  readonly cycleButtonState: () => void;
  readonly togglePlaying: () => void;
}

/** Runs the preview's action for `press`, and returns whether it had one. */
export function previewKey(press: KeyPress, actions: PreviewKeyActions): boolean {
  const runs: Partial<Record<CommandId, () => void>> = {
    "atlas.transform": actions.chooseTransform,
    "atlas.interact": actions.toggleInteract,
    "atlas.safeZone": actions.toggleSafeZone,
    "atlas.showDisabled": actions.toggleShowDisabled,
    "atlas.effects": actions.toggleEffects,
    "atlas.samples": actions.toggleSamples,
    "atlas.stackScenes": actions.toggleStackScenes,
    "atlas.buttonState": actions.cycleButtonState,
    "atlas.play": actions.togglePlaying,
  };
  const command = commandAt(press, "focus:atlas.canvas");
  const run = command === null ? undefined : runs[command];
  if (run === undefined) return false;

  run();
  return true;
}
