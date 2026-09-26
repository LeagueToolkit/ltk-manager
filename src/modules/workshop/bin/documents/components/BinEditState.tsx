import { LockSimpleIcon, PlusIcon } from "@phosphor-icons/react";
import { use } from "react";

import { Button, Tooltip, useToast } from "@/components";
import { errorSummary, m, readOnlyDescription } from "@/i18n";
import { api, type AssetRef, type BinDocumentId, type ReadOnly } from "@/lib/tauri";
import { SaveStatus } from "@/modules/editor";

import { assetKey } from "../../../preview/utils/assetRef";
import { forgetBinSave, saveBinNow, useBinSave } from "../../../state";
import { useInvalidateBinReads } from "../../tree/hooks/useBinEdit";
import { NewObjectContext } from "../../tree/state/newObject";
import { useDeclaredState } from "../hooks/useDeclared";
import { DeclaredLayerChip } from "./DeclaredLayer";

interface BinEditStateProps {
  document: BinDocumentId;
  asset: AssetRef;
  /** The gate the document stands behind, null where it takes edits. */
  readOnly: ReadOnly | null;
  /** Open the document again after a reload replaced its tree. */
  onReload: () => void;
}

/**
 * What a bin tab's toolbar says about editing: the gate it stands behind, the layer it
 * declares into, or its autosave. A declared document with declarations off keeps its chip,
 * which is where they turn back on.
 */
export function BinEditState({ document, asset, readOnly, onReload }: BinEditStateProps) {
  const declared = useDeclaredState(document);
  if (declared !== null && (readOnly === null || readOnly === "declarationsOff")) {
    return (
      <span className="flex shrink-0 items-center gap-1">
        <NewObjectAction />
        <DeclaredLayerChip document={document} declared={declared} readOnly={readOnly} />
      </span>
    );
  }
  if (readOnly !== null) return <ReadOnlyMark gate={readOnly} />;
  return <AutosaveStatus document={document} asset={asset} onReload={onReload} />;
}

/**
 * The toolbar's `+ Object`, which opens the class line after the file's objects. ADR-0049.
 * Absent where the document provides no draft, as a read-only one does.
 */
function NewObjectAction() {
  const drafts = use(NewObjectContext);
  if (drafts === null) return null;

  return (
    <Tooltip content={m.workshop_bin_new_object_hint()}>
      <Button
        variant="ghost"
        size="xs"
        compact
        left={<PlusIcon weight="bold" className="h-3 w-3" />}
        onClick={() => drafts.start({ kind: "class" })}
      >
        {m.workshop_bin_new_object_action()}
      </Button>
    </Tooltip>
  );
}

interface AutosaveStatusProps {
  document: BinDocumentId;
  asset: AssetRef;
  onReload: () => void;
}

function AutosaveStatus({ document, asset, onReload }: AutosaveStatusProps) {
  const key = assetKey(asset);
  const save = useBinSave(key);
  const invalidate = useInvalidateBinReads();
  const toast = useToast();

  function reload() {
    void api.bin.reload(document).then((result) => {
      if (!result.ok) {
        toast.error(m.workshop_bin_reload_failed_title(), errorSummary(result.error));
        return;
      }
      forgetBinSave(key);
      invalidate();
      onReload();
    });
  }

  if (save.state === "failed" && save.error?.code === "BIN_CHANGED_ON_DISK") {
    return (
      <span className="flex shrink-0 items-center gap-1.5">
        <Tooltip content={errorSummary(save.error)}>
          {/* DS-TEXT */}
          <span className="text-[0.6875rem] text-danger-text select-none">
            {m.workshop_bin_changed_on_disk_hint()}
          </span>
        </Tooltip>
        <Button variant="ghost" size="xs" compact onClick={reload}>
          {m.workshop_bin_reload_action()}
        </Button>
      </span>
    );
  }

  return (
    <SaveStatus
      state={save.state}
      blockedHint={m.workshop_bin_refused_hint()}
      failedReason={save.error === null ? undefined : errorSummary(save.error)}
      onRetry={() => void saveBinNow(key, document).catch(() => {})}
    />
  );
}

function ReadOnlyMark({ gate }: { gate: ReadOnly }) {
  return (
    <Tooltip content={readOnlyDescription(gate)}>
      <span className="flex shrink-0 items-center gap-1 text-meta text-surface-400 select-none">
        <LockSimpleIcon className="h-3.5 w-3.5" />
        {m.workshop_bin_read_only_label()}
      </span>
    </Tooltip>
  );
}
