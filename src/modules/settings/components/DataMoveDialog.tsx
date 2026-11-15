import { FolderSimpleIcon } from "@phosphor-icons/react";

import { ConfirmDialog, ProgressBar, useToast } from "@/components";
import { describeError, m } from "@/i18n";
import type { DataMovePlan, DataMoveProgress } from "@/lib/tauri";
import { useTauriProgress } from "@/lib/useTauriProgress";
import { formatBytes } from "@/utils";

import { useMoveData } from "../api";

interface DataMoveDialogProps {
  /** The planned move, or `null` while none is asked for. */
  plan: DataMovePlan | null;
  /** The folder that `plan` moves to, or `null` for the app data directory. */
  target: string | null;
  onClose: () => void;
}

/** No stage ends the stream, because a move that succeeds restarts the app. */
const NO_TERMINAL_STAGES: string[] = [];

/**
 * Confirmation for a planned move of the data directory, which then shows the move's progress.
 *
 * The dialog cannot close while the move runs. A failed move closes it and raises a toast.
 */
export function DataMoveDialog({ plan, target, onClose }: DataMoveDialogProps) {
  const move = useMoveData();
  const toast = useToast();
  const { progress } = useTauriProgress<DataMoveProgress>("data-move-progress", {
    terminalStages: NO_TERMINAL_STAGES,
  });

  if (plan === null) return null;

  const copy = dialogCopy(plan);

  function confirm() {
    move.mutate(target, {
      onError: (error) => {
        const { title, description, detail } = describeError(error);
        toast.failure(title, error, { description: description ?? detail });
        onClose();
      },
    });
  }

  function close() {
    if (!move.isPending) onClose();
  }

  return (
    <ConfirmDialog
      open
      onClose={close}
      title={copy.title}
      heading={copy.heading}
      description={copy.description}
      confirmLabel={copy.action}
      onConfirm={confirm}
      pending={move.isPending}
      tone="warning"
      icon={<FolderSimpleIcon weight="bold" className="size-5" />}
    >
      {move.isPending && progress && <MoveProgress progress={progress} />}
    </ConfirmDialog>
  );
}

function dialogCopy(plan: DataMovePlan) {
  const path = plan.to;
  if (plan.kind === "adopt") {
    return {
      title: m.settings_data_adopt_title(),
      heading: m.settings_data_adopt_heading({ path }),
      description: m.settings_data_adopt_description(),
      action: m.settings_data_adopt_action(),
    };
  }

  const bytes = plan.entries.reduce((total, entry) => total + entry.bytes, 0);
  return {
    title: m.settings_data_move_title(),
    heading: m.settings_data_move_heading({ size: formatBytes(bytes), path }),
    description: m.settings_data_move_description(),
    action: m.settings_data_move_action(),
  };
}

function MoveProgress({ progress }: { progress: DataMoveProgress }) {
  if (progress.stage === "restarting") {
    return <ProgressBar value={null} size="sm" label={m.settings_data_move_restarting_label()} />;
  }

  const percent = progress.total === 0 ? 100 : (progress.moved / progress.total) * 100;
  return (
    <ProgressBar
      value={percent}
      size="sm"
      label={m.settings_data_move_progress_label({ entry: progress.currentEntry ?? "" })}
      valueLabel={m.settings_data_move_progress_value({
        moved: formatBytes(progress.moved),
        total: formatBytes(progress.total),
      })}
    />
  );
}
