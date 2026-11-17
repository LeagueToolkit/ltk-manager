import { format } from "date-fns/format";
import { formatDistanceToNowStrict } from "date-fns/formatDistanceToNowStrict";
import { type ComponentType, use } from "react";

import {
  type ArrangedColumn,
  Checkbox,
  PickContext,
  THUMB_SIZE,
  type RowDensity,
} from "@/components";
import { m } from "@/i18n";
import type { WorkshopProject } from "@/lib/tauri";
import { AdvisoryBadge, SuspectBadge } from "@/modules/diagnostics";
import { twMerge } from "@/utils";

import {
  type ProjectColumnId,
  type ProjectGroupBy,
  useProjectTableStore,
  type WorkshopSortField,
} from "../../../state";
import {
  OpenedFolderPath,
  ProjectKebab,
  ProjectPills,
  ProjectRunIcons,
  TestingPill,
} from "../ProjectCardParts";

/** What a row knows about its project beyond the project itself. */
export interface ProjectRowView {
  project: WorkshopProject;
  thumbnailUrl: string | undefined;
  selected: boolean;
  /** Whether a session holds the selection, which no pick may rewrite until it ends. */
  locked: boolean;
  isTestingThis: boolean;
  onEdit: (project: WorkshopProject) => void;
}

export interface ProjectCellProps {
  view: ProjectRowView;
  /** The row's key, which tells apart the copies of a project filed under several groups. */
  rowKey: string;
  density: RowDensity;
}

export interface ProjectColumnSpec extends ArrangedColumn<
  ProjectColumnId,
  WorkshopSortField,
  ProjectGroupBy
> {
  Cell: ComponentType<ProjectCellProps>;
}

/** Stops a press on a control inside the row from also reaching the row. */
const stop = { "data-no-row": true, onClick: (e: React.MouseEvent) => e.stopPropagation() };

/* The press is the table's, so a drag down the column picks the rows it
   crosses. Ctrl+Space picks the current row from the keyboard. */
function SelectCell({ view, rowKey }: ProjectCellProps) {
  const onPickStart = use(PickContext);
  const checked = view.locked ? view.isTestingThis : view.selected;

  return (
    <span
      data-no-row
      onPointerDown={(event) => {
        if (!view.locked) onPickStart(event, rowKey, view.project.path, view.selected);
      }}
      onClickCapture={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
      className={twMerge("flex p-1", view.locked ? "cursor-not-allowed" : "cursor-pointer")}
    >
      <Checkbox size="sm" tabIndex={-1} aria-hidden checked={checked} disabled={view.locked} />
    </span>
  );
}

function ArtCell({ view, density }: ProjectCellProps) {
  const { width, height } = THUMB_SIZE[density];

  return (
    <span
      style={{ width, height }}
      className={twMerge(
        "relative flex shrink-0 items-center justify-center overflow-hidden bg-linear-to-br from-surface-600 to-surface-700",
        density === "compact" ? "rounded-sm" : "rounded-md",
      )}
    >
      {view.thumbnailUrl && (
        <img
          src={view.thumbnailUrl}
          alt=""
          loading="lazy"
          decoding="async"
          className="absolute inset-0 size-full object-cover"
        />
      )}
      {!view.thumbnailUrl && (
        <span
          style={{ fontSize: Math.round(height * 0.45) }}
          className="font-bold text-surface-400 select-none"
        >
          {view.project.displayName.charAt(0).toUpperCase()}
        </span>
      )}
    </span>
  );
}

/* The Test and Pack column says a project is testing and ends the run, so the
   pill only stands in for it while that column is hidden. */
function NameCell({ view }: ProjectCellProps) {
  const runButtonsShown = useProjectTableStore((s) => s.columnVisibility.actions !== false);

  return (
    <span className="flex min-w-0 items-center gap-1.5">
      <span className="truncate text-sm font-medium text-surface-100">
        {view.project.displayName}
      </span>
      <span {...stop} className="flex shrink-0 items-center gap-1.5 empty:hidden">
        <SuspectBadge projectPath={view.project.path} />
        <AdvisoryBadge projectPath={view.project.path} />
        {view.isTestingThis && !runButtonsShown && <TestingPill />}
      </span>
    </span>
  );
}

/* One line of pills, and a pill that does not fit drops out whole. */
function CategoriesCell({ view }: ProjectCellProps) {
  return (
    <ProjectPills
      project={view.project}
      max={3}
      always
      className="max-h-5 min-w-0 content-start gap-x-1 gap-y-6 overflow-hidden whitespace-nowrap"
    />
  );
}

function AuthorCell({ view }: ProjectCellProps) {
  const authors =
    view.project.authors.map((author) => author.name).join(", ") ||
    m.workshop_card_unknown_author_label();
  return <span className="truncate text-surface-300">{authors}</span>;
}

function VersionCell({ view }: ProjectCellProps) {
  return <span className="truncate text-surface-300 tabular-nums">{view.project.version}</span>;
}

function LayersCell({ view }: ProjectCellProps) {
  return <span className="text-surface-300 tabular-nums">{view.project.layers.length}</span>;
}

function LocationCell({ view }: ProjectCellProps) {
  if (view.project.location === "opened") return <OpenedFolderPath project={view.project} />;
  return <span className="truncate">{m.workshop_folder_workshop_label()}</span>;
}

function When({ at }: { at: string | null }) {
  if (!at) return <span>{m.workshop_table_never_opened_label()}</span>;

  const date = new Date(at);
  return (
    <span className="truncate tabular-nums" title={format(date, "PPpp")}>
      {formatDistanceToNowStrict(date, { addSuffix: true })}
    </span>
  );
}

function ModifiedCell({ view }: ProjectCellProps) {
  return <When at={view.project.lastModified} />;
}

function OpenedCell({ view }: ProjectCellProps) {
  return <When at={view.project.lastOpened} />;
}

/* Drawn on the row under the pointer, like the kebab, and always on the project
   under test, whose Stop Test ends the run. */
function ActionsCell({ view }: ProjectCellProps) {
  return (
    <span
      {...stop}
      className={twMerge(
        "flex items-center gap-0.5",
        !view.isTestingThis &&
          "opacity-0 transition-opacity group-hover/row:opacity-100 focus-within:opacity-100",
      )}
    >
      <ProjectRunIcons project={view.project} />
    </span>
  );
}

function MenuCell({ view }: ProjectCellProps) {
  return (
    <span {...stop} className="flex">
      <ProjectKebab project={view.project} onEdit={view.onEdit} reveal />
    </span>
  );
}

const none = () => "";

/** Every column the project table can draw, keyed by id. */
export const PROJECT_COLUMN_SPECS: Record<ProjectColumnId, ProjectColumnSpec> = {
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
    size: 260,
    minSize: 80,
    groupBy: ["champion", "map", "tag"],
    Cell: CategoriesCell,
  },
  author: {
    id: "author",
    header: m.common_table_column_author_label,
    name: m.common_table_column_author_label,
    size: 140,
    minSize: 60,
    groupBy: ["author"],
    Cell: AuthorCell,
  },
  version: {
    id: "version",
    header: m.common_table_column_version_label,
    name: m.common_table_column_version_label,
    size: 88,
    minSize: 56,
    Cell: VersionCell,
  },
  layers: {
    id: "layers",
    header: m.common_table_column_layers_label,
    name: m.common_table_column_layers_label,
    size: 72,
    minSize: 56,
    align: "end",
    Cell: LayersCell,
  },
  location: {
    id: "location",
    header: m.workshop_table_column_location_label,
    name: m.workshop_table_column_location_label,
    size: 180,
    minSize: 80,
    groupBy: ["location"],
    Cell: LocationCell,
  },
  modified: {
    id: "modified",
    header: m.workshop_table_column_modified_label,
    name: m.workshop_table_column_modified_label,
    size: 128,
    minSize: 72,
    sortField: "lastModified",
    Cell: ModifiedCell,
  },
  opened: {
    id: "opened",
    header: m.workshop_table_column_opened_label,
    name: m.workshop_table_column_opened_label,
    size: 128,
    minSize: 72,
    sortField: "lastOpened",
    Cell: OpenedCell,
  },
  actions: {
    id: "actions",
    header: none,
    name: m.workshop_table_column_actions_label,
    size: 80,
    minSize: 80,
    Cell: ActionsCell,
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
export const PROJECT_GROUP_LABELS: Record<ProjectGroupBy, () => string> = {
  none: m.common_table_group_none_label,
  location: m.workshop_table_group_location_label,
  champion: m.common_table_group_champion_label,
  map: m.common_table_group_map_label,
  tag: m.common_table_group_tag_label,
  author: m.common_table_group_author_label,
};
