import { FunnelIcon, MagnifyingGlassIcon, XIcon } from "@phosphor-icons/react";
import type { KeyboardEvent, RefObject } from "react";

import { Field, IconButton, Menu } from "@/components";
import { m } from "@/i18n";
import type { MapItemKind } from "@/lib/tauri";
import { twMerge } from "@/utils";

import { type OutlineFilter, showsKind, withKindShown } from "../utils/mapOutline";

/** The kinds in the order the filter menu lists them. */
const KIND_ORDER: readonly MapItemKind[] = [
  "particle",
  "character",
  "locator",
  "group",
  "audio",
  "light",
  "probe",
  "volume",
  "path",
  "region",
  "other",
];

const KIND_LABEL: Record<MapItemKind, () => string> = {
  particle: m.workshop_bin_map_outliner_kind_particle_label,
  character: m.workshop_bin_map_outliner_kind_character_label,
  locator: m.workshop_bin_map_outliner_kind_locator_label,
  group: m.workshop_bin_map_outliner_kind_group_label,
  audio: m.workshop_bin_map_outliner_kind_audio_label,
  light: m.workshop_bin_map_outliner_kind_light_label,
  probe: m.workshop_bin_map_outliner_kind_probe_label,
  volume: m.workshop_bin_map_outliner_kind_volume_label,
  path: m.workshop_bin_map_outliner_kind_path_label,
  region: m.workshop_bin_map_outliner_kind_region_label,
  other: m.workshop_bin_map_outliner_kind_other_label,
};

interface OutlinerSearchProps {
  filter: OutlineFilter;
  onChange: (filter: OutlineFilter) => void;
  /** How many placeables the map holds of each kind, which names the kinds the menu offers. */
  counts: ReadonlyMap<MapItemKind, number>;
  /** How many meshes the outliner lists, and 0 where the map takes no edits. */
  meshCount: number;
  /** How many objects the filter keeps, shown while it narrows anything. */
  matches: number | null;
  inputRef: RefObject<HTMLInputElement | null>;
  /** Hand the keyboard to the tree, which a Down arrow in the box asks for. */
  onLeave: () => void;
}

/**
 * The outliner's search box, with a menu beside it that shows or hides meshes and each kind of
 * placeable the map holds.
 *
 * The box matches a placeable's name or class, a chunk's name, or a mesh's material, controller
 * or number. Escape clears it, and a Down arrow moves into the tree.
 */
export function OutlinerSearch({
  filter,
  onChange,
  counts,
  meshCount,
  matches,
  inputRef,
  onLeave,
}: OutlinerSearchProps) {
  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape" && filter.text !== "") {
      event.preventDefault();
      event.stopPropagation();
      onChange({ ...filter, text: "" });
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      onLeave();
    }
  }

  return (
    <div data-ui="OutlinerSearch" className="flex shrink-0 items-center gap-1 p-1.5 pb-1">
      <div
        /* DS-VEIL, DS-HOVER */
        className={twMerge(
          "flex h-7 min-w-0 flex-1 items-center gap-0.5 rounded-md border border-surface-veil-strong bg-surface-veil-soft pr-0.5 pl-2",
          "transition-colors focus-within:border-accent-500 hover:border-accent-hover",
        )}
      >
        <MagnifyingGlassIcon className="size-3.5 shrink-0 text-surface-400" />
        <Field.Root className="min-w-0 flex-1">
          <Field.Control
            ref={inputRef}
            value={filter.text}
            onChange={(event) => onChange({ ...filter, text: event.target.value })}
            onKeyDown={handleKeyDown}
            placeholder={m.workshop_bin_map_outliner_search_placeholder()}
            aria-label={m.workshop_bin_map_outliner_search_placeholder()}
            spellCheck={false}
            autoComplete="off"
            className="h-6 rounded-none border-0 bg-transparent px-1 text-meta hover:border-0 focus:border-0 focus:ring-0"
          />
        </Field.Root>
        {matches !== null && (
          <span className="shrink-0 px-1 text-meta text-surface-400 tabular-nums">{matches}</span>
        )}
        {filter.text !== "" && (
          <IconButton
            icon={<XIcon />}
            size="row"
            onClick={() => onChange({ ...filter, text: "" })}
            aria-label={m.workshop_bin_map_outliner_search_clear_action()}
          />
        )}
      </div>
      <KindMenu filter={filter} onChange={onChange} counts={counts} meshCount={meshCount} />
    </div>
  );
}

/** What the outliner lists: meshes and each kind of placeable, each shown or hidden. */
function KindMenu({
  filter,
  onChange,
  counts,
  meshCount,
}: Pick<OutlinerSearchProps, "filter" | "onChange" | "counts" | "meshCount">) {
  const present = KIND_ORDER.filter((kind) => (counts.get(kind) ?? 0) > 0);
  const narrowed = filter.kinds.size > 0 || filter.hideMeshes === true;
  const shownKinds = present.filter((kind) => showsKind(filter, kind));

  return (
    <Menu.Root>
      <Menu.Trigger
        render={
          <IconButton
            icon={<FunnelIcon />}
            pressed={narrowed}
            label={m.workshop_bin_map_outliner_kinds_label()}
          />
        }
      />
      <Menu.Content align="end" data-ui="OutlinerKindMenu" className="w-56">
        {meshCount > 0 && (
          <>
            <Menu.CheckboxItem
              checked={filter.hideMeshes !== true}
              onCheckedChange={(shown) => onChange({ ...filter, hideMeshes: !shown })}
            >
              <KindLabel label={m.workshop_bin_map_outliner_meshes_label()} count={meshCount} />
            </Menu.CheckboxItem>
            <Menu.Separator />
          </>
        )}
        {present.map((kind) => {
          const shown = showsKind(filter, kind);
          return (
            <Menu.CheckboxItem
              key={kind}
              checked={shown}
              /* The last kind shown stays, since an empty set of kinds lists every kind. */
              disabled={shown && shownKinds.length === 1}
              onCheckedChange={(next) => onChange(withKindShown(filter, kind, next, present))}
            >
              <KindLabel label={KIND_LABEL[kind]()} count={counts.get(kind) ?? 0} />
            </Menu.CheckboxItem>
          );
        })}
        <Menu.Separator />
        <Menu.Item
          disabled={!narrowed}
          onClick={() => onChange({ ...filter, kinds: new Set(), hideMeshes: false })}
        >
          {m.workshop_bin_map_outliner_show_all_action()}
        </Menu.Item>
      </Menu.Content>
    </Menu.Root>
  );
}

function KindLabel({ label, count }: { label: string; count: number }) {
  return (
    <span className="flex w-full items-center gap-2">
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <span className="shrink-0 text-meta text-surface-400 tabular-nums">{count}</span>
    </span>
  );
}
