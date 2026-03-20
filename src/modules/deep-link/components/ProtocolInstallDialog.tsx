import { CircleCheck, CircleX, Download, Globe, Package, User } from "lucide-react";

import { Button, Dialog, Progress, useToast } from "@/components";
import type { ProtocolInstallProgress } from "@/lib/tauri";
import { useDeepLinkStore } from "@/stores";

import { useProtocolInstall } from "../api/useProtocolInstall";
import { useProtocolInstallProgress } from "../api/useProtocolInstallProgress";

export function ProtocolInstallDialog() {
  const request = useDeepLinkStore((s) => s.request);
  const status = useDeepLinkStore((s) => s.status);
  const error = useDeepLinkStore((s) => s.error);
  const reset = useDeepLinkStore((s) => s.reset);
  const toast = useToast();
  const install = useProtocolInstall();
  const { progress } = useProtocolInstallProgress();

  const open = request !== null;
  const isInstalling = status === "installing" || install.isPending;
  const isComplete = status === "complete";
  const isError = status === "error";

  function handleConfirm() {
    if (!request) return;
    install.mutate(
      { url: request.url, name: request.name, author: request.author, source: request.source },
      {
        onSuccess: (mod) => {
          toast.success("Mod Installed", mod.name ?? "Mod installed successfully");
        },
        onError: (err) => {
          toast.error("Install Failed", err.message);
        },
      },
    );
  }

  function handleClose() {
    if (isInstalling) return;
    reset();
    install.reset();
  }

  if (!request) return null;

  const displayName = request.name ?? "Unknown Mod";

  return (
    <Dialog.Root open={open} onOpenChange={(open) => !open && handleClose()}>
      <Dialog.Portal>
        <Dialog.Backdrop />
        <Dialog.Overlay size="sm">
          <Dialog.Header>
            <Dialog.Title>
              {isComplete ? "Install Complete" : isError ? "Install Failed" : "Install Mod"}
            </Dialog.Title>
            {!isInstalling && <Dialog.Close />}
          </Dialog.Header>

          <Dialog.Body className="flex flex-col gap-4">
            {!isComplete && !isError && (
              <>
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-accent-500/15">
                    <Package className="h-5 w-5 text-accent-400" />
                  </div>
                  <div className="min-w-0">
                    <p className="truncate font-medium text-surface-100">{displayName}</p>
                    {(request.author || request.source) && (
                      <div className="mt-0.5 flex items-center gap-3 text-xs text-surface-400">
                        {request.author && (
                          <span className="flex items-center gap-1">
                            <User className="h-3 w-3 shrink-0" />
                            {request.author}
                          </span>
                        )}
                        {request.source && (
                          <span className="flex items-center gap-1">
                            <Globe className="h-3 w-3 shrink-0" />
                            {request.source}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                <div className="rounded-md bg-surface-900 px-3 py-2">
                  <p className="font-mono text-xs leading-relaxed break-all text-surface-500">
                    {request.url}
                  </p>
                </div>

                {isInstalling && progress && <DownloadProgressBar progress={progress} />}
              </>
            )}

            {isComplete && (
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-emerald-500/15">
                  <CircleCheck className="h-5 w-5 text-emerald-400" />
                </div>
                <p className="text-sm text-surface-300">
                  <span className="font-medium text-surface-100">{displayName}</span> has been
                  installed successfully.
                </p>
              </div>
            )}

            {isError && error && (
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-red-500/15">
                  <CircleX className="h-5 w-5 text-red-400" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-surface-100">
                    Failed to install {displayName}
                  </p>
                  <p className="mt-1 text-sm text-red-300">{error}</p>
                </div>
              </div>
            )}
          </Dialog.Body>

          <Dialog.Footer>
            {!isComplete && !isError && (
              <>
                <Button variant="ghost" onClick={handleClose} disabled={isInstalling}>
                  Cancel
                </Button>
                <Button variant="filled" onClick={handleConfirm} loading={isInstalling}>
                  <Download className="h-4 w-4" />
                  Install
                </Button>
              </>
            )}
            {(isComplete || isError) && (
              <Button variant="filled" onClick={handleClose}>
                Done
              </Button>
            )}
          </Dialog.Footer>
        </Dialog.Overlay>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function DownloadProgressBar({ progress }: { progress: ProtocolInstallProgress }) {
  const downloaded = Number(progress.bytesDownloaded);
  const total = progress.totalBytes ? Number(progress.totalBytes) : null;
  const isValidating = progress.stage === "validating";

  const label = isValidating ? "Validating..." : "Downloading...";
  const valueLabel = total
    ? `${formatBytes(downloaded)} / ${formatBytes(total)}`
    : formatBytes(downloaded);

  return (
    <Progress.Root value={total ? downloaded : null} max={total ?? undefined}>
      <Progress.Track size="sm">
        <Progress.Indicator />
      </Progress.Track>
      <div className="mt-1.5 flex items-center justify-between text-xs text-surface-400">
        <span>{label}</span>
        <span>{valueLabel}</span>
      </div>
    </Progress.Root>
  );
}
