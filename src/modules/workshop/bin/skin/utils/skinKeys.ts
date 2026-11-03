import { type CommandId, shortcutOf } from "@/modules/keys";
import type { SceneClock } from "@/modules/viewport";

import { speedDetent } from "../../vfx/playback/components/Transport";

/** The seconds one frame key moves the clip. */
const FRAME_SECONDS = 1 / 60;

/** How many frames Shift and an arrow move, which is a tenth of a second. */
export const SHIFT_FRAMES = 6;

/** What a key or a menu item reaches of a skin's preview. */
export interface SkinKeyTarget {
  readonly clock: Pick<SceneClock, "time" | "seek" | "restart">;
  readonly playing: boolean;
  readonly setPlaying: (playing: boolean) => void;
  readonly speed: number;
  readonly setSpeed: (speed: number) => void;
  readonly fit: () => void;
  /** The socket gizmo the keys of `SOCKET_KEYS` drive, and absent while none draws. */
  readonly socketGizmo?: SocketGizmoKeys | null;
}

/** What the keys of `SOCKET_KEYS` reach of the socket gizmo. */
export interface SocketGizmoKeys {
  readonly move: () => void;
  readonly turn: () => void;
  readonly toggleAxes: () => void;
}

/** One key of the preview: its registry command, the keycaps it shows and its action. */
export interface SkinKey {
  readonly command: CommandId;
  readonly shortcut: string;
  readonly run: (target: SkinKeyTarget) => void;
}

export type SkinKeyId =
  | "play"
  | "restart"
  | "stepBack"
  | "stepForward"
  | "stepBackLong"
  | "stepForwardLong"
  | "slower"
  | "faster"
  | "fit";

function skinKey(command: CommandId, run: SkinKey["run"]): SkinKey {
  return { command, shortcut: shortcutOf(command), run };
}

/** Pauses and moves the clip by whole frames. */
function step(target: SkinKeyTarget, frames: number): void {
  target.setPlaying(false);
  target.clock.seek(target.clock.time + frames * FRAME_SECONDS);
}

/** The keys of the preview, which `useSkinKeys` and the Animation menu both read. */
export const SKIN_KEYS: Readonly<Record<SkinKeyId, SkinKey>> = {
  play: skinKey("skin.play", (target) => target.setPlaying(!target.playing)),
  restart: skinKey("skin.restart", (target) => target.clock.restart()),
  stepBack: skinKey("skin.stepBack", (target) => step(target, -1)),
  stepForward: skinKey("skin.stepForward", (target) => step(target, 1)),
  stepBackLong: skinKey("skin.stepBackLong", (target) => step(target, -SHIFT_FRAMES)),
  stepForwardLong: skinKey("skin.stepForwardLong", (target) => step(target, SHIFT_FRAMES)),
  slower: skinKey("skin.slower", (target) => target.setSpeed(speedDetent(target.speed, -1))),
  faster: skinKey("skin.faster", (target) => target.setSpeed(speedDetent(target.speed, 1))),
  fit: skinKey("skin.fit", (target) => target.fit()),
};

/** The keys of the socket gizmo, the same keys that the map editor's gizmo takes. */
export const SOCKET_KEYS = {
  move: skinKey("skin.socketMove", (target) => target.socketGizmo?.move()),
  turn: skinKey("skin.socketTurn", (target) => target.socketGizmo?.turn()),
  axes: skinKey("skin.socketAxes", (target) => target.socketGizmo?.toggleAxes()),
} as const satisfies Readonly<Record<string, SkinKey>>;
