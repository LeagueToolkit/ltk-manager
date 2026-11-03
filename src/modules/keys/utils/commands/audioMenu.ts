import { m } from "@/i18n";

import type { ScopeId } from "../scopes";
import type { CommandSpec } from "../types";

const EVENTS = "focus:audio.events";
const LINES = "focus:audio.lines";
const TREES = [EVENTS, LINES] as const satisfies readonly ScopeId[];

/**
 * The commands of the audio file document and the Voice lines view that a menu or the palette
 * runs, which no chord takes.
 */
export const AUDIO_MENU_COMMANDS = [
  {
    id: "audio.details",
    title: m.audio_key_details_label,
    group: "view",
    scopes: ["document:audio"],
    keys: [],
  },
  {
    id: "audio.expandAll",
    title: m.audio_key_expand_all_label,
    group: "view",
    scopes: TREES,
    keys: [],
  },
  {
    id: "audio.collapseAll",
    title: m.audio_key_collapse_all_label,
    group: "view",
    scopes: TREES,
    keys: [],
  },
  {
    id: "audio.createEvent",
    title: m.audio_key_create_event_label,
    group: "editing",
    scopes: [LINES],
    keys: [],
  },
  {
    id: "audio.showInBank",
    title: m.audio_key_show_in_bank_label,
    group: "view",
    scopes: [LINES],
    keys: [],
  },
  {
    id: "audio.showInTree",
    title: m.audio_key_show_in_tree_label,
    group: "view",
    scopes: [LINES],
    keys: [],
  },
  {
    id: "audio.copyForSkin",
    title: m.audio_key_copy_for_skin_label,
    group: "editing",
    scopes: [LINES],
    keys: [],
  },
  {
    id: "audio.addChance",
    title: m.audio_key_add_chance_label,
    group: "editing",
    scopes: [LINES],
    keys: [],
  },
  {
    id: "audio.removeChance",
    title: m.audio_key_remove_chance_label,
    group: "editing",
    scopes: [LINES],
    keys: [],
  },
  {
    id: "audio.pickRandom",
    title: m.audio_key_pick_random_label,
    group: "editing",
    scopes: [LINES],
    keys: [],
  },
  {
    id: "audio.rename",
    title: m.audio_key_rename_label,
    group: "editing",
    scopes: [EVENTS],
    keys: [],
  },
  {
    id: "audio.replaceMedia",
    title: m.audio_key_replace_media_label,
    group: "editing",
    scopes: [EVENTS],
    keys: [],
  },
  {
    id: "audio.newEvent",
    title: m.audio_key_new_event_label,
    group: "editing",
    scopes: [EVENTS],
    keys: [],
  },
  {
    id: "audio.addSound",
    title: m.audio_key_add_sound_label,
    group: "editing",
    scopes: [EVENTS],
    keys: [],
  },
  {
    id: "audio.addRandom",
    title: m.audio_key_add_random_label,
    group: "editing",
    scopes: [EVENTS],
    keys: [],
  },
  {
    id: "audio.addSequence",
    title: m.audio_key_add_sequence_label,
    group: "editing",
    scopes: [EVENTS],
    keys: [],
  },
  {
    id: "audio.addSwitch",
    title: m.audio_key_add_switch_label,
    group: "editing",
    scopes: [EVENTS],
    keys: [],
  },
  {
    id: "audio.importWem",
    title: m.audio_key_import_wem_label,
    group: "editing",
    scopes: [EVENTS],
    keys: [],
  },
] as const satisfies readonly CommandSpec[];
