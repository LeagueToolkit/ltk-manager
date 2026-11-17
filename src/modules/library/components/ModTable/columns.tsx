import { ShieldWarningIcon } from "@phosphor-icons/react";
import { format } from "date-fns/format";
import { formatDistanceToNow } from "date-fns/formatDistanceToNow";
import { type ComponentType, use } from "react";

import {
  type ArrangedColumn,
  Checkbox,
  PickContext,
  ROW_HEIGHT,
  THUMB_SIZE,
  Tooltip,
} from "@/components";
import { m } from "@/i18n";
import { AdvisoryBadge, SuspectBadge } from "@/modules/diagnostics";
import { useFolders } from "@/modules/library/api";
import { twMerge } from "@/utils";

import type { RowDensity, SortField, TableColumnId, TableGroupBy } from "../../state";
import { LayerPopover } from "../LayerPopover";
import { ModCardMenu, ModCardToggle, ModPills } from "../ModCard/ModCardParts";
import type { ModCardView } from "../ModCard/useModCardController";
import { ModHealthBadge } from "../ModHealthBadge";

export interface CellProps {
  view: ModCardView;
  /** The row's key, which tells apart the copies of a mod filed under several groups. */
  rowKey: string;
  /** The mod's place in the load order, counted from one. */
  position: number;
  density: RowDensity;
}

export interface TableColumnSpec extends ArrangedColumn<TableColumnId, SortField, TableGroupBy> {
  Cell: ComponentType<CellProps>;
}

export { ROW_HEIGHT };

/** Stops a press on a control inside the row from also reaching the row. */
const stop = { "data-no-row": true, onClick: (e: React.MouseEvent) => e.stopPropagation() };

/* The press is the table's, so a drag down the column can pick the rows it
   crosses. The checkbox draws the state and the row's aria-selected names it,
   and the keyboard picks with Ctrl+Space on the current row. */
function SelectCell({ view, rowKey }: CellProps) {
  const onPickStart = use(PickContext);

  return (
    <span
      data-no-row
      onPointerDown={(event) => onPickStart(event, rowKey, view.mod.id, view.isSelected)}
      onClickCapture={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
      className={twMerge(
        "flex cursor-pointer p-1",
        !view.hasSelection && "opacity-0 transition-opacity group-hover/row:opacity-100",
      )}
    >
      <Checkbox size="sm" tabIndex={-1} aria-hidden checked={view.isSelected} />
    </span>
  );
}

function EnabledCell({ view }: CellProps) {
  return (
    <span {...stop} className="flex">
      <ModCardToggle view={view} />
    </span>
  );
}

function PriorityCell({ position }: CellProps) {
  return <span className="text-surface-500 tabular-nums">{position}</span>;
}

function ArtCell({ view, density }: CellProps) {
  const { width, height } = THUMB_SIZE[density];

  return (
    <span
      style={{ width, height }}
      className={twMerge(
        "relative flex shrink-0 items-center justify-center overflow-hidden bg-linear-to-br from-surface-700 to-surface-800",
        density === "compact" ? "rounded-sm" : "rounded-md",
      )}
    >
      {view.thumbnailUrl && (
        <img
          src={view.thumbnailUrl}
          alt=""
          loading="lazy"
          decoding="async"
          className={twMerge(
            "absolute inset-0 size-full object-cover",
            !view.inEnabledState && "saturate-50",
          )}
        />
      )}
      {!view.thumbnailUrl && (
        <span
          style={{ fontSize: Math.round(height * 0.45) }}
          className={twMerge(
            "font-bold select-none",
            view.inEnabledState ? "text-placeholder-lit" : "text-surface-500",
          )}
        >
          {view.mod.displayName.charAt(0).toUpperCase()}
        </span>
      )}
    </span>
  );
}

function NameCell({ view }: CellProps) {
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      <span
        className={twMerge(
          "truncate text-sm font-medium",
          view.inEnabledState ? "text-surface-100" : "text-surface-200",
        )}
      >
        {view.mod.displayName}
      </span>
      {view.isFlagged && (
        <Tooltip content={view.skinhackReason}>
          <ShieldWarningIcon className="size-4 shrink-0 text-danger-text" />
        </Tooltip>
      )}
    </span>
  );
}

/* The pills wrap and the cell shows one line of them, so a pill that does not
   fit drops out whole rather than being cut at the edge. The row gap puts the
   wrapped line well under the clip. */
function CategoriesCell({ view }: CellProps) {
  return (
    <ModPills
      mod={view.mod}
      max={3}
      always
      className="max-h-5 min-w-0 content-start gap-x-1 gap-y-6 overflow-hidden whitespace-nowrap [&>span]:gap-y-6"
    />
  );
}

function AuthorCell({ view }: CellProps) {
  const authors = view.mod.authors.join(", ") || m.library_details_unknown_author_label();
  return <span className="truncate text-surface-300">{authors}</span>;
}

function VersionCell({ view }: CellProps) {
  return <span className="truncate text-surface-300 tabular-nums">{view.mod.version}</span>;
}

function LayersCell({ view }: CellProps) {
  if (!view.isMultiLayer) return null;

  return (
    <span {...stop} className="flex">
      <LayerPopover mod={view.mod} disabled={view.disabled} />
    </span>
  );
}

function HealthCell({ view }: CellProps) {
  return (
    <span {...stop} className="flex items-center gap-1 empty:hidden">
      <ModHealthBadge modId={view.mod.id} />
      <SuspectBadge modId={view.mod.id} enabled={view.mod.enabled} />
      <AdvisoryBadge modId={view.mod.id} enabled={view.mod.enabled} />
    </span>
  );
}

function InstalledCell({ view }: CellProps) {
  const at = new Date(view.mod.installedAt);
  return (
    <span className="truncate tabular-nums" title={format(at, "PPpp")}>
      {formatDistanceToNow(at, { addSuffix: true })}
    </span>
  );
}

function FolderCell({ view }: CellProps) {
  const { data: folders } = useFolders();
  const name = folders?.find((folder) => folder.id === view.mod.folderId)?.name;
  return <span className="truncate">{name}</span>;
}

function FormatCell({ view }: CellProps) {
  const label =
    view.mod.format === "fantome"
      ? m.library_table_format_fantome_label()
      : m.library_table_format_modpkg_label();
  return <span className="truncate">{label}</span>;
}

function StorageCell({ view }: CellProps) {
  const label =
    view.mod.storage === "project"
      ? m.library_mod_storage_project_label()
      : m.library_mod_storage_archive_label();
  return <span className="truncate">{label}</span>;
}

function LicenseCell({ view }: CellProps) {
  return <span className="truncate">{view.mod.license?.name}</span>;
}

function MenuCell({ view }: CellProps) {
  return (
    <span {...stop} className="flex">
      <ModCardMenu view={view} reveal />
    </span>
  );
}

const none = () => "";

/** Every column the table can draw, keyed by id. */
export const COLUMN_SPECS: Record<TableColumnId, TableColumnSpec> = {
  select: {
    id: "select",
    header: none,
    name: m.common_table_column_select_label,
    size: 36,
    pin: "start",
    required: true,
    align: "center",
    Cell: SelectCell,
  },
  enabled: {
    id: "enabled",
    header: m.library_table_column_enabled_label,
    name: m.library_table_column_enabled_label,
    size: 56,
    pin: "start",
    required: true,
    align: "center",
    sortField: "enabled",
    groupBy: ["enabled"],
    Cell: EnabledCell,
  },
  priority: {
    id: "priority",
    header: m.library_table_column_priority_label,
    name: m.library_table_column_priority_name,
    size: 52,
    minSize: 40,
    align: "end",
    sortField: "priority",
    Cell: PriorityCell,
  },
  art: {
    id: "art",
    header: m.common_table_column_art_label,
    name: m.common_table_column_art_label,
    size: 76,
    fitted: (density) => THUMB_SIZE[density].width + 20,
    Cell: ArtCell,
  },
  name: {
    id: "name",
    header: m.common_table_column_name_label,
    name: m.common_table_column_name_label,
    size: 220,
    minSize: 140,
    required: true,
    fill: true,
    sticky: true,
    sortField: "name",
    Cell: NameCell,
  },
  categories: {
    id: "categories",
    header: m.common_table_column_categories_label,
    name: m.common_table_column_categories_label,
    size: 300,
    minSize: 80,
    sortField: "champion",
    groupBy: ["champion", "map", "tag"],
    Cell: CategoriesCell,
  },
  author: {
    id: "author",
    header: m.common_table_column_author_label,
    name: m.common_table_column_author_label,
    size: 140,
    minSize: 60,
    sortField: "author",
    groupBy: ["author"],
    Cell: AuthorCell,
  },
  version: {
    id: "version",
    header: m.common_table_column_version_label,
    name: m.common_table_column_version_label,
    size: 88,
    minSize: 56,
    sortField: "version",
    Cell: VersionCell,
  },
  layers: {
    id: "layers",
    header: m.common_table_column_layers_label,
    name: m.common_table_column_layers_label,
    size: 76,
    minSize: 56,
    sortField: "layers",
    Cell: LayersCell,
  },
  health: {
    id: "health",
    header: m.library_table_column_health_label,
    name: m.library_table_column_health_label,
    size: 88,
    minSize: 56,
    sortField: "health",
    groupBy: ["health"],
    Cell: HealthCell,
  },
  installed: {
    id: "installed",
    header: m.library_table_column_installed_label,
    name: m.library_table_column_installed_label,
    size: 128,
    minSize: 72,
    sortField: "installedAt",
    groupBy: ["installed"],
    Cell: InstalledCell,
  },
  folder: {
    id: "folder",
    header: m.library_table_column_folder_label,
    name: m.library_table_column_folder_label,
    size: 130,
    minSize: 60,
    sortField: "folder",
    groupBy: ["folder"],
    Cell: FolderCell,
  },
  format: {
    id: "format",
    header: m.library_table_column_format_label,
    name: m.library_table_column_format_label,
    size: 92,
    minSize: 60,
    sortField: "format",
    groupBy: ["format"],
    Cell: FormatCell,
  },
  storage: {
    id: "storage",
    header: m.library_table_column_storage_label,
    name: m.library_table_column_storage_label,
    size: 96,
    minSize: 60,
    sortField: "storage",
    groupBy: ["storage"],
    Cell: StorageCell,
  },
  license: {
    id: "license",
    header: m.library_table_column_license_label,
    name: m.library_table_column_license_label,
    size: 130,
    minSize: 60,
    sortField: "license",
    groupBy: ["license"],
    Cell: LicenseCell,
  },
  menu: {
    id: "menu",
    header: none,
    name: m.common_table_column_menu_label,
    size: 44,
    pin: "end",
    required: true,
    align: "center",
    Cell: MenuCell,
  },
};

/** The label each grouping goes by, in the order the View options list them. */
export const GROUP_BY_LABELS: Record<TableGroupBy, () => string> = {
  folder: m.library_table_group_folder_label,
  none: m.common_table_group_none_label,
  champion: m.common_table_group_champion_label,
  map: m.common_table_group_map_label,
  tag: m.common_table_group_tag_label,
  author: m.common_table_group_author_label,
  health: m.library_table_group_health_label,
  enabled: m.library_table_group_enabled_label,
  installed: m.library_table_group_installed_label,
  format: m.library_table_group_format_label,
  storage: m.library_table_group_storage_label,
  license: m.library_table_group_license_label,
};
