import { ArrowsLeftRightIcon, WarningIcon } from "@phosphor-icons/react";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { Button, Code, Dialog, useToast } from "@/components";
import { errorSummary, m, Marked } from "@/i18n";
import { api, type AppError } from "@/lib/tauri";
import { settingsKeys } from "@/modules/settings";
import {
  type DetectedInstallMismatch,
  useInstallMismatchStore,
  usePendingRebuildStore,
  useQueuedDialog,
} from "@/stores";
import { basename } from "@/utils";
import { mutationFn } from "@/utils/query";

/** The install as the dialog names it: its patchline where one is known, else its folder. */
function installLabel(path: string, patchline: string | null): string {
  if (patchline === "live") return m.launcher_install_live_label();
  if (patchline === "pbe") return m.launcher_install_pbe_label();
  if (patchline) return patchline;
  return basename(path);
}

/**
 * The League that runs is not the install the overlay was built for, and the
 * two answers: keep the configured install, or switch to the running one.
 *
 * Per "The install mismatch dialog" in docs/ux/LEAGUE_DIAGNOSTICS.md, queued
 * per ADR-0022. The patcher keeps running underneath either way.
 */
export function InstallMismatchDialog() {
  const mismatch = useInstallMismatchStore((s) => s.mismatch);
  const showing = useQueuedDialog("install-mismatch", mismatch !== null);

  if (!mismatch || !showing) return null;

  return <InstallMismatchContent mismatch={mismatch} />;
}

function InstallMismatchContent({ mismatch }: { mismatch: DetectedInstallMismatch }) {
  const keep = useInstallMismatchStore((s) => s.keep);
  const clear = useInstallMismatchStore((s) => s.clear);
  const toast = useToast();
  const queryClient = useQueryClient();

  const switchInstall = useMutation<null, AppError, string>({
    meta: { silentError: true },
    mutationFn: mutationFn(api.launcher.switchLeagueInstall),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: settingsKeys.settings() });
      // The switch rebuilt the overlay, which is what a queued rebuild was for.
      usePendingRebuildStore.getState().clear();
      toast.success(m.launcher_install_switched_title(), mismatch.sessionPath);
      clear();
    },
    onError: (error) => {
      toast.error(m.launcher_install_switch_failed_title(), errorSummary(error));
    },
  });

  const configured = installLabel(mismatch.configuredPath, mismatch.configuredPatchline);
  const running = installLabel(mismatch.sessionPath, mismatch.sessionPatchline);

  return (
    <Dialog.Root open onOpenChange={(open) => !open && keep()}>
      <Dialog.Portal>
        <Dialog.Backdrop />
        <Dialog.Overlay size="md">
          <Dialog.Header>
            <Dialog.Title className="flex items-center gap-2.5">
              {/* DS-TEXT. */}
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-warning/15 text-warning-text">
                <WarningIcon className="h-4 w-4" weight="fill" />
              </span>
              {m.launcher_install_mismatch_title()}
            </Dialog.Title>
            <Dialog.Close />
          </Dialog.Header>

          <Dialog.Body className="flex flex-col gap-4">
            <p className="text-sm leading-relaxed text-surface-300">
              <Marked text={m.launcher_install_mismatch_description({ running, configured })}>
                {(clause) => <strong className="font-medium text-surface-100">{clause}</strong>}
              </Marked>
            </p>
            <dl
              data-ui="InstallMismatchDialog:installs"
              className="grid grid-cols-[auto_minmax(0,1fr)] items-baseline gap-x-3 gap-y-1.5 text-sm"
            >
              <dt className="text-surface-400 select-none">
                {m.launcher_install_mismatch_running_label()}
              </dt>
              <dd className="min-w-0">
                <Code className="break-all">{mismatch.sessionPath}</Code>
              </dd>
              <dt className="text-surface-400 select-none">
                {m.launcher_install_mismatch_configured_label()}
              </dt>
              <dd className="min-w-0">
                <Code className="break-all">{mismatch.configuredPath}</Code>
              </dd>
            </dl>
            <p className="text-sm text-surface-400">{m.launcher_install_mismatch_hint()}</p>
          </Dialog.Body>

          <Dialog.Footer>
            <Button variant="ghost" onClick={keep} disabled={switchInstall.isPending}>
              {m.launcher_install_mismatch_keep_action({ configured })}
            </Button>
            <Button
              variant="filled"
              left={<ArrowsLeftRightIcon weight="bold" className="h-4 w-4" />}
              loading={switchInstall.isPending}
              onClick={() => switchInstall.mutate(mismatch.sessionPath)}
            >
              {m.launcher_install_mismatch_switch_action()}
            </Button>
          </Dialog.Footer>
        </Dialog.Overlay>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
