import { Dialog, Grid, Kbd, Stack } from "@/components";
import { m } from "@/i18n";
import { useSettings } from "@/modules/settings/api";
import { useDialog } from "@/stores";

import { useKeySheet } from "../state/keySheet";
import { chordLabel } from "../utils/chords";
import { osHotkeys } from "../utils/osHotkeys";
import type { SheetSection } from "../utils/scopes";
import { sheetSections } from "../utils/sheet";
import type { CommandGroup } from "../utils/types";

const SECTION_TITLES: Readonly<Record<SheetSection, () => string>> = {
  app: m.keys_section_app_title,
  library: m.keys_section_library_title,
  workshop: m.keys_section_workshop_title,
  editor: m.keys_section_editor_title,
  lists: m.keys_section_lists_title,
  explorer: m.keys_section_explorer_title,
  audio: m.keys_section_audio_title,
  voiceLines: m.keys_section_voice_lines_title,
  fields: m.keys_section_fields_title,
  vfx: m.keys_section_vfx_title,
  curves: m.keys_section_curves_title,
  skin: m.keys_section_skin_title,
  map: m.keys_section_map_title,
  atlas: m.keys_section_atlas_title,
};

const GROUP_TITLES: Readonly<Record<CommandGroup, () => string>> = {
  general: m.keys_group_general_title,
  transport: m.keys_group_transport_title,
  navigation: m.keys_group_navigation_title,
  view: m.keys_group_view_title,
  tools: m.keys_group_tools_title,
  editing: m.keys_group_editing_title,
  pointer: m.keys_group_pointer_title,
};

/**
 * The shortcut sheet: every command of the registry with its chords, and the OS-global hotkeys.
 *
 * The sections of the scopes that were active when it opened come first. Per "The shortcut sheet"
 * in docs/ux/KEYS.md.
 */
export function KeySheet() {
  const { isOpen, payload, close } = useDialog(useKeySheet);
  const { data: settings } = useSettings();
  const system = settings === undefined ? [] : osHotkeys(settings);

  return (
    <Dialog.Shell open={isOpen} onClose={close} title={m.keys_sheet_title()} size="lg">
      <Dialog.Body>
        <Stack gap={6} data-ui="KeySheet">
          {sheetSections(payload ?? []).map(({ section, groups }) => (
            <Stack key={section} gap={3}>
              <h2 className="text-sm font-medium text-surface-100 select-none">
                {SECTION_TITLES[section]()}
              </h2>
              <Grid minColumnWidth="18rem" gap={6} rowGap={4} align="start">
                {groups.map(({ group, commands }) => (
                  <Stack key={group} gap={2}>
                    <h3 className="text-xs font-medium tracking-wide text-surface-400 uppercase select-none">
                      {GROUP_TITLES[group]()}
                    </h3>
                    <KeyRows rows={commands.map(({ id, title, keys }) => ({ id, title, keys }))} />
                  </Stack>
                ))}
              </Grid>
            </Stack>
          ))}
          {system.length > 0 && (
            <Stack gap={2}>
              <h2 className="text-sm font-medium text-surface-100 select-none">
                {m.keys_section_os_title()}
              </h2>
              <p className="text-meta text-surface-400 select-none">
                {m.keys_section_os_description()}
              </p>
              <KeyRows
                rows={system.map(({ title, chord }) => ({
                  id: title,
                  title: () => title,
                  keys: [chord],
                }))}
              />
            </Stack>
          )}
        </Stack>
      </Dialog.Body>
    </Dialog.Shell>
  );
}

interface KeyRow {
  readonly id: string;
  readonly title: () => string;
  readonly keys: readonly string[];
}

/** The rows of one group: each command's words, then each chord as keycaps. */
function KeyRows({ rows }: { rows: readonly KeyRow[] }) {
  return (
    <Grid columns="minmax(0, 1fr) fit-content(50%)" gap={3} rowGap={1.5} align="center">
      {rows.map((row) => (
        <KeyRowCells key={row.id} row={row} />
      ))}
    </Grid>
  );
}

function KeyRowCells({ row }: { row: KeyRow }) {
  return (
    <>
      <span className="text-meta text-surface-200 select-none">{row.title()}</span>
      <span className="flex flex-wrap justify-end gap-1">
        {row.keys.map((key) => (
          <Kbd key={key} shortcut={chordLabel(key)} />
        ))}
      </span>
    </>
  );
}
