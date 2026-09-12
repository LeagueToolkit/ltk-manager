import { ArrowsClockwiseIcon } from "@phosphor-icons/react";
import { useRef } from "react";

import { IconButton, Tooltip } from "@/components";
import { m } from "@/i18n";
import { DocumentToolbar } from "@/modules/editor";
import { twMerge } from "@/utils";

import { TreeSearchBox } from "../components/TreeSearchBox";
import { GAME_EXPLORER_ID, GameIndexTree, useRefreshGameIndex } from "../gameBrowser";
import { useExplorerFilter, useSetExplorerFilter } from "../state";
import { focusRows } from "../utils/focusRows";

/**
 * The install's own directories, as the tree the panel is wide enough for.
 *
 * The grid and the details list of the same browser want a surface, so the
 * document keeps them and the panel narrows to what a tree needs. The box here
 * filters the rows already read, where Search reads the whole index.
 */
export function GameIndexView() {
  const bodyRef = useRef<HTMLDivElement>(null);

  return (
    <>
      <DocumentToolbar active>
        <FilterField onCommit={() => focusRows(bodyRef.current)} />
        <RebuildAction />
      </DocumentToolbar>

      <div ref={bodyRef} className="flex min-h-0 flex-1 flex-col">
        <GameIndexTree />
      </div>
    </>
  );
}

function FilterField({ onCommit }: { onCommit: () => void }) {
  const filter = useExplorerFilter(GAME_EXPLORER_ID);
  const setFilter = useSetExplorerFilter();

  return (
    <TreeSearchBox
      value={filter.text}
      onChange={(text) => setFilter(GAME_EXPLORER_ID, { ...filter, text })}
      label={m.workshop_game_files_tree_label()}
      clearLabel={m.workshop_explorer_clear_box_action()}
      onCommit={onCommit}
    />
  );
}

function RebuildAction() {
  const rebuild = useRefreshGameIndex();

  return (
    <Tooltip content={m.workshop_game_rebuild_label()}>
      <IconButton
        icon={
          <ArrowsClockwiseIcon
            className={twMerge("h-4 w-4", rebuild.isPending && "animate-spin")}
          />
        }
        variant="ghost"
        size="xs"
        compact
        onClick={() => rebuild.mutate()}
        disabled={rebuild.isPending}
        aria-label={m.workshop_game_rebuild_action()}
      />
    </Tooltip>
  );
}
