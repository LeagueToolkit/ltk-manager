import { DownloadSimpleIcon, StackPlusIcon } from "@phosphor-icons/react";

import { ContextMenu } from "@/components";
import { shortcutOf } from "@/modules/keys";

import { type ExtractHow, useExtractActions } from "../hooks/useExtractActions";

interface ExtractMenuItemsProps {
  /** Runs whichever way was picked against whatever the menu was opened on. */
  onRun: (how: ExtractHow) => void;
}

/**
 * The three ways out of the browser, as the items every row's menu carries.
 *
 * **Copy into `<layer>`** above the extracts, and naming its layer, per
 * "Copy into a layer" in `docs/ux/PROJECT_EDITOR.md`.
 */
export function ExtractMenuItems({ onRun }: ExtractMenuItemsProps) {
  const { lastFolder, layerLabel, busy } = useExtractActions();

  return (
    <>
      {layerLabel && (
        <ContextMenu.Item
          icon={<StackPlusIcon className="size-4" />}
          shortcut={shortcutOf("explorer.copyToLayer")}
          disabled={busy}
          onClick={() => onRun("copy")}
        >
          Copy into {layerLabel}
        </ContextMenu.Item>
      )}
      {lastFolder && (
        <ContextMenu.Item
          icon={<DownloadSimpleIcon className="size-4" />}
          shortcut={shortcutOf("explorer.extract")}
          disabled={busy}
          onClick={() => onRun("quick")}
        >
          Extract to {lastFolder}
        </ContextMenu.Item>
      )}
      {/* The ellipsis is the promise of the dialog that follows. It takes the
          plain key while there is no folder to go straight to, because then it
          is the only extract there is. */}
      <ContextMenu.Item
        icon={<DownloadSimpleIcon className="size-4" />}
        shortcut={shortcutOf(lastFolder ? "explorer.extractTo" : "explorer.extract")}
        onClick={() => onRun("dialog")}
      >
        Extract…
      </ContextMenu.Item>
    </>
  );
}
