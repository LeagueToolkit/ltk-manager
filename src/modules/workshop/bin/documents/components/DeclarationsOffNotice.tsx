import { LockSimpleIcon, SealCheckIcon, StackPlusIcon } from "@phosphor-icons/react";

import { AlertBox, Button } from "@/components";
import { m } from "@/i18n";
import type { AssetRef } from "@/lib/tauri";

import { useExtractActions } from "../../../gameBrowser/extraction/hooks/useExtractActions";
import { chunkTarget } from "../../../gameBrowser/extraction/utils/extractTargets";
import { useSetUseDeclarations } from "../../../state";

interface DeclarationsOffNoticeProps {
  asset: AssetRef;
  /** The chunk's path inside its archive, or its hash where no table names it. */
  file: string;
  /** What the copy's progress names. */
  subject: string;
}

/**
 * The strip over a game bin whose project has declarations off, offering the two ways to
 * edit it: copy the chunk into the selected layer, or turn declarations on.
 * "Declaring from a game bin" in docs/ux/BIN_EDITOR.md.
 */
export function DeclarationsOffNotice({ asset, file, subject }: DeclarationsOffNoticeProps) {
  const { run, layerLabel, busy } = useExtractActions();
  const setUseDeclarations = useSetUseDeclarations();

  const target = asset.kind === "gameChunk" ? chunkTarget(asset, `${asset.wad}/${file}`) : null;

  return (
    <AlertBox
      data-ui="DeclarationsOffNotice"
      variant="neutral"
      icon={<LockSimpleIcon className="h-4 w-4" />}
      title={m.workshop_bin_declarations_off_title()}
      className="mx-2 mt-2 shrink-0 select-none"
      actions={
        <>
          {target && layerLabel && (
            <Button
              variant="ghost"
              size="xs"
              left={<StackPlusIcon weight="bold" className="h-4 w-4" />}
              disabled={busy}
              onClick={() => run("copy", [target], subject)}
            >
              {m.workshop_preview_copy_into_action({ layer: layerLabel })}
            </Button>
          )}
          <Button
            variant="outline"
            size="xs"
            left={<SealCheckIcon weight="bold" className="h-4 w-4" />}
            onClick={() => setUseDeclarations(true)}
          >
            {m.workshop_bin_declarations_declare_action()}
          </Button>
        </>
      }
    >
      {m.workshop_bin_declarations_off_description()}
    </AlertBox>
  );
}
