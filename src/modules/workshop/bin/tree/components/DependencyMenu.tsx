import {
  ArrowCounterClockwiseIcon,
  ArrowDownIcon,
  ArrowSquareOutIcon,
  ArrowUpIcon,
  MinusCircleIcon,
  PathIcon,
  PencilSimpleIcon,
} from "@phosphor-icons/react";
import { use } from "react";

import { ContextMenu } from "@/components";
import { useCopyToClipboard } from "@/hooks";
import { m } from "@/i18n";

import { useChunkOpen } from "../../links/hooks/useLinkTargets";
import { useDependencyAbilities, useSendDependencyEdit } from "../hooks/useDependencyRow";
import { DependencyEditingContext } from "../state/dependencyEditing";
import type { VisibleRow } from "../utils/binRows";
import type { DependencyLine } from "./DependencyRows";

interface DependencyMenuProps {
  /** The line the tree's menu was opened on. */
  line: VisibleRow | null;
}

/**
 * The menu of a dependency row: Open, Open beside, Copy path, Edit path, the moves and
 * Remove, or Restore and Copy path on one the chosen layer removes. Copy path copies the path
 * itself, never its brex spelling. "Dependencies" in docs/ux/BIN_EDITOR.md.
 */
export function DependencyMenu({ line }: DependencyMenuProps) {
  if (line?.kind !== "dependency") return null;
  return <DependencyMenuItems line={line} />;
}

function DependencyMenuItems({ line }: { line: DependencyLine }) {
  const { dependency, index, count } = line;
  const { path } = dependency;
  const { edit, refusal, removed } = useDependencyAbilities(path);
  const editing = use(DependencyEditingContext);
  const open = useChunkOpen(path);
  const copy = useCopyToClipboard();
  const send = useSendDependencyEdit();
  const copyPath = (
    <ContextMenu.Item
      icon={<PathIcon />}
      onClick={() => void copy(path, m.workshop_bin_path_label())}
    >
      {m.workshop_bin_copy_path_action()}
    </ContextMenu.Item>
  );

  if (removed) {
    return (
      <ContextMenu.Portal>
        <ContextMenu.Positioner>
          <ContextMenu.Popup className="w-56">
            {edit !== null && (
              <ContextMenu.Item
                icon={<ArrowCounterClockwiseIcon />}
                onClick={() => send(edit.restore(path))}
              >
                {m.workshop_bin_dependency_restore_action()}
              </ContextMenu.Item>
            )}
            {copyPath}
          </ContextMenu.Popup>
        </ContextMenu.Positioner>
      </ContextMenu.Portal>
    );
  }

  return (
    <ContextMenu.Portal>
      <ContextMenu.Positioner>
        <ContextMenu.Popup className="w-56">
          <ContextMenu.Item
            icon={<ArrowSquareOutIcon />}
            disabled={open === null}
            onClick={() => open?.("default")}
          >
            {m.workshop_bin_dependency_open_action()}
          </ContextMenu.Item>
          <ContextMenu.Item
            icon={<ArrowSquareOutIcon />}
            disabled={open === null}
            onClick={() => open?.("beside")}
          >
            {m.workshop_bin_dependency_open_beside_action()}
          </ContextMenu.Item>
          {copyPath}
          {edit !== null && (
            <>
              <ContextMenu.Separator />
              <ContextMenu.Item
                icon={<PencilSimpleIcon />}
                disabled={refusal !== null}
                title={refusal ?? undefined}
                onClick={() => editing.start(index)}
              >
                {m.workshop_bin_dependency_edit_action()}
              </ContextMenu.Item>
              {index > 0 && (
                <ContextMenu.Item
                  icon={<ArrowUpIcon />}
                  disabled={refusal !== null}
                  title={refusal ?? undefined}
                  onClick={() => send(edit.move(index, index - 1))}
                >
                  {m.workshop_bin_move_up_action()}
                </ContextMenu.Item>
              )}
              {index < count - 1 && (
                <ContextMenu.Item
                  icon={<ArrowDownIcon />}
                  disabled={refusal !== null}
                  title={refusal ?? undefined}
                  onClick={() => send(edit.move(index, index + 1))}
                >
                  {m.workshop_bin_move_down_action()}
                </ContextMenu.Item>
              )}
              <ContextMenu.Item icon={<MinusCircleIcon />} onClick={() => send(edit.remove(index))}>
                {m.workshop_bin_dependency_remove_action()}
              </ContextMenu.Item>
            </>
          )}
        </ContextMenu.Popup>
      </ContextMenu.Positioner>
    </ContextMenu.Portal>
  );
}
