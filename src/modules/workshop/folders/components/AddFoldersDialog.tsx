import { useState } from "react";

import { Button, Code, Dialog, RadioGroup, useToast } from "@/components";
import { errorSummary, m, Marked } from "@/i18n";
import type { AddFoldersReport } from "@/lib/tauri";
import { useSaveSettings, useSettings } from "@/modules/settings";
import { useDialog } from "@/stores";

import { useAddProjectFolders } from "../api/projectFolders";
import { useAddFoldersDialog } from "../state/dialogs";

/** What the batch does with the folder: add its mods, or become the workshop folder. */
type BatchChoice = "add" | "root";

/**
 * The offer for a picked folder whose subfolders are mods.
 *
 * Per "Open any folder" in `docs/ux/WORKSHOP.md`.
 */
export function AddFoldersDialog() {
  const { isOpen, payload, close } = useDialog(useAddFoldersDialog);
  const { success } = useToast();
  const addFolders = useAddProjectFolders();
  const saveSettings = useSaveSettings();
  const { data: settings } = useSettings();
  const [choice, setChoice] = useState<BatchChoice>("add");
  const [report, setReport] = useState<AddFoldersReport | null>(null);

  const projects = payload?.projects ?? [];
  const fantome = payload?.fantome ?? [];
  const count = projects.length + fantome.length;
  const pending = addFolders.isPending || saveSettings.isPending;

  function handleClose() {
    if (pending) return;
    setChoice("add");
    setReport(null);
    addFolders.reset();
    close();
  }

  function handleConfirm() {
    if (!payload) return;

    if (choice === "root") {
      if (!settings) return;
      saveSettings.mutate({ ...settings, workshopPath: payload.path }, { onSuccess: handleClose });
      return;
    }

    addFolders.mutate([...projects, ...fantome], {
      onSuccess: (result) => {
        success(m.workshop_folder_parent_added_title({ count: result.added.length }));
        if (result.failed.length === 0) {
          handleClose();
          return;
        }

        setReport(result);
      },
    });
  }

  return (
    <Dialog.Shell
      open={isOpen}
      onClose={handleClose}
      title={m.workshop_folder_parent_title({ count })}
      size="lg"
      closable={!pending}
    >
      <Dialog.Body className="flex flex-col gap-4">
        <p className="text-sm text-surface-400">
          <Marked text={m.workshop_folder_parent_description({ path: payload?.path ?? "" })}>
            {(literal) => <Code>{literal}</Code>}
          </Marked>
        </p>

        {report && <FailedFolders report={report} />}

        {!report && (
          <>
            <ul className="flex flex-col divide-y divide-surface-700 rounded-lg border border-surface-700 bg-surface-950/30 text-sm">
              {projects.length > 0 && (
                <li className="px-3 py-2 text-surface-200">
                  {m.workshop_folder_parent_projects_label({ count: projects.length })}
                </li>
              )}
              {fantome.length > 0 && (
                <li className="px-3 py-2 text-surface-200">
                  {m.workshop_folder_parent_fantome_label({ count: fantome.length })}
                </li>
              )}
            </ul>

            <RadioGroup.Root
              value={choice}
              onValueChange={(value: unknown) => setChoice(value as BatchChoice)}
            >
              <RadioGroup.Options>
                <RadioGroup.Card
                  value="add"
                  title={m.workshop_folder_parent_add_label()}
                  description={m.workshop_folder_parent_add_description()}
                />
                <RadioGroup.Card
                  value="root"
                  title={m.workshop_folder_parent_root_label()}
                  description={m.workshop_folder_parent_root_description()}
                />
              </RadioGroup.Options>
            </RadioGroup.Root>
          </>
        )}

        {addFolders.error && (
          <p className="text-sm text-danger-text select-text">{errorSummary(addFolders.error)}</p>
        )}
      </Dialog.Body>

      <Dialog.Footer>
        <Button variant="ghost" onClick={handleClose} disabled={pending}>
          {m.common_cancel_action()}
        </Button>
        {!report && (
          <Button variant="filled" loading={pending} disabled={pending} onClick={handleConfirm}>
            {choice === "add"
              ? m.workshop_folder_parent_add_action({ count })
              : m.workshop_folder_parent_root_action()}
          </Button>
        )}
      </Dialog.Footer>
    </Dialog.Shell>
  );
}

/** The folders a batch could not add, each with the reason. */
function FailedFolders({ report }: { report: AddFoldersReport }) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm font-medium text-warning-text">
        {m.workshop_folder_parent_failed_title({ count: report.failed.length })}
      </p>
      <ul className="flex max-h-72 flex-col divide-y divide-surface-700 overflow-y-auto rounded-lg border border-surface-700 bg-surface-950/30 text-sm scrollbar-md">
        {report.failed.map((failure) => (
          <li key={failure.path} className="flex flex-col gap-0.5 px-3 py-2 select-text">
            <span className="truncate font-mono text-code text-surface-200">{failure.path}</span>
            <span className="text-meta text-surface-400">{failure.message}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
