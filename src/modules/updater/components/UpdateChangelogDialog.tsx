import { CircleAlert, Download, RefreshCw, Sparkles } from "lucide-react";

import { Button, Checkbox, Dialog, Progress } from "@/components";
import {
  useUpdaterDialogOpen,
  useUpdaterDismissError,
  useUpdaterDownloadAndInstall,
  useUpdaterError,
  useUpdaterProgress,
  useUpdaterSetDialogOpen,
  useUpdaterSetSkipVersion,
  useUpdaterSkippedVersion,
  useUpdaterUpdate,
  useUpdaterUpdating,
} from "@/stores";

import { ChangelogContent } from "./ChangelogContent";

export function UpdateChangelogDialog() {
  const update = useUpdaterUpdate();
  const dialogOpen = useUpdaterDialogOpen();
  const setDialogOpen = useUpdaterSetDialogOpen();
  const downloadAndInstall = useUpdaterDownloadAndInstall();
  const updating = useUpdaterUpdating();
  const progress = useUpdaterProgress();
  const error = useUpdaterError();
  const dismissError = useUpdaterDismissError();
  const skippedVersion = useUpdaterSkippedVersion();
  const setSkipVersion = useUpdaterSetSkipVersion();
  if (!update) return null;

  const skipped = skippedVersion === update.version;

  return (
    <Dialog.Root open={dialogOpen} onOpenChange={updating ? undefined : setDialogOpen}>
      <Dialog.Portal>
        <Dialog.Backdrop />
        <Dialog.Overlay size="md">
          <Dialog.Header className="border-b-accent-500/20 bg-linear-to-r from-accent-600/10 to-accent-500/5">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent-500/15">
                <Sparkles className="h-5 w-5 text-accent-400" />
              </div>
              <div>
                <Dialog.Title>What&apos;s New</Dialog.Title>
                <p className="text-xs font-medium text-accent-400">v{update.version}</p>
              </div>
            </div>
            {!updating && <Dialog.Close />}
          </Dialog.Header>

          <Dialog.Body className="max-h-[60vh] overflow-y-auto">
            {error && (
              <div className="mb-4 flex items-start gap-3 rounded-lg border border-red-500/30 bg-red-900/20 px-4 py-3">
                <CircleAlert className="mt-0.5 h-5 w-5 shrink-0 text-red-400" />
                <div className="flex-1">
                  <p className="text-sm font-medium text-red-200">Update failed</p>
                  <p className="mt-0.5 text-xs text-red-300">{error}</p>
                </div>
              </div>
            )}

            {updating && (
              <div className="mb-4 rounded-lg border border-accent-500/20 bg-accent-600/10 px-4 py-3">
                <div className="flex items-center gap-3">
                  <RefreshCw className="h-5 w-5 shrink-0 animate-spin text-accent-400" />
                  <div className="flex-1">
                    <p className="text-sm font-medium text-accent-100">Installing update...</p>
                    <p className="text-xs text-accent-300">
                      {progress}% complete — App will restart automatically
                    </p>
                  </div>
                </div>
                <Progress.Root value={progress} className="mt-2">
                  <Progress.Track size="sm">
                    <Progress.Indicator />
                  </Progress.Track>
                </Progress.Root>
              </div>
            )}

            <ChangelogContent body={update.body} />
          </Dialog.Body>

          <Dialog.Footer className="items-center">
            {!updating && !error && (
              <Checkbox
                size="sm"
                label="Skip this version"
                checked={skipped}
                onCheckedChange={(val) => setSkipVersion(val === true)}
                className="mr-auto"
              />
            )}
            {error && (
              <Button variant="ghost" onClick={dismissError} className="mr-auto">
                Dismiss Error
              </Button>
            )}
            {!updating && (
              <Button variant="ghost" onClick={() => setDialogOpen(false)}>
                Close
              </Button>
            )}
            {!updating && (
              <Button variant="filled" onClick={downloadAndInstall}>
                <Download className="h-4 w-4" />
                {error ? "Retry Update" : "Update Now"}
              </Button>
            )}
          </Dialog.Footer>
        </Dialog.Overlay>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
