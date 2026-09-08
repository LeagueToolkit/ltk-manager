import { ShieldCheckIcon } from "@phosphor-icons/react";

import { Button, Dialog, ExternalLink } from "@/components";
import { m, Marked } from "@/i18n";
import { useQueuedDialog } from "@/stores";

import { useSaveSettings, useSettings } from "../api";
import { PRIVACY_PAGE_URL } from "../privacyPage";

/**
 * What a reader is told before anything about their machine leaves it.
 *
 * Owed to an upgrading reader as much as to a fresh install, so it is gated on a
 * flag of its own rather than on first run. It queues per ADR-0022.
 */
export function DiagnosticsNoticeDialog() {
  const { data: settings } = useSettings();
  const saveSettings = useSaveSettings();

  const owed = settings !== undefined && !settings.hasSeenDiagnosticsNotice;
  const showing = useQueuedDialog("diagnostics-notice", owed);

  if (!showing || !settings) return null;

  const acknowledge = () => {
    saveSettings.mutate({ ...settings, hasSeenDiagnosticsNotice: true });
  };

  const turnOff = () => {
    saveSettings.mutate({
      ...settings,
      telemetryEnabled: false,
      hasSeenDiagnosticsNotice: true,
    });
  };

  return (
    <Dialog.Shell
      open
      onClose={acknowledge}
      closable={false}
      title={m.diagnostics_notice_title()}
      data-ui="DiagnosticsNoticeDialog"
    >
      <Dialog.Body>
        <div className="flex items-start gap-3 select-none">
          <ShieldCheckIcon className="h-10 w-10 shrink-0 text-accent-400" />
          <div className="flex flex-col gap-2">
            <p className="text-sm text-surface-200">{m.diagnostics_notice_description()}</p>
            <p className="text-sm text-surface-300">
              <Marked text={m.diagnostics_notice_detail()}>
                {(clause) => <strong className="font-medium text-surface-200">{clause}</strong>}
              </Marked>
            </p>
            <ExternalLink href={PRIVACY_PAGE_URL} className="text-sm">
              {m.diagnostics_privacy_page_action()}
            </ExternalLink>
          </div>
        </div>
      </Dialog.Body>
      <Dialog.Footer>
        <Button variant="ghost" onClick={turnOff} disabled={saveSettings.isPending}>
          {m.diagnostics_notice_turn_off_action()}
        </Button>
        <Button onClick={acknowledge} loading={saveSettings.isPending}>
          {m.diagnostics_notice_acknowledge_action()}
        </Button>
      </Dialog.Footer>
    </Dialog.Shell>
  );
}
