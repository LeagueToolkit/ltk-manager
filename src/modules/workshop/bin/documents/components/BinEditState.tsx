import { LockSimpleIcon, PlusIcon, SealCheckIcon } from "@phosphor-icons/react";
import { use } from "react";

import { Button, Tooltip, useToast } from "@/components";
import { errorSummary, m, readOnlyDescription } from "@/i18n";
import { api, type AssetRef, type BinDocumentId, type ReadOnly } from "@/lib/tauri";
import { SaveStatus } from "@/modules/editor";

import { useSandbox } from "../../../sandbox/state/SandboxContext";
import {
  binSaveKey,
  forgetBinSave,
  saveBinNow,
  useBinSave,
  useSetUseDeclarations,
} from "../../../state";
import { useInvalidateBinReads } from "../../tree/hooks/useBinEdit";
import { NewObjectContext } from "../../tree/state/newObject";
import { useDeclaredState } from "../hooks/useDeclared";
import { DeclaredDiagnosticsMark } from "./DeclaredLayer";

interface BinEditStateProps {
  document: BinDocumentId;
  asset: AssetRef;
  /** The gate the document stands behind, null where it takes edits. */
  readOnly: ReadOnly | null;
  /** Open the document again after a reload replaced its tree. */
  onReload: () => void;
}

/**
 * The editing state in a bin tab's toolbar: why it is read-only, what the last apply of a
 * declared document reported, or its autosave. The tab's Sandbox options show where edits go.
 */
export function BinEditState({ document, asset, readOnly, onReload }: BinEditStateProps) {
  const declared = useDeclaredState(document);
  if (declared !== null && (readOnly === null || readOnly === "declarationsOff")) {
    return (
      <span className="flex shrink-0 items-center gap-1">
        <NewObjectAction />
        <DeclaredDiagnosticsMark
          diagnostics={declared.diagnostics.filter((diagnostic) => diagnostic.entry.length === 0)}
        />
        {readOnly !== null && <DeclareEditsAction />}
      </span>
    );
  }
  if (readOnly === "declarationsOff") return <DeclareEditsAction />;
  if (readOnly !== null) return <ReadOnlyMark gate={readOnly} />;
  return <AutosaveStatus document={document} asset={asset} onReload={onReload} />;
}

/** The toolbar's `Declare edits`, which turns game data declarations on for the project. */
function DeclareEditsAction() {
  const setUseDeclarations = useSetUseDeclarations();

  return (
    <Button
      variant="outline"
      size="xs"
      className="shrink-0"
      left={<SealCheckIcon weight="bold" className="size-3" />}
      onClick={() => setUseDeclarations(true)}
    >
      {m.workshop_bin_declarations_declare_action()}
    </Button>
  );
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
        left={<PlusIcon weight="bold" className="size-3" />}
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

/**
 * Returns the reload of `document` and whether its last save failed on a change on disk, which
 * is when a reload is what the reader can do.
 */
export function useBinReload(document: BinDocumentId, asset: AssetRef, onReload: () => void) {
  const key = binSaveKey(useSandbox(), asset);
  const save = useBinSave(key);
  const invalidate = useInvalidateBinReads();
  const toast = useToast();

  function reload() {
    void api.bin.reload(document).then((result) => {
      if (!result.ok) {
        toast.failure(m.workshop_bin_reload_failed_title(), result.error);
        return;
      }
      forgetBinSave(key);
      invalidate();
      onReload();
    });
  }

  return {
    changedOnDisk: save.state === "failed" && save.error?.code === "BIN_CHANGED_ON_DISK",
    reload,
  };
}

function AutosaveStatus({ document, asset, onReload }: AutosaveStatusProps) {
  const key = binSaveKey(useSandbox(), asset);
  const save = useBinSave(key);
  const { changedOnDisk, reload } = useBinReload(document, asset, onReload);

  if (changedOnDisk && save.error !== null) {
    return (
      <span className="flex shrink-0 items-center gap-1.5">
        <Tooltip content={errorSummary(save.error)}>
          {/* DS-TEXT */}
          <span className="text-meta text-danger-text select-none">
            {m.workshop_bin_changed_on_disk_hint()}
          </span>
        </Tooltip>
        <Button variant="ghost" size="xs" onClick={reload}>
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
        <LockSimpleIcon className="size-3.5" />
        {m.workshop_bin_read_only_label()}
      </span>
    </Tooltip>
  );
}
