import { ArrowUpIcon } from "@phosphor-icons/react";
import { type ReactNode } from "react";

import { Breadcrumb, type BreadcrumbItem, IconButton, Tooltip } from "@/components";
import { m } from "@/i18n";
import type { ExplorerView } from "@/stores";

import { ExplorerOptions, SelectionReadout, ViewToggle } from "./ExplorerBarControls";
import type { ExplorerFilter } from "./filter";
import type { Crumb } from "./location";
import { PathInput } from "./PathInput";
import type { SelectionSummary } from "./selection";

export interface ExplorerBarProps {
  crumbs: readonly Crumb[];
  onNavigate: (path: string) => void;
  onUp: () => void;
  atRoot: boolean;
  /** The caret between two crumbs, which lists where else the trail could go. */
  renderSiblings?: (crumb: BreadcrumbItem) => ReactNode;
  /** The directories under a typed path, which complete the segment being typed. */
  useCompletions: (directory: string) => readonly string[];
  /** True while the breadcrumb has given way to the typed path. */
  typing: boolean;
  onTypingChange: (typing: boolean) => void;
  location: string;

  view: ExplorerView;
  filter: ExplorerFilter;
  onFilterChange: (filter: ExplorerFilter) => void;
  /** The box, which carries its own scope control. */
  box: ReactNode;

  selection: SelectionSummary;
  onClearSelection: () => void;
  /** The source's own controls: its counts, its rebuild, its ways out. */
  actions?: ReactNode;
}

/**
 * The chrome an explorer draws: what its source holds, and where it is.
 *
 * Two rows, the way a file manager draws them. The location and the box lead,
 * reading as one line - where I am, and what I am looking for inside it - and
 * neither has a width it can give up: a crumb trail folds away the moment it
 * shares a row with a count, a segmented control and a 288px box. What the
 * source contributes and how the rows draw follow underneath, because those are
 * set once and the location is read on every move.
 */
export function ExplorerBar({
  crumbs,
  onNavigate,
  onUp,
  atRoot,
  renderSiblings,
  useCompletions,
  typing,
  onTypingChange,
  location,
  view,
  filter,
  onFilterChange,
  box,
  selection,
  onClearSelection,
  actions,
}: ExplorerBarProps) {
  const items = crumbs.map<BreadcrumbItem>((crumb) => ({ id: crumb.path, label: crumb.label }));

  return (
    <div data-ui="ExplorerBar" className="flex min-w-0 flex-1 flex-col gap-1 select-none">
      <div data-ui="ExplorerBar:location" className="flex min-w-0 items-center gap-1.5">
        <Tooltip content={m.workshop_explorer_up_label()}>
          <IconButton
            icon={<ArrowUpIcon weight="bold" className="h-4 w-4" />}
            variant="ghost"
            size="xs"
            compact
            disabled={atRoot}
            onClick={onUp}
            aria-label={m.workshop_explorer_up_action()}
          />
        </Tooltip>

        <Location
          items={items}
          location={location}
          typing={typing}
          onTypingChange={onTypingChange}
          onNavigate={onNavigate}
          useCompletions={useCompletions}
          renderSiblings={renderSiblings}
        />

        {box}
      </div>

      <div data-ui="ExplorerBar:source" className="flex min-w-0 items-center justify-end gap-1">
        <SelectionReadout selection={selection} onClear={onClearSelection} />
        {actions}
        <span className="mx-0.5 h-4 w-px shrink-0 bg-surface-veil-strong" aria-hidden />
        <ViewToggle view={view} />
        <ExplorerOptions view={view} filter={filter} onFilterChange={onFilterChange} />
      </div>
    </div>
  );
}

interface LocationProps {
  items: BreadcrumbItem[];
  location: string;
  typing: boolean;
  onTypingChange: (typing: boolean) => void;
  onNavigate: (path: string) => void;
  useCompletions: (directory: string) => readonly string[];
  renderSiblings?: (crumb: BreadcrumbItem) => ReactNode;
}

function Location({
  items,
  location,
  typing,
  onTypingChange,
  onNavigate,
  useCompletions,
  renderSiblings,
}: LocationProps) {
  if (typing) {
    return (
      <PathInput
        location={location}
        useCompletions={useCompletions}
        onCommit={(path) => {
          onNavigate(path);
          onTypingChange(false);
        }}
        onCancel={() => onTypingChange(false)}
      />
    );
  }

  return (
    <div className="flex min-w-0 flex-1 items-center">
      <Breadcrumb
        items={items}
        onNavigate={onNavigate}
        aria-label={m.workshop_explorer_location_label()}
        renderSiblings={renderSiblings}
      />
      {/* The empty run after the last crumb is the target Ctrl+L also reaches. */}
      <button
        type="button"
        aria-label={m.workshop_explorer_path_action()}
        className="h-6 min-w-6 flex-1 cursor-text rounded-sm"
        onClick={() => onTypingChange(true)}
      />
    </div>
  );
}
