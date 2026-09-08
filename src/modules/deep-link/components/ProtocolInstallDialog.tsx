import {
  CheckCircleIcon,
  DownloadSimpleIcon,
  GlobeIcon,
  PackageIcon,
  ShieldWarningIcon,
  UserIcon,
  XCircleIcon,
} from "@phosphor-icons/react";

import { Button, Dialog, Progress, useToast } from "@/components";
import { errorSummary, m, Marked } from "@/i18n";
import type { ProtocolInstallProgress, Settings } from "@/lib/tauri";
import { useSaveSettings, useSettings } from "@/modules/settings";
import { useQueuedDialog } from "@/stores";

import { useProtocolInstall } from "../api/useProtocolInstall";
import { useProtocolInstallProgress } from "../api/useProtocolInstallProgress";
import { useDeepLinkStore } from "../state";

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
  const isError = status === "error";

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
        onSuccess: (mod) => {
          toast.success(
            m.deep_link_install_succeeded_title(),
            mod.name ?? m.deep_link_install_unknown_mod_label(),
          );
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
      title={title(isComplete, isError)}
      size="lg"
      closable={!busy}
    >
      <Dialog.Body className="flex flex-col gap-3">
        {!isComplete && !isError && (
          <>
            {untrustedDomain && <UntrustedBand domain={untrustedDomain} />}

            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent-500/15">
                <PackageIcon className="h-5 w-5 text-accent-400" />
              </div>
              <div className="min-w-0">
                <p className="truncate font-medium text-surface-100">{displayName}</p>
                {(request.author || request.source) && (
                  <div className="mt-0.5 flex items-center gap-3 text-xs text-surface-400">
                    {request.author && (
                      <span className="flex items-center gap-1">
                        <UserIcon className="h-3 w-3 shrink-0" />
                        {request.author}
                      </span>
                    )}
                    {request.source && (
                      <span className="flex items-center gap-1">
                        <GlobeIcon className="h-3 w-3 shrink-0" />
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

        {isComplete && (
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-success/15">
              <CheckCircleIcon className="h-5 w-5 text-success-text" />
            </div>
            <p className="text-sm text-surface-300">
              <Marked text={m.deep_link_install_succeeded_description({ name: displayName })}>
                {(clause) => <span className="font-medium text-surface-100">{clause}</span>}
              </Marked>
            </p>
          </div>
        )}

        {isError && error && (
          <div className="flex items-start gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-danger/15">
              <XCircleIcon className="h-5 w-5 text-danger-text" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-medium text-surface-100">
                {m.deep_link_install_failed_description({ name: displayName })}
              </p>
              <p className="mt-1 text-sm text-danger-text select-text">{error}</p>
            </div>
          </div>
        )}
      </Dialog.Body>

      <Dialog.Footer>
        {!isComplete && !isError && untrustedDomain && (
          <>
            <Button variant="ghost" onClick={handleClose} disabled={busy}>
              {m.deep_link_untrusted_reject_action()}
            </Button>
            <Button variant="filled" onClick={trustAndInstall} loading={busy}>
              <ShieldWarningIcon weight="bold" className="h-4 w-4" />
              {m.deep_link_untrusted_trust_action()}
            </Button>
          </>
        )}
        {!isComplete && !isError && !untrustedDomain && (
          <>
            <Button variant="ghost" onClick={handleClose} disabled={busy}>
              {m.common_cancel_action()}
            </Button>
            <Button variant="filled" onClick={runInstall} loading={busy}>
              <DownloadSimpleIcon weight="bold" className="h-4 w-4" />
              {m.deep_link_install_action()}
            </Button>
          </>
        )}
        {(isComplete || isError) && (
          <Button variant="filled" onClick={handleClose}>
            {m.deep_link_install_done_action()}
          </Button>
        )}
      </Dialog.Footer>
    </Dialog.Shell>
  );
}

/** The dialog's own name for where the install has got to. */
function title(isComplete: boolean, isError: boolean): string {
  if (isComplete) return m.deep_link_install_complete_title();
  if (isError) return m.deep_link_install_failed_title();
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
      <ShieldWarningIcon className="h-5 w-5 shrink-0 text-danger-text" weight="bold" />
      <div className="min-w-0">
        <p className="text-sm font-medium text-surface-100">
          {m.deep_link_untrusted_title({ domain })}
        </p>
        <p className="mt-0.5 text-xs text-surface-400">{m.deep_link_untrusted_description()}</p>
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
