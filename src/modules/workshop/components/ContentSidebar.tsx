import { FolderOpenIcon, GearSixIcon, GitBranchIcon, PlusIcon } from "@phosphor-icons/react";
import { useQueryClient } from "@tanstack/react-query";
import { type ReactNode, useMemo, useState } from "react";
import { twMerge } from "tailwind-merge";

import {
  Checkbox,
  FilterSection,
  IconButton,
  PlayerTitleIcon,
  Popover,
  SegmentedControl,
  Tooltip,
  useToast,
} from "@/components";
import type { LayerContent, WorkshopProject } from "@/lib/tauri";
import { SidePanel, type SidePanelSection } from "@/modules/editor";
import {
  useOpenSections,
  useSectionHeights,
  useSetSectionHeight,
  useSetShowLayerStats,
  useSetWadSort,
  useShowLayerStats,
  useToggleSection,
  useWadSort,
} from "@/stores";

import { workshopKeys } from "../api/keys";
import { useProjectActions } from "../api/useProjectActions";
import { DETAILS_DOCUMENT_ID, detailsDocument } from "../documents";
import { CreateLayerDialog, useCreateLayer } from "../layers";
import { useActiveDocumentId, useOpenDocument } from "../state";
import { buildLayerWads } from "../utils/contentTree";
import { ContentLayerList } from "./ContentLayerList";
import { AddLocaleMenu, ContentStringsList } from "./ContentStringsList";
import { ContentWadList } from "./ContentWadList";

/* Which sections start open, for a user who has not touched a boundary yet. */
const SECTION_DEFAULTS: Record<string, boolean> = { layers: true, wads: false, strings: false };

const SORT_OPTIONS = [
  { value: "name" as const, label: "Name" },
  { value: "size" as const, label: "Size" },
];

interface ContentSidebarProps {
  project: WorkshopProject;
  contentLayers: readonly LayerContent[];
  selectedLayer: LayerContent | null;
  selectedLayerName: string | null;
  selectedLayerDisplayName: string;
  onSelect: (layerName: string) => void;
}

/** The content browser's explorers, stacked and each sized by the boundary below it. */
export function ContentSidebar({
  project,
  contentLayers,
  selectedLayer,
  selectedLayerName,
  selectedLayerDisplayName,
  onSelect,
}: ContentSidebarProps) {
  const queryClient = useQueryClient();
  const toast = useToast();

  const openDocument = useOpenDocument();
  const activeId = useActiveDocumentId();
  const projectActions = useProjectActions(project);
  const openSections = useOpenSections();
  const toggleSection = useToggleSection();
  const sectionHeights = useSectionHeights();
  const setSectionHeight = useSetSectionHeight();
  const wadSort = useWadSort();

  const [createOpen, setCreateOpen] = useState(false);
  const createLayer = useCreateLayer();

  function handleCreateSubmit(name: string, displayName: string, description: string) {
    createLayer.mutate(
      {
        projectPath: project.path,
        name,
        displayName: displayName || undefined,
        description: description || undefined,
      },
      {
        onSuccess: () => {
          setCreateOpen(false);
          queryClient.invalidateQueries({ queryKey: workshopKeys.contentTree(project.path) });
          onSelect(name);
        },
        onError: (err) => toast.error(`Failed to create layer: ${err.message}`),
      },
    );
  }

  const wads = useMemo(() => {
    const entries = buildLayerWads(selectedLayer?.entries ?? []);
    if (wadSort === "size") return entries.sort((a, b) => b.sizeBytes - a.sizeBytes);
    return entries.sort((a, b) => a.name.localeCompare(b.name));
  }, [selectedLayer, wadSort]);

  const stringsLayer = project.layers.find((layer) => layer.name === selectedLayerName) ?? null;
  const overrides = stringsLayer?.stringOverrides ?? {};
  const localeCount = Object.values(overrides).filter(
    (entries) => Object.keys(entries).length > 0,
  ).length;

  const sections: SidePanelSection[] = [
    {
      id: "layers",
      title: "Content",
      meta: project.layers.length,
      minHeight: 96,
      /* Most projects carry one layer, so the section takes the room its rows need
         and stops at roughly seven of them. */
      autoHeight: 200,
      actions: (
        <>
          <SectionSettings label="Content options">
            <ContentOptions />
          </SectionSettings>
          <Tooltip content="Add layer">
            <IconButton
              icon={<PlusIcon weight="bold" className="h-3.5 w-3.5" />}
              variant="ghost"
              size="xs"
              compact
              onClick={() => setCreateOpen(true)}
              aria-label="Add layer"
              className="h-5 w-5"
            />
          </Tooltip>
        </>
      ),
      content: (
        <ContentLayerList
          project={project}
          contentLayers={contentLayers}
          selectedLayerName={selectedLayerName}
          onSelect={onSelect}
        />
      ),
    },
    {
      id: "wads",
      title: "WADs",
      meta: wads.length,
      actions: (
        <SectionSettings label="WAD options">
          <WadOptions />
        </SectionSettings>
      ),
      content: (
        <ContentWadList
          wads={wads}
          layerName={selectedLayer?.name ?? null}
          layerDisplayName={selectedLayerDisplayName}
        />
      ),
    },
    {
      id: "strings",
      title: "Strings",
      meta: localeCount,
      actions: <AddLocaleMenu layerName={stringsLayer?.name ?? null} overrides={overrides} />,
      content: <ContentStringsList layerName={stringsLayer?.name ?? null} overrides={overrides} />,
    },
  ];

  const openIds = sections
    .filter((section) => openSections[section.id] ?? SECTION_DEFAULTS[section.id])
    .map((section) => section.id);

  return (
    <aside
      data-ui="ContentSidebar"
      /* DS-GROUND: an island inside the fold sits a rung below it. */
      className="flex h-full w-56 shrink-0 flex-col overflow-hidden rounded-xl border border-surface-700 bg-surface-950 select-none"
    >
      <ProjectRow
        detailsActive={activeId === DETAILS_DOCUMENT_ID}
        onOpenDetails={() => openDocument(detailsDocument())}
        onOpenFolder={projectActions.handleOpenLocation}
      />

      <SidePanel
        sections={sections}
        openIds={openIds}
        onToggle={(id) => toggleSection(id, !openIds.includes(id))}
        heights={sectionHeights}
        onResize={setSectionHeight}
      />

      <CreateLayerDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onSubmit={handleCreateSubmit}
        isPending={createLayer.isPending}
        existingNames={project.layers.map((l) => l.name)}
      />
    </aside>
  );
}

interface ProjectRowProps {
  detailsActive: boolean;
  onOpenDetails: () => void;
  onOpenFolder: () => void;
}

/** The project's own controls, above the explorers that belong to one layer. */
function ProjectRow({ detailsActive, onOpenDetails, onOpenFolder }: ProjectRowProps) {
  return (
    <div
      data-ui="ContentSidebar:project-row"
      className="flex h-9 shrink-0 items-center gap-1.5 border-b border-surface-700/50 px-2"
    >
      <Tooltip content="Mod details">
        <IconButton
          icon={<PlayerTitleIcon className="h-4 w-4" />}
          variant="ghost"
          size="sm"
          compact
          onClick={onOpenDetails}
          aria-label="Mod details"
          className={twMerge(
            detailsActive && "bg-accent-500/15 text-accent-100 hover:bg-accent-500/25",
          )}
        />
      </Tooltip>

      <Tooltip content="Open project folder">
        <IconButton
          icon={<FolderOpenIcon className="h-4 w-4" />}
          variant="ghost"
          size="sm"
          compact
          onClick={onOpenFolder}
          aria-label="Open project folder"
        />
      </Tooltip>

      {/* Left enabled, because Tooltip renders its trigger and a disabled button
          takes no pointer events - aria-disabled says what disabled would. */}
      <Tooltip content="Source control - under construction">
        <IconButton
          icon={<GitBranchIcon className="h-4 w-4" />}
          variant="ghost"
          size="sm"
          compact
          aria-disabled="true"
          aria-label="Source control"
          className="cursor-default text-surface-500 hover:bg-surface-veil-soft active:bg-surface-veil-soft"
        />
      </Tooltip>
    </div>
  );
}

function ContentOptions() {
  const showLayerStats = useShowLayerStats();
  const setShowLayerStats = useSetShowLayerStats();

  return (
    <FilterSection>
      <Checkbox
        size="sm"
        label="Show file counts"
        checked={showLayerStats}
        onCheckedChange={setShowLayerStats}
      />
    </FilterSection>
  );
}

function WadOptions() {
  const wadSort = useWadSort();
  const setWadSort = useSetWadSort();

  return (
    <FilterSection title="Sort by">
      <SegmentedControl options={SORT_OPTIONS} value={wadSort} onChange={setWadSort} />
    </FilterSection>
  );
}

interface SectionSettingsProps {
  label: string;
  children: ReactNode;
}

/** The gear a section carries for options that are its own and nobody else's. */
function SectionSettings({ label, children }: SectionSettingsProps) {
  return (
    <Popover.Root>
      <Tooltip content={label}>
        <Popover.Trigger
          render={
            <IconButton
              icon={<GearSixIcon className="h-3.5 w-3.5" />}
              variant="ghost"
              size="xs"
              compact
              aria-label={label}
              className="h-5 w-5"
            />
          }
        />
      </Tooltip>
      <Popover.Portal>
        <Popover.Positioner side="bottom" align="end" sideOffset={6}>
          <Popover.Popup
            aria-label={label}
            className="w-52 divide-y divide-surface-600/50 p-0 select-none"
          >
            {children}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
