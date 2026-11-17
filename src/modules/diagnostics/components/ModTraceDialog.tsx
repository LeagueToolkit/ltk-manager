import { CheckCircleIcon, MinusCircleIcon, WarningIcon, XCircleIcon } from "@phosphor-icons/react";
import { useNavigate } from "@tanstack/react-router";
import type { ReactNode } from "react";

import { Button, Dialog, Spinner } from "@/components";
import { m } from "@/i18n";
import type { LastGame, RowState, TraceRow } from "@/lib/tauri";
import { useRebuildOverlayAction } from "@/modules/patcher";
import { type ModTraceTarget, openGetHelp, useDialog, useModTraceDialog } from "@/stores";

import { useModTrace } from "../api";
import { formatDuration } from "../utils/incident";
import { formatWhen, rowDetail, rowText, traceFix } from "../utils/modTrace";

/** The setting that starts the manager with the computer. */
const AUTOSTART_SETTING = "general.autoRun";

/**
 * The mod trace panel: why one mod, or one workshop project, did or did not reach the last
 * game.
 *
 * Per "The mod trace" in docs/ux/SUPPORT_REPORTS.md. The panel mounts only while it is open,
 * so each opening reads the trace again.
 */
export function ModTraceDialog() {
  const { isOpen, payload, close } = useDialog(useModTraceDialog);

  if (!isOpen || !payload) return null;

  return <ModTracePanel target={payload} onClose={close} />;
}

interface ModTracePanelProps {
  target: ModTraceTarget;
  onClose: () => void;
}

function ModTracePanel({ target, onClose }: ModTracePanelProps) {
  const navigate = useNavigate();
  const { data: trace, isError } = useModTrace(target.subject);
  const rebuild = useRebuildOverlayAction();
  const fix = traceFix(trace?.rows ?? []);

  function handleGetHelp() {
    onClose();
    openGetHelp({ modId: target.subject.kind === "mod" ? target.subject.id : undefined });
  }

  function handleSettings() {
    onClose();
    void navigate({ to: "/settings", search: { focus: AUTOSTART_SETTING } });
  }

  return (
    <Dialog.Shell open onClose={onClose} title={target.name} size="md" data-ui="ModTraceDialog">
      <Dialog.Body>
        {isError && (
          <p className="text-sm text-danger-text">{m.diagnostics_trace_failed_label()}</p>
        )}
        {!trace && !isError && <Spinner size={16} className="self-center" />}
        {trace && (
          <ul className="space-y-2">
            {trace.rows.map((row) => (
              <Row key={JSON.stringify(row)} row={row} />
            ))}
          </ul>
        )}
        {trace?.lastGame && (
          <p data-ui="ModTraceDialog:lastGame" className="text-sm text-surface-400 select-text">
            {lastGameLine(trace.lastGame)}
          </p>
        )}
      </Dialog.Body>

      <Dialog.Footer>
        {fix === "autostart" && (
          <FixButton primary onClick={handleSettings}>
            {m.diagnostics_trace_autostart_action()}
          </FixButton>
        )}
        <FixButton primary={fix === "rebuild"} loading={rebuild.pending} onClick={rebuild.run}>
          {rebuild.label}
        </FixButton>
        <FixButton primary={fix === "help"} onClick={handleGetHelp}>
          {m.common_get_help_action()}
        </FixButton>
      </Dialog.Footer>
    </Dialog.Shell>
  );
}

/** One row: the glyph of its state, the sentence of its reading and the detail under it. */
function Row({ row }: { row: TraceRow }) {
  const detail = rowDetail(row);

  return (
    <li
      data-ui="ModTraceDialog:row"
      data-row={row.row}
      data-state={row.state}
      className="flex items-start gap-2"
    >
      <StateGlyph state={row.state} />
      <div className="min-w-0">
        <p className="text-sm text-surface-100 select-text">{rowText(row)}</p>
        {detail && <p className="text-sm text-surface-400 select-text">{detail}</p>}
      </div>
    </li>
  );
}

const GLYPH_CLASS = "mt-0.5 size-4 shrink-0";

function StateGlyph({ state }: { state: RowState }) {
  switch (state) {
    case "pass":
      return <CheckCircleIcon weight="fill" className={`${GLYPH_CLASS} text-success-text`} />;
    case "warn":
      return <WarningIcon weight="fill" className={`${GLYPH_CLASS} text-warning-text`} />;
    case "fail":
      return <XCircleIcon weight="fill" className={`${GLYPH_CLASS} text-danger-text`} />;
    case "unknown":
      return <MinusCircleIcon weight="fill" className={`${GLYPH_CLASS} text-surface-500`} />;
  }
}

/** Returns the line under the rows: when the newest followed game started and how long it ran. */
function lastGameLine({ startedAt, endedAt, stillRunning }: LastGame): string {
  const fields = {
    when: formatWhen(startedAt),
    duration: formatDuration(startedAt, endedAt) ?? "",
  };
  if (stillRunning) return m.diagnostics_trace_last_game_running_label(fields);

  return m.diagnostics_trace_last_game_label(fields);
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
