import { TargetIcon } from "@phosphor-icons/react";
import { type ReactNode, useRef } from "react";

import { Button, Dialog, ExternalLink } from "@/components";
import { m, Marked } from "@/i18n";
import { useQueuedDialog } from "@/stores";

import { useSaveSettings, useSettings } from "../api";
import { PRIVACY_PAGE_URL } from "../privacyPage";

/** What the notice lists under "What gets collected", in the order it reads. */
const COLLECTED = [
  m.diagnostics_notice_collected_session,
  m.diagnostics_notice_collected_errors,
  m.diagnostics_notice_collected_mods,
  m.diagnostics_notice_collected_versions,
  m.diagnostics_notice_collected_identity,
];

/**
 * What a reader is told before anything about their machine leaves it.
 *
 * Owed to an upgrading reader as much as to a fresh install, so it is gated on a
 * flag of its own rather than on first run. It queues per ADR-0022.
 */
export function DiagnosticsNoticeDialog() {
  const { data: settings } = useSettings();
  const saveSettings = useSaveSettings();
  const panel = useRef<HTMLDivElement>(null);

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
    /* Focus starts on the panel rather than on the first link, so the notice
       opens saying what it says instead of wearing a ring. */
    <Dialog.Shell
      ref={panel}
      initialFocus={panel}
      open
      size="xl"
      onClose={acknowledge}
      closable={false}
      title={
        <>
          <TargetIcon className="h-6 w-6 shrink-0 text-accent-400" weight="duotone" />
          {m.diagnostics_notice_title()}
        </>
      }
      titleClassName="flex items-center gap-2.5"
      data-ui="DiagnosticsNoticeDialog"
    >
      <Dialog.Body>
        <div className="flex flex-col gap-5 select-none">
          <Section title={m.diagnostics_notice_why_title()}>
            <p className="text-sm text-surface-300">{m.diagnostics_notice_why_body()}</p>
          </Section>

          <Section title={m.diagnostics_notice_collected_title()}>
            <ul className="flex flex-col gap-0.5">
              {COLLECTED.map((line) => (
                <li key={line()} className="flex gap-2.5 text-sm text-surface-300">
                  <span
                    aria-hidden
                    className="mt-[0.4375rem] h-1 w-1 shrink-0 rounded-full bg-surface-400"
                  />
                  <span>{line()}</span>
                </li>
              ))}
            </ul>
            <p className="text-sm text-surface-400">{m.diagnostics_notice_never_body()}</p>
          </Section>

          <div className="flex flex-col gap-2">
            <p className="text-sm text-surface-400">
              <Marked text={m.diagnostics_notice_settings_hint()}>
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

interface SectionProps {
  title: string;
  children: ReactNode;
}

function Section({ title, children }: SectionProps) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-sm font-medium text-surface-100">{title}</h3>
      {children}
    </section>
  );
}
