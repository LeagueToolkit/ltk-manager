import {
  CheckCircleIcon,
  DownloadSimpleIcon,
  GlobeIcon,
  InfoIcon,
  PackageIcon,
  ShieldWarningIcon,
  UserIcon,
  XCircleIcon,
} from "@phosphor-icons/react";

import { Button, Dialog, Progress, useToast } from "@/components";
import { describeError, errorSummary, m, Marked } from "@/i18n";
import type { AppError, ProtocolInstallProgress, Settings } from "@/lib/tauri";
import { useSaveSettings, useSettings } from "@/modules/settings";
import { useQueuedDialog } from "@/stores";

import { useProtocolInstall } from "../api/useProtocolInstall";
import { useProtocolInstallProgress } from "../api/useProtocolInstallProgress";
import { type InstallStatus, useDeepLinkStore } from "../state";

export function ProtocolInstallDialog() {
  const request = useDeepLinkStore((s) => s.request);
  const status = useDeepLinkStore((s) => s.status);
  const error = useDeepLinkStore((s) => s.error);
  const reset = useDeepLinkStore((s) => s.reset);
  const toast = useToast();
  const install = useProtocolInstall();
  const { progress } = useProtocolInstallProgress();
  const { data: settings } = useSettings();
  const saveSettings = useSaveSettings();

  const open = useQueuedDialog("protocol-install", request !== null);
  const isInstalling = status === "installing" || install.isPending;
  const isComplete = status === "complete";
  const isUpdated = status === "updated";
  const isExisting = status === "existing";
  const isError = status === "error";
  const isDone = isComplete || isUpdated || isExisting || isError;

  /* Read against the settings as they are rather than against the marker the
     link arrived with, so trusting the domain here - or in Settings, in another
     window - takes the band down without the store hearing about it. */
  const untrustedDomain =
    request?.untrustedDomain && !(settings?.trustedDomains ?? []).includes(request.untrustedDomain)
      ? request.untrustedDomain
      : null;

  function runInstall() {
    if (!request) return;
    install.mutate(
      { url: request.url, name: request.name, author: request.author, source: request.source },
      {
        onSuccess: ({ kind, mod }) => {
          const name = mod.name ?? m.deep_link_install_unknown_mod_label();
          if (kind === "alreadyInstalled") {
            toast.info(m.deep_link_install_existing_title(), name);
          } else if (kind === "updated") {
            toast.success(m.deep_link_install_updated_title(), name);
          } else {
            toast.success(m.deep_link_install_succeeded_title(), name);
          }
        },
        onError: (err) => {
          toast.error(m.deep_link_install_failed_title(), errorSummary(err));
        },
      },
    );
  }

  /* The save has to land before the install runs: `deep_link_install_mod` reads
     the same allowlist, so a download started alongside the save would race the
     gate it is meant to have passed. */
  function trustAndInstall() {
    if (!settings || !untrustedDomain) return;
    const trusted: Settings = {
      ...settings,
      trustedDomains: [...(settings.trustedDomains ?? []), untrustedDomain],
    };
    /* No onError: useSaveSettings has seven callers and reports through the
       default toast, which this one would double. */
    saveSettings.mutate(trusted, { onSuccess: runInstall });
  }

  function handleClose() {
    if (isInstalling) return;
    reset();
    install.reset();
  }

  if (!request || !open) return null;

  const displayName = request.name ?? m.deep_link_install_unknown_mod_label();
  const busy = isInstalling || saveSettings.isPending;

  return (
    <Dialog.Shell
      open={open}
      onClose={handleClose}
      title={title(status)}
      size="lg"
      closable={!busy}
    >
      <Dialog.Body className="flex flex-col gap-3">
        {!isDone && (
          <>
            {untrustedDomain && <UntrustedBand domain={untrustedDomain} />}

            <div className="flex items-center gap-3">
              <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-accent-500/15">
                <PackageIcon className="size-5 text-accent-400" />
              </div>
              <div className="min-w-0">
                <p className="truncate font-medium text-surface-100">{displayName}</p>
                {(request.author || request.source) && (
                  <div className="mt-0.5 flex items-center gap-3 text-xs text-surface-400">
                    {request.author && (
                      <span className="flex items-center gap-1">
                        <UserIcon className="size-3 shrink-0" />
                        {request.author}
                      </span>
                    )}
                    {request.source && (
                      <span className="flex items-center gap-1">
                        <GlobeIcon className="size-3 shrink-0" />
                        {request.source}
                      </span>
                    )}
                  </div>
                )}
              </div>
            </div>

            <div className="rounded-md bg-surface-900 px-2.5 py-1.5">
              <p className="font-mono text-xs leading-relaxed break-all text-surface-500 select-text">
                {request.url}
              </p>
            </div>

            {isInstalling && progress && <DownloadProgressBar progress={progress} />}
          </>
        )}

        {(isComplete || isUpdated) && (
          <div className="flex items-center gap-3">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-success/15">
              <CheckCircleIcon className="size-5 text-success-text" />
            </div>
            <p className="text-sm text-surface-300">
              <Marked
                text={
                  isUpdated
                    ? m.deep_link_install_updated_description({ name: displayName })
                    : m.deep_link_install_succeeded_description({ name: displayName })
                }
              >
                {(clause) => <span className="font-medium text-surface-100">{clause}</span>}
              </Marked>
            </p>
          </div>
        )}

        {isExisting && (
          <div className="flex items-center gap-3">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-info/15">
              <InfoIcon className="size-5 text-info-text" />
            </div>
            <p className="text-sm text-surface-300">
              <Marked text={m.deep_link_install_existing_description({ name: displayName })}>
                {(clause) => <span className="font-medium text-surface-100">{clause}</span>}
              </Marked>
            </p>
          </div>
        )}

        {isError && error && <InstallFailure name={displayName} error={error} />}
      </Dialog.Body>

      <Dialog.Footer>
        {!isDone && untrustedDomain && (
          <>
            <Button size="lg" variant="ghost" onClick={handleClose} disabled={busy}>
              {m.deep_link_untrusted_reject_action()}
            </Button>
            <Button size="lg" variant="filled" onClick={trustAndInstall} loading={busy}>
              <ShieldWarningIcon weight="bold" className="size-4" />
              {m.deep_link_untrusted_trust_action()}
            </Button>
          </>
        )}
        {!isDone && !untrustedDomain && (
          <>
            <Button size="lg" variant="ghost" onClick={handleClose} disabled={busy}>
              {m.common_cancel_action()}
            </Button>
            <Button size="lg" variant="filled" onClick={runInstall} loading={busy}>
              <DownloadSimpleIcon weight="bold" className="size-4" />
              {m.deep_link_install_action()}
            </Button>
          </>
        )}
        {isDone && (
          <Button size="lg" variant="filled" onClick={handleClose}>
            {m.deep_link_install_done_action()}
          </Button>
        )}
      </Dialog.Footer>
    </Dialog.Shell>
  );
}

/** The dialog's own name for where the install has got to. */
function title(status: InstallStatus): string {
  if (status === "complete") return m.deep_link_install_complete_title();
  if (status === "updated") return m.deep_link_install_updated_title();
  if (status === "existing") return m.deep_link_install_existing_title();
  if (status === "error") return m.deep_link_install_failed_title();
  return m.deep_link_install_title();
}

/**
 * Who the download would come from, where the reader has not said they trust them.
 *
 * Per "The deep link" in docs/ux/SETTINGS.md.
 */
function UntrustedBand({ domain }: { domain: string }) {
  return (
    <div
      data-ui="ProtocolInstallDialog:untrusted"
      className="flex items-start gap-2.5 rounded-lg border border-danger/30 bg-danger/8 px-3 py-2 select-none"
    >
      <ShieldWarningIcon className="size-5 shrink-0 text-danger-text" weight="bold" />
      <div className="min-w-0">
        <p className="text-sm font-medium text-surface-100">
          {m.deep_link_untrusted_title({ domain })}
        </p>
        <p className="mt-0.5 text-xs text-surface-400">{m.deep_link_untrusted_description()}</p>
      </div>
    </div>
  );
}

/** Why the install failed: the cause, the remedy, and any prose from outside the app as data. */
function InstallFailure({ name, error }: { name: string; error: AppError }) {
  const copy = describeError(error);

  return (
    <div className="flex items-start gap-3">
      <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-danger/15">
        <XCircleIcon className="size-5 text-danger-text" />
      </div>
      <div className="min-w-0">
        <p className="text-sm font-medium text-surface-100">
          {m.deep_link_install_failed_description({ name })}
        </p>
        <p className="mt-1 text-sm text-danger-text">{copy.title}</p>
        {copy.description && <p className="mt-0.5 text-sm text-surface-300">{copy.description}</p>}
        {copy.detail && <p className="mt-1 text-xs text-surface-400 select-text">{copy.detail}</p>}
      </div>
    </div>
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

  const label = isValidating
    ? m.deep_link_install_validating_label()
    : m.deep_link_install_downloading_label();
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
