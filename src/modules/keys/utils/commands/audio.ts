import { m } from "@/i18n";

import type { ScopeId } from "../scopes";
import type { CommandSpec } from "../types";

const MEDIA = "focus:audio.media";
const EVENTS = "focus:audio.events";
const LINES = "focus:audio.lines";

const LISTS = [MEDIA, EVENTS, LINES] as const satisfies readonly ScopeId[];
const TREES = [EVENTS, LINES] as const satisfies readonly ScopeId[];
const DOCUMENT = ["document:audio", LINES] as const satisfies readonly ScopeId[];

/** A list's Escape stops what plays, ahead of the editor's restore. */
const STOP_SHADOWS = ["editor.restorePanel"] as const;

/**
 * The commands of the audio file document, its lists, the Voice lines view and the knob.
 *
 * A command without a chord is one that a menu or the palette runs. Per "Keys and gestures" in
 * docs/ux/AUDIO.md.
 */
export const AUDIO_COMMANDS = [
  {
    id: "audio.play",
    title: m.audio_key_play_label,
    group: "transport",
    scopes: LISTS,
    keys: ["Space"],
  },
  {
    id: "audio.playAll",
    title: m.audio_key_play_all_label,
    group: "transport",
    scopes: TREES,
    keys: ["Shift+Space"],
  },
  {
    id: "audio.stop",
    title: m.audio_key_stop_label,
    group: "transport",
    scopes: LISTS,
    keys: ["Escape"],
    shadows: STOP_SHADOWS,
  },
  {
    id: "audio.loop",
    title: m.audio_key_loop_label,
    group: "transport",
    scopes: DOCUMENT,
    keys: ["Ctrl+L"],
    when: ["!typing", "!overlay"],
  },
  {
    id: "audio.volumeDown",
    title: m.audio_key_volume_down_label,
    group: "transport",
    scopes: DOCUMENT,
    keys: ["-"],
    when: ["!typing", "!overlay"],
  },
  {
    id: "audio.volumeUp",
    title: m.audio_key_volume_up_label,
    group: "transport",
    scopes: DOCUMENT,
    keys: ["=", "+"],
    when: ["!typing", "!overlay"],
  },

  {
    id: "audio.moveRow",
    title: m.audio_key_move_row_label,
    group: "navigation",
    scopes: LISTS,
    keys: ["ArrowUp", "ArrowDown"],
  },
  {
    id: "audio.movePage",
    title: m.audio_key_move_page_label,
    group: "navigation",
    scopes: LISTS,
    keys: ["PageUp", "PageDown"],
  },
  {
    id: "audio.moveEnd",
    title: m.audio_key_move_end_label,
    group: "navigation",
    scopes: LISTS,
    keys: ["Home", "End"],
  },
  {
    id: "audio.extendRange",
    title: m.audio_key_extend_range_label,
    group: "navigation",
    scopes: TREES,
    keys: [
      "Shift+ArrowUp",
      "Shift+ArrowDown",
      "Shift+PageUp",
      "Shift+PageDown",
      "Shift+Home",
      "Shift+End",
    ],
  },
  {
    id: "audio.selectAll",
    title: m.audio_key_select_all_label,
    group: "navigation",
    scopes: TREES,
    keys: ["Ctrl+A"],
  },
  {
    id: "audio.stepRight",
    title: m.audio_key_step_right_label,
    group: "navigation",
    scopes: TREES,
    keys: ["ArrowRight"],
  },
  {
    id: "audio.stepLeft",
    title: m.audio_key_step_left_label,
    group: "navigation",
    scopes: TREES,
    keys: ["ArrowLeft"],
  },
  {
    id: "audio.nextEvent",
    title: m.audio_key_next_event_label,
    group: "navigation",
    scopes: TREES,
    keys: ["Ctrl+ArrowDown"],
  },
  {
    id: "audio.previousEvent",
    title: m.audio_key_previous_event_label,
    group: "navigation",
    scopes: TREES,
    keys: ["Ctrl+ArrowUp"],
  },
  {
    id: "audio.typeAhead",
    title: m.audio_key_type_ahead_label,
    group: "navigation",
    scopes: LISTS,
    keys: [],
    gesture: true,
  },
  {
    id: "audio.menu",
    title: m.audio_key_menu_label,
    group: "navigation",
    scopes: LISTS,
    keys: ["Shift+F10", "ContextMenu"],
  },

  {
    id: "audio.viewMedia",
    title: m.audio_key_view_media_label,
    group: "view",
    scopes: ["document:audio"],
    keys: ["Ctrl+Shift+M"],
    when: ["!typing", "!overlay"],
  },
  {
    id: "audio.viewEvents",
    title: m.audio_key_view_events_label,
    group: "view",
    scopes: ["document:audio"],
    keys: ["Ctrl+Shift+E"],
    when: ["!typing", "!overlay"],
  },
  {
    id: "audio.toggleInspector",
    title: m.audio_key_toggle_inspector_label,
    group: "view",
    scopes: DOCUMENT,
    keys: ["Ctrl+Alt+B"],
    when: ["!typing", "!overlay"],
  },

  {
    id: "audio.enter",
    title: m.audio_key_enter_label,
    group: "editing",
    scopes: LISTS,
    keys: ["F2", "Enter"],
  },
  {
    id: "audio.reset",
    title: m.audio_key_reset_label,
    group: "editing",
    scopes: [EVENTS],
    keys: ["Backspace"],
  },
  {
    id: "audio.add",
    title: m.audio_key_add_label,
    group: "editing",
    scopes: TREES,
    keys: ["Ctrl+Enter"],
  },
  {
    id: "audio.duplicate",
    title: m.audio_key_duplicate_label,
    group: "editing",
    scopes: TREES,
    keys: ["Ctrl+D"],
  },
  {
    id: "audio.remove",
    title: m.audio_key_remove_label,
    group: "editing",
    scopes: TREES,
    keys: ["Delete"],
  },
  {
    id: "audio.moveUp",
    title: m.audio_key_move_up_label,
    group: "editing",
    scopes: TREES,
    keys: ["Alt+ArrowUp"],
  },
  {
    id: "audio.moveDown",
    title: m.audio_key_move_down_label,
    group: "editing",
    scopes: TREES,
    keys: ["Alt+ArrowDown"],
  },
  {
    id: "audio.wrap",
    title: m.audio_key_wrap_label,
    group: "editing",
    scopes: [EVENTS],
    keys: ["Ctrl+G"],
  },
  {
    id: "audio.copy",
    title: m.audio_key_copy_label,
    group: "editing",
    scopes: LISTS,
    keys: ["Ctrl+C"],
  },
  {
    id: "audio.cut",
    title: m.audio_key_cut_label,
    group: "editing",
    scopes: [EVENTS],
    keys: ["Ctrl+X"],
  },
  {
    id: "audio.paste",
    title: m.audio_key_paste_label,
    group: "editing",
    scopes: [EVENTS],
    keys: ["Ctrl+V"],
  },

  {
    id: "audio.knobStep",
    title: m.audio_key_knob_step_label,
    group: "editing",
    scopes: ["focus:knob"],
    keys: ["ArrowUp", "ArrowDown"],
  },
  {
    id: "audio.knobFine",
    title: m.audio_key_knob_fine_label,
    group: "editing",
    scopes: ["focus:knob"],
    keys: ["Shift+ArrowUp", "Shift+ArrowDown"],
  },
  {
    id: "audio.knobCoarse",
    title: m.audio_key_knob_coarse_label,
    group: "editing",
    scopes: ["focus:knob"],
    keys: ["Ctrl+ArrowUp", "Ctrl+ArrowDown"],
  },
  {
    id: "audio.knobReset",
    title: m.audio_key_knob_reset_label,
    group: "editing",
    scopes: ["focus:knob"],
    keys: ["Delete", "Backspace"],
  },

  {
    id: "audio.dragReorder",
    title: m.audio_key_drag_reorder_label,
    group: "pointer",
    scopes: TREES,
    keys: [],
    gesture: true,
  },
  {
    id: "audio.dropMedia",
    title: m.audio_key_drop_media_label,
    group: "pointer",
    scopes: [EVENTS],
    keys: [],
    gesture: true,
  },
  {
    id: "audio.dragEvent",
    title: m.audio_key_drag_event_label,
    group: "pointer",
    scopes: TREES,
    keys: [],
    gesture: true,
  },
  {
    id: "audio.middleClick",
    title: m.audio_key_middle_click_label,
    group: "pointer",
    scopes: LISTS,
    keys: [],
    gesture: true,
  },
  {
    id: "audio.pickClick",
    title: m.audio_key_pick_click_label,
    group: "pointer",
    scopes: TREES,
    keys: [],
    gesture: true,
  },
] as const satisfies readonly CommandSpec[];
