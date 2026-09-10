import { CaretRightIcon } from "@phosphor-icons/react";

import { Menu, Spinner } from "@/components";
import { m } from "@/i18n";

import type { SourceDirSummary } from "../gameBrowser/sourceIndex";

export interface CrumbSiblingsProps {
  /** The crumb this caret sits after, whose children it lists. */
  path: string;
  onNavigate: (path: string) => void;
  /**
   * The directories under a path, and null while a source is still reading it.
   *
   * A hook rather than a value, so a trail six crumbs long asks for one
   * listing - the one whose caret was opened - and not for six.
   */
  useChildDirs: (path: string) => readonly SourceDirSummary[] | null;
}

/**
 * The caret between two crumbs, and where the trail could have gone instead.
 *
 * A move from `skins/base` to `skins/skin01` costs one click here, where the
 * crumbs alone would cost a move up and a move back down.
 */
export function CrumbSiblings({ path, onNavigate, useChildDirs }: CrumbSiblingsProps) {
  return (
    <Menu.Root>
      <Menu.Trigger
        aria-label={m.workshop_explorer_siblings_action()}
        className="mx-0.5 rounded-sm p-0.5 text-surface-500 outline-none hover:bg-surface-veil hover:text-surface-200"
      >
        <CaretRightIcon weight="bold" className="h-3 w-3" />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner side="bottom" align="start" sideOffset={4}>
          <Menu.Popup className="max-h-80 w-64 overflow-auto scrollbar-md">
            <SiblingItems path={path} onNavigate={onNavigate} useChildDirs={useChildDirs} />
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}

/* Its own component, so the listing is asked for when the popup mounts rather
   than when the bar renders. */
function SiblingItems({ path, onNavigate, useChildDirs }: CrumbSiblingsProps) {
  const dirs = useChildDirs(path);

  if (dirs === null) {
    return (
      <div className="flex items-center justify-center p-2">
        <Spinner size="sm" />
      </div>
    );
  }

  if (dirs.length === 0) {
    return (
      <div className="px-2 py-1 text-meta text-surface-400">
        {m.workshop_explorer_siblings_empty()}
      </div>
    );
  }

  return (
    <>
      {dirs.map((dir) => (
        <Menu.Item key={dir.path} onClick={() => onNavigate(dir.path)}>
          <span className="truncate">{dir.name}</span>
        </Menu.Item>
      ))}
    </>
  );
}
