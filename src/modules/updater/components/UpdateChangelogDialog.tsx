import { DownloadIcon, SparkleIcon } from "@phosphor-icons/react";

import { AlertBox, Button, Checkbox, Dialog, Progress } from "@/components";
import { m } from "@/i18n";
import {
  useQueuedDialog,
  useUpdaterDialogOpen,
  useUpdaterDismissError,
  useUpdaterError,
  useUpdaterProgress,
  useUpdaterSetDialogOpen,
  useUpdaterSetSkipVersion,
  useUpdaterSkippedVersion,
  useUpdaterUpdate,
  useUpdaterUpdating,
} from "@/stores";

import { useInstallUpdate } from "../api";
import { ReleaseHistory } from "./ReleaseHistory";
import { ReleaseSection } from "./ReleaseSection";

export function UpdateChangelogDialog() {
  const update = useUpdaterUpdate();
  const dialogOpen = useUpdaterDialogOpen();
  const setDialogOpen = useUpdaterSetDialogOpen();
  const downloadAndInstall = useInstallUpdate();
  const updating = useUpdaterUpdating();
  const progress = useUpdaterProgress();
  const error = useUpdaterError();
  const dismissError = useUpdaterDismissError();
  const skippedVersion = useUpdaterSkippedVersion();
  const setSkipVersion = useUpdaterSetSkipVersion();
  const showing = useQueuedDialog("update", dialogOpen && update !== null);
  if (!update) return null;

  const skipped = skippedVersion === update.version;
  const installLabel = error ? m.updater_install_retry_action() : m.updater_install_action();

  return (
    <Dialog.Root open={showing} onOpenChange={updating ? undefined : setDialogOpen}>
      <Dialog.Portal>
        <Dialog.Backdrop />
        <Dialog.Overlay size="lg" data-ui="UpdateChangelogDialog">
          <Dialog.Header tone="accent">
            <div className="flex items-center gap-3">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-accent-500/15">
                <SparkleIcon className="size-5 text-accent-400" />
              </span>
              <div>
                <Dialog.Title>{m.updater_changelog_title()}</Dialog.Title>
                <p className="text-xs font-medium text-accent-400">
                  {m.updater_version_upgrade_label({
                    from: update.currentVersion,
                    to: update.version,
                  })}
                </p>
              </div>
            </div>
            {!updating && <Dialog.Close />}
          </Dialog.Header>

          <Dialog.Body className="flex h-[65vh] flex-col gap-4 overflow-hidden">
            {error && (
              <AlertBox
                variant="error"
                title={m.updater_install_failed_title()}
                onDismiss={dismissError}
              >
                {error}
              </AlertBox>
            )}

            {updating && (
              <div className="flex flex-col gap-1.5">
                <Progress.Root
                  value={progress}
                  label={m.updater_install_progress_label()}
                  valueLabel={`${progress}%`}
                >
                  <Progress.Track>
                    <Progress.Indicator />
                  </Progress.Track>
                </Progress.Root>
                <p className="text-sm text-surface-400">{m.updater_install_restart_hint()}</p>
              </div>
            )}

            <div className="-mx-2 flex-1 overflow-y-auto px-2 select-none">
              <ReleaseSection pending version={update.version} body={update.body} />
              <ReleaseHistory enabled={showing} excludeVersion={update.version} />
            </div>
          </Dialog.Body>

          {!updating && (
            <Dialog.Footer className="items-center justify-between">
              <Checkbox
                size="sm"
                label={m.updater_skip_version_label()}
                checked={skipped}
                onCheckedChange={(val) => setSkipVersion(val === true)}
              />
              <div className="flex items-center gap-3">
                <Button variant="ghost" onClick={() => setDialogOpen(false)}>
                  {m.common_close_action()}
                </Button>
                <Button
                  variant="filled"
                  left={<DownloadIcon weight="bold" className="h-4 w-4" />}
                  onClick={downloadAndInstall}
                >
                  {installLabel}
                </Button>
              </div>
            </Dialog.Footer>
          )}
        </Dialog.Overlay>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
