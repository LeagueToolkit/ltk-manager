import { open as openUrl } from "@tauri-apps/plugin-shell";
import type { ReactNode } from "react";

import { Button, OVERLINE, Stack, useToast } from "@/components";
import { m } from "@/i18n";
import type { Incident } from "@/lib/tauri";
import { verdictTitle } from "@/modules/diagnostics";
import { useRebuildOverlayAction } from "@/modules/patcher";

import { type Finding, isKnownCause } from "../utils/findings";

interface FindingsProps {
  findings: readonly Finding[];
  /** The summary that `Copy for the author` puts on the clipboard. */
  authorSummary: string | null;
  /** Opens the update dialog. */
  onUpdate: () => void;
}

/**
 * The `Findings` section: one row for each finding, in the order of `findings`.
 *
 * The fix of the first known cause is the primary button of the dialog. Renders nothing if
 * `findings` is empty.
 */
export function Findings({ findings, authorSummary, onUpdate }: FindingsProps) {
  if (findings.length === 0) return null;

  const primary = findings.findIndex(isKnownCause);

  return (
    <Stack gap={1.5}>
      <span className={OVERLINE}>{m.support_found_label()}</span>
      {findings.map((finding, index) => (
        <FindingRow
          key={finding.kind}
          finding={finding}
          primary={index === primary}
          authorSummary={authorSummary}
          onUpdate={onUpdate}
        />
      ))}
    </Stack>
  );
}

interface FindingRowProps extends Omit<FindingsProps, "findings"> {
  finding: Finding;
  /** Whether the fix of the row is the primary button of the dialog. */
  primary: boolean;
}

function FindingRow({ finding, primary, authorSummary, onUpdate }: FindingRowProps) {
  switch (finding.kind) {
    case "update":
      return (
        <Row
          kind={finding.kind}
          title={m.support_cause_update_title()}
          detail={m.support_cause_update_description({
            installed: finding.installed,
            latest: finding.latest,
          })}
        >
          <FixButton primary={primary} onClick={onUpdate}>
            {m.support_cause_update_action()}
          </FixButton>
        </Row>
      );
    case "issue":
      return (
        <Row kind={finding.kind} title={finding.issue.message}>
          {finding.issue.url && (
            <FixButton primary={primary} onClick={() => void openUrl(finding.issue.url!)}>
              {m.common_read_more_action()}
            </FixButton>
          )}
        </Row>
      );
    case "verdict":
      return <VerdictRow incident={finding.incident} rebuild={finding.rebuild} primary={primary} />;
    case "mod":
      return (
        <ModRow
          name={finding.name}
          pageUrl={finding.pageUrl}
          primary={primary}
          authorSummary={authorSummary}
        />
      );
  }
}

interface VerdictRowProps {
  incident: Incident;
  /** Whether the verdict offers a rebuild of the overlay. */
  rebuild: boolean;
  primary: boolean;
}

function VerdictRow({ incident, rebuild, primary }: VerdictRowProps) {
  const action = useRebuildOverlayAction();

  return (
    <Row kind="verdict" title={verdictTitle(incident)} detail={incident.verdict.cause}>
      {rebuild && (
        <FixButton primary={primary} loading={action.pending} onClick={action.run}>
          {action.label}
        </FixButton>
      )}
    </Row>
  );
}

interface ModRowProps {
  name: string;
  /** The page of the mod. The row has no page button without one. */
  pageUrl: string | null;
  primary: boolean;
  authorSummary: string | null;
}

function ModRow({ name, pageUrl, primary, authorSummary }: ModRowProps) {
  const toast = useToast();

  function handleCopy(summary: string) {
    navigator.clipboard.writeText(summary).then(
      () => toast.success(m.support_copy_done_title()),
      () => toast.error(m.support_copy_failed_title()),
    );
  }

  return (
    <Row kind="mod" title={m.support_cause_mod_title()} detail={name}>
      {pageUrl && (
        <FixButton primary={primary} onClick={() => void openUrl(pageUrl)}>
          {m.support_cause_mod_page_action()}
        </FixButton>
      )}
      {authorSummary && (
        <FixButton primary={primary && !pageUrl} onClick={() => handleCopy(authorSummary)}>
          {m.support_cause_mod_copy_action()}
        </FixButton>
      )}
    </Row>
  );
}

interface RowProps {
  kind: Finding["kind"];
  title: string;
  detail?: string;
  /** The actions of the row. */
  children?: ReactNode;
}

function Row({ kind, title, detail, children }: RowProps) {
  return (
    <div
      data-ui="GetHelpDialog:finding"
      data-kind={kind}
      className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md border border-surface-700/50 bg-surface-900 px-3 py-2"
    >
      {/* A row with two actions has no room for its text beside them, so the actions wrap. */}
      <div className="min-w-48 flex-1">
        <p className="text-sm font-medium text-surface-100 select-text">{title}</p>
        {detail && <p className="text-sm text-surface-300 select-text">{detail}</p>}
      </div>
      <div className="flex shrink-0 items-center gap-2">{children}</div>
    </div>
  );
}

interface FixButtonProps {
  primary: boolean;
  loading?: boolean;
  onClick: () => void;
  children: ReactNode;
}

function FixButton({ primary, ...props }: FixButtonProps) {
  if (primary) return <Button size="sm" variant="filled" tone="accent" {...props} />;

  return <Button size="sm" {...props} />;
}
