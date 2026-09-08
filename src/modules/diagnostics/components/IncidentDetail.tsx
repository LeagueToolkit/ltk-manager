import {
  ArrowsClockwiseIcon,
  ArrowSquareOutIcon,
  ClipboardTextIcon,
  FileTextIcon,
  HashIcon,
  XIcon,
} from "@phosphor-icons/react";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import type { ReactNode } from "react";

import { Button, Tooltip, useToast } from "@/components";
import { useCopyToClipboard } from "@/hooks";
import { errorMessage, errorSummary, m } from "@/i18n";
import type { Incident, Suspect } from "@/lib/tauri";
import { usePatcherStatus, useRebuildOverlay } from "@/modules/patcher";

import {
  diagnosticsQueries,
  useDismissIncident,
  useIncidentReport,
  useIncidentToken,
  useRevealGameLog,
} from "../api";
import { hintText } from "../utils/hints";
import { formatDuration, formatOrigin, projectNameFromPath } from "../utils/incident";
import { EvidenceTimeline } from "./EvidenceTimeline";
import { VerdictCard } from "./VerdictCard";

/**
 * Draws the control that acts on the mod a suspect names.
 *
 * A slot rather than an import: the control reads the library, which sits
 * above diagnostics in the module order.
 */
export type ModAction = (modId: string) => ReactNode;

interface IncidentDetailProps {
  incident: Incident;
  modAction?: ModAction;
}

/**
 * One incident, top to bottom in the order a player asks: the verdict, the
 * suspects, the hints, the evidence, the facts, and the actions.
 */
export function IncidentDetail({ incident, modAction }: IncidentDetailProps) {
  const { verdict } = incident;

  return (
    <div data-ui="IncidentDetail" className="flex flex-col gap-5">
      <VerdictCard incident={incident} />

      {incident.suspects.length > 0 && (
        <DetailSection title={m.diagnostics_suspects_title()}>
          <ul className="divide-y divide-surface-800 rounded-lg border border-surface-700/50 bg-surface-900/95">
            {incident.suspects.map((suspect, index) => (
              <SuspectRow
                key={`${suspect.displayName}-${index}`}
                suspect={suspect}
                modAction={modAction}
              />
            ))}
          </ul>
        </DetailSection>
      )}

      {verdict.hints.length > 0 && (
        <DetailSection title={m.diagnostics_hints_title()}>
          {/* The marker is drawn rather than list-disc, whose li stops being a
              list-item once flex blockifies it, and sibling spacing is the
              layout's gap: DS-GAP. */}
          <ul className="flex flex-col gap-1.5 text-sm leading-relaxed text-surface-300">
            {verdict.hints.map((hint) => (
              <li key={hint} className="flex gap-2">
                <span aria-hidden className="shrink-0 text-surface-500 select-none">
                  •
                </span>
                <span className="min-w-0 flex-1">{hintText(hint, incident)}</span>
              </li>
            ))}
          </ul>
        </DetailSection>
      )}

      <DetailSection title={m.diagnostics_evidence_title()}>
        <EvidenceTimeline evidence={incident.evidence} />
      </DetailSection>

      <FactsLine incident={incident} />
      <IncidentActions incident={incident} />
    </div>
  );
}

function DetailSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-[0.625rem] font-semibold tracking-wider text-surface-500 uppercase select-none">
        {title}
      </h3>
      {children}
    </section>
  );
}

function SuspectRow({ suspect, modAction }: { suspect: Suspect; modAction?: ModAction }) {
  return (
    <li data-ui="IncidentDetail:suspect" className="flex items-center gap-3 px-3 py-2">
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-surface-100">
          {suspect.displayName}
        </span>
        <span className="block truncate text-xs text-surface-400">{suspect.because}</span>
      </span>
      <SuspectAction suspect={suspect} modAction={modAction} />
    </li>
  );
}

function SuspectAction({ suspect, modAction }: { suspect: Suspect; modAction?: ModAction }) {
  if (suspect.modId) return modAction?.(suspect.modId) ?? null;
  if (suspect.projectPath) return <OpenProjectButton projectPath={suspect.projectPath} />;
  return null;
}

function OpenProjectButton({ projectPath }: { projectPath: string }) {
  const navigate = useNavigate();

  return (
    <Button
      variant="outline"
      size="xs"
      left={<ArrowSquareOutIcon weight="bold" className="h-3.5 w-3.5" />}
      onClick={() =>
        navigate({
          to: "/workshop/$projectName",
          params: { projectName: projectNameFromPath(projectPath) },
        })
      }
    >
      {m.diagnostics_suspect_open_action()}
    </Button>
  );
}

function FactsLine({ incident }: { incident: Incident }) {
  const facts = [
    incident.game?.version,
    formatDuration(incident.startedAt, incident.endedAt),
    formatOrigin(incident.origin),
    incident.game ? m.diagnostics_facts_log_found_label() : m.diagnostics_facts_no_log_label(),
  ].filter((fact): fact is string => !!fact);

  return (
    <p data-ui="IncidentDetail:facts" className="font-mono text-xs text-surface-400">
      {facts.join(" · ")}
    </p>
  );
}

function IncidentActions({ incident }: { incident: Incident }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const copy = useCopyToClipboard();
  const report = useIncidentReport(incident);
  const token = useIncidentToken(incident.id);
  const revealLog = useRevealGameLog();
  const dismiss = useDismissIncident();
  const rebuild = useRebuildOverlay();
  const { data: patcherStatus } = usePatcherStatus();

  const patcherRunning = patcherStatus?.running ?? false;

  async function copyReport() {
    try {
      const text =
        report.data ?? (await queryClient.fetchQuery(diagnosticsQueries.incidentReport(incident)));
      await navigator.clipboard.writeText(text);
      toast.success(m.diagnostics_report_copied_title(), m.diagnostics_report_copied_description());
    } catch (error) {
      toast.error(m.diagnostics_report_copy_failed_title(), errorMessage(error));
    }
  }

  async function copyToken() {
    let text: string;
    try {
      text =
        token.data ?? (await queryClient.fetchQuery(diagnosticsQueries.incidentToken(incident.id)));
    } catch (error) {
      toast.error(m.diagnostics_token_build_failed_title(), errorMessage(error));
      return;
    }
    await copy(text, "token");
  }

  function openGameLog() {
    revealLog.mutate(incident.id, {
      onError: (error) =>
        toast.error(m.diagnostics_game_log_open_failed_title(), errorSummary(error)),
    });
  }

  function rebuildOverlay() {
    rebuild.mutate(undefined, {
      onSuccess: () =>
        toast.success(m.patcher_rebuild_done_title(), m.patcher_rebuild_done_description()),
      onError: (error) => toast.error(m.patcher_rebuild_failed_title(), errorSummary(error)),
    });
  }

  const rebuildButton = (
    <Button
      variant="outline"
      size="sm"
      disabled={patcherRunning}
      loading={rebuild.isPending}
      left={<ArrowsClockwiseIcon weight="bold" className="h-4 w-4" />}
      onClick={rebuildOverlay}
    >
      {m.patcher_rebuild_action()}
    </Button>
  );

  return (
    <div data-ui="IncidentDetail:actions" className="flex flex-wrap items-center gap-2 select-none">
      <Button
        variant="outline"
        size="sm"
        disabled={!incident.game}
        loading={revealLog.isPending}
        left={<FileTextIcon weight="bold" className="h-4 w-4" />}
        onClick={openGameLog}
      >
        {m.diagnostics_open_game_log_action()}
      </Button>
      <Button
        variant="outline"
        size="sm"
        left={<ClipboardTextIcon weight="bold" className="h-4 w-4" />}
        onClick={copyReport}
      >
        {m.diagnostics_copy_report_action()}
      </Button>
      <Button
        variant="outline"
        size="sm"
        left={<HashIcon weight="bold" className="h-4 w-4" />}
        onClick={copyToken}
      >
        {m.diagnostics_copy_token_action()}
      </Button>
      {!patcherRunning && rebuildButton}
      {patcherRunning && (
        <Tooltip content={m.diagnostics_patcher_busy_hint()}>
          <span className="inline-flex">{rebuildButton}</span>
        </Tooltip>
      )}
      <span className="flex-1" />
      <Button
        variant="ghost"
        size="sm"
        disabled={incident.dismissed}
        loading={dismiss.isPending}
        left={<XIcon weight="bold" className="h-4 w-4" />}
        onClick={() => dismiss.mutate(incident.id)}
      >
        {incident.dismissed && m.diagnostics_dismissed_label()}
        {!incident.dismissed && m.diagnostics_dismiss_action()}
      </Button>
    </div>
  );
}
