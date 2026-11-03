import { m } from "@/i18n";

import type { CommandSpec } from "../types";

/** A dialog, a menu or the palette over the editor owns the keyboard while it stands. */
const FREE = ["!overlay"] as const;

/** The commands of the focused editor group. Per "The editor's keys" in docs/ux/PROJECT_EDITOR.md. */
export const EDITOR_COMMANDS = [
  {
    id: "editor.closeTab",
    title: m.keys_editor_close_tab_label,
    group: "general",
    scopes: ["editor"],
    keys: ["Ctrl+W"],
    when: FREE,
  },
  {
    id: "editor.reopenTab",
    title: m.keys_editor_reopen_tab_label,
    group: "general",
    scopes: ["editor"],
    keys: ["Ctrl+Shift+T"],
    when: FREE,
  },
  {
    id: "editor.nextTab",
    title: m.keys_editor_next_tab_label,
    group: "navigation",
    scopes: ["editor"],
    keys: ["Ctrl+Tab", "Ctrl+PageDown"],
    when: FREE,
  },
  {
    id: "editor.previousTab",
    title: m.keys_editor_previous_tab_label,
    group: "navigation",
    scopes: ["editor"],
    keys: ["Ctrl+Shift+Tab", "Ctrl+PageUp"],
    when: FREE,
  },
  {
    id: "editor.tabAt",
    title: m.keys_editor_tab_at_label,
    group: "navigation",
    scopes: ["editor"],
    keys: ["Alt+1", "Alt+2", "Alt+3", "Alt+4", "Alt+5", "Alt+6", "Alt+7", "Alt+8"],
    when: FREE,
  },
  {
    id: "editor.lastTab",
    title: m.keys_editor_last_tab_label,
    group: "navigation",
    scopes: ["editor"],
    keys: ["Alt+9"],
    when: FREE,
  },
  {
    id: "editor.save",
    title: m.keys_editor_save_label,
    group: "general",
    scopes: ["editor"],
    keys: ["Ctrl+S"],
    when: FREE,
  },
  {
    id: "editor.find",
    title: m.keys_editor_find_label,
    group: "navigation",
    scopes: ["editor"],
    keys: ["Ctrl+F"],
    when: FREE,
  },
  {
    id: "editor.undo",
    title: m.keys_editor_undo_label,
    group: "editing",
    scopes: ["editor"],
    keys: ["Ctrl+Z"],
    when: FREE,
  },
  {
    id: "editor.redo",
    title: m.keys_editor_redo_label,
    group: "editing",
    scopes: ["editor"],
    keys: ["Ctrl+Shift+Z", "Ctrl+Y"],
    when: FREE,
  },
  {
    id: "editor.restorePanel",
    title: m.keys_editor_restore_panel_label,
    group: "view",
    scopes: ["editor"],
    keys: ["Escape"],
    when: ["!overlay", "!typing"],
  },
] as const satisfies readonly CommandSpec[];
