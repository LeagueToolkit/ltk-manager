import { m } from "@/i18n";

import type { CommandSpec } from "../types";

/** The preview's keys answer inside it, outside a field and a keyed control. */
const PREVIEW = ["!typing", "!keyedControl"] as const;

/** The commands of a skin's preview and its socket gizmo. Per "Keys" in docs/ux/SKIN_EDITOR.md. */
export const SKIN_COMMANDS = [
  {
    id: "skin.play",
    title: m.keys_skin_play_label,
    group: "transport",
    scopes: ["document:skin"],
    keys: ["Space"],
    when: PREVIEW,
  },
  {
    id: "skin.restart",
    title: m.keys_skin_restart_label,
    group: "transport",
    scopes: ["document:skin"],
    keys: ["Home"],
    when: PREVIEW,
  },
  {
    id: "skin.stepBack",
    title: m.keys_skin_step_back_label,
    group: "transport",
    scopes: ["document:skin"],
    keys: ["ArrowLeft"],
    when: PREVIEW,
  },
  {
    id: "skin.stepForward",
    title: m.keys_skin_step_forward_label,
    group: "transport",
    scopes: ["document:skin"],
    keys: ["ArrowRight"],
    when: PREVIEW,
  },
  {
    id: "skin.stepBackLong",
    title: m.keys_skin_step_back_long_label,
    group: "transport",
    scopes: ["document:skin"],
    keys: ["Shift+ArrowLeft"],
    when: PREVIEW,
  },
  {
    id: "skin.stepForwardLong",
    title: m.keys_skin_step_forward_long_label,
    group: "transport",
    scopes: ["document:skin"],
    keys: ["Shift+ArrowRight"],
    when: PREVIEW,
  },
  {
    id: "skin.slower",
    title: m.keys_skin_slower_label,
    group: "transport",
    scopes: ["document:skin"],
    keys: ["["],
    when: PREVIEW,
  },
  {
    id: "skin.faster",
    title: m.keys_skin_faster_label,
    group: "transport",
    scopes: ["document:skin"],
    keys: ["]"],
    when: PREVIEW,
  },
  {
    id: "skin.fit",
    title: m.keys_skin_fit_label,
    group: "view",
    scopes: ["document:skin"],
    keys: ["F"],
    when: PREVIEW,
  },
  {
    id: "skin.showUi",
    title: m.keys_skin_show_ui_label,
    group: "view",
    scopes: ["document:skin"],
    keys: ["Escape"],
    shadows: ["editor.restorePanel"],
  },
  {
    id: "skin.socketMove",
    title: m.keys_skin_socket_move_label,
    group: "tools",
    scopes: ["document:skin"],
    keys: ["W"],
    when: PREVIEW,
  },
  {
    id: "skin.socketTurn",
    title: m.keys_skin_socket_turn_label,
    group: "tools",
    scopes: ["document:skin"],
    keys: ["E"],
    when: PREVIEW,
  },
  {
    id: "skin.socketAxes",
    title: m.keys_skin_socket_axes_label,
    group: "tools",
    scopes: ["document:skin"],
    keys: ["X"],
    when: PREVIEW,
  },
  {
    id: "skin.socketSnap",
    title: m.keys_skin_socket_snap_label,
    group: "pointer",
    scopes: ["document:skin"],
    keys: [],
    gesture: true,
  },
] as const satisfies readonly CommandSpec[];
