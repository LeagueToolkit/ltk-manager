import { CheckCircleIcon, XCircleIcon } from "@phosphor-icons/react";

import { Badge, Checkbox, Progress, Spinner } from "@/components";
import { describeError, m } from "@/i18n";
import type {
  AppError,
  InstallListItem,
  InstallListStage,
  ProtocolInstallProgress,
} from "@/lib/tauri";

export interface InstallListRowProps {
  item: InstallListItem;
  /** Already in the library at the listed version, so not offered. */
  isCurrent: boolean;
  checked: boolean;
  /** Whether the row offers its checkbox, before the run. */
  choosing: boolean;
  stage: InstallListStage | null;
  bytes: ProtocolInstallProgress | null;
  failure: AppError | null;
  onToggle: (checked: boolean) => void;
}

/** One mod of the list: its checkbox before the run, and its stage during and after. */
export function InstallListRow({
  item,
  isCurrent,
  checked,
  choosing,
  stage,
  bytes,
  failure,
  onToggle,
}: InstallListRowProps) {
  const dimmed = isCurrent || (!choosing && stage === null && !checked);

  return (
    <li
      data-item-id={item.id}
      className={`flex flex-col gap-1 px-3 py-2 ${dimmed ? "opacity-60" : ""}`}
    >
      <div className="flex items-center gap-3">
        {choosing && !isCurrent && (
          <Checkbox
            size="sm"
            checked={checked}
            onCheckedChange={(next) => onToggle(next === true)}
            aria-label={item.name}
          />
        )}
        {(!choosing || isCurrent) && <StageMark stage={stage} isCurrent={isCurrent} />}
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm text-surface-100">{item.name}</p>
          <p className="truncate text-xs text-surface-400">
            {[item.author, item.version].filter(Boolean).join(" · ")}
          </p>
        </div>
        <StageBadge stage={stage} isCurrent={isCurrent} />
      </div>
      {bytes && bytes.stage === "downloading" && <BytesBar progress={bytes} />}
      {failure && <p className="pl-7 text-xs text-danger-text">{describeError(failure).title}</p>}
    </li>
  );
}

function StageMark({ stage, isCurrent }: { stage: InstallListStage | null; isCurrent: boolean }) {
  if (isCurrent || stage === "installed" || stage === "updated" || stage === "alreadyInstalled") {
    return <CheckCircleIcon className="size-4 shrink-0 text-success-text" />;
  }
  if (stage === "failed") return <XCircleIcon className="size-4 shrink-0 text-danger-text" />;
  if (stage !== null) return <Spinner size={16} />;
  return <span className="size-4 shrink-0" />;
}

function StageBadge({ stage, isCurrent }: { stage: InstallListStage | null; isCurrent: boolean }) {
  if (isCurrent) return <Badge tone="success">{m.deep_link_list_installed_badge()}</Badge>;
  switch (stage) {
    case "resolving":
      return <span className="text-xs text-surface-400">{m.deep_link_list_stage_resolving()}</span>;
    case "downloading":
      return (
        <span className="text-xs text-surface-400">{m.deep_link_list_stage_downloading()}</span>
      );
    case "installing":
      return (
        <span className="text-xs text-surface-400">{m.deep_link_list_stage_installing()}</span>
      );
    case "installed":
      return <Badge tone="success">{m.deep_link_list_stage_installed()}</Badge>;
    case "updated":
      return <Badge tone="success">{m.deep_link_list_stage_updated()}</Badge>;
    case "alreadyInstalled":
      return <Badge tone="neutral">{m.deep_link_list_stage_already_installed()}</Badge>;
    case "failed":
      return <Badge tone="danger">{m.deep_link_list_stage_failed()}</Badge>;
    case null:
      return null;
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function BytesBar({ progress }: { progress: ProtocolInstallProgress }) {
  const downloaded = Number(progress.bytesDownloaded);
  const total = progress.totalBytes ? Number(progress.totalBytes) : null;
  const valueLabel = total
    ? `${formatBytes(downloaded)} / ${formatBytes(total)}`
    : formatBytes(downloaded);

  return (
    <div className="pl-7">
      <Progress.Root value={total ? downloaded : null} max={total ?? undefined}>
        <Progress.Track size="sm">
          <Progress.Indicator />
        </Progress.Track>
        <div className="mt-1 text-right text-xs text-surface-400">{valueLabel}</div>
      </Progress.Root>
    </div>
  );
}
