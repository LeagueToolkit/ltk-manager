import {
  ArrowsClockwiseIcon,
  ArrowSquareOutIcon,
  ClipboardTextIcon,
  FileTextIcon,
  HashIcon,
  ProhibitIcon,
  XIcon,
} from "@phosphor-icons/react";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import type { ReactNode } from "react";

import { Button, Tooltip, useToast } from "@/components";
import { useCopyToClipboard } from "@/hooks";
import type { Incident, Suspect } from "@/lib/tauri";
import { useInstalledMods, useToggleMod } from "@/modules/library";
import { usePatcherStatus, useRebuildOverlay } from "@/modules/patcher";

import {
  incidentReportOptions,
  incidentTokenOptions,
  useDismissIncident,
  useIncidentReport,
  useIncidentToken,
  useRevealGameLog,
} from "../api";
import { formatDuration, formatOrigin, projectNameFromPath } from "../utils/incident";
import { ConfidenceChip } from "./ConfidenceChip";
import { EvidenceTimeline } from "./EvidenceTimeline";
import { VerdictCard } from "./VerdictCard";

const PATCHER_BUSY = "Stop the patcher first";

interface IncidentDetailProps {
  incident: Incident;
}

/**
 * One incident, top to bottom in the order a player asks: the verdict, the
 * suspects, the hints, the evidence, the facts, and the actions.
 */
export function IncidentDetail({ incident }: IncidentDetailProps) {
  const { verdict } = incident;

  return (
    <div data-ui="IncidentDetail" className="flex flex-col gap-5 select-none">
      <VerdictCard incident={incident} />

      {incident.suspects.length > 0 && (
        <DetailSection title="Suspects">
          <ul className="divide-y divide-surface-800 rounded-lg border border-surface-700/50 bg-surface-900/95">
            {incident.suspects.map((suspect, index) => (
              <SuspectRow key={`${suspect.displayName}-${index}`} suspect={suspect} />
            ))}
          </ul>
        </DetailSection>
      )}

      {verdict.hints.length > 0 && (
        <DetailSection title="Hints">
          <ul className="flex flex-col gap-1 text-sm leading-relaxed text-surface-300">
            {verdict.hints.map((hint) => (
              <li key={hint}>{hint}</li>
            ))}
          </ul>
        </DetailSection>
      )}

      <DetailSection title="Evidence">
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
      <h3 className="text-[10px] font-semibold tracking-wider text-surface-500 uppercase">
        {title}
      </h3>
      {children}
    </section>
  );
}

function SuspectRow({ suspect }: { suspect: Suspect }) {
  return (
    <li data-ui="IncidentDetail:suspect" className="flex items-center gap-3 px-3 py-2">
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-surface-100 select-text">
          {suspect.displayName}
        </span>
        <span className="block truncate text-xs text-surface-400">{suspect.because}</span>
      </span>
      <ConfidenceChip confidence={suspect.confidence} />
      <SuspectAction suspect={suspect} />
    </li>
  );
}

function SuspectAction({ suspect }: { suspect: Suspect }) {
  if (suspect.modId) return <DisableModButton modId={suspect.modId} />;
  if (suspect.projectPath) return <OpenProjectButton projectPath={suspect.projectPath} />;
  return null;
}

/**
 * `Disable` for a mod still in the library. An uninstalled suspect keeps its
 * row under its display name and offers nothing.
 */
function DisableModButton({ modId }: { modId: string }) {
  const { data: mods } = useInstalledMods();
  const { data: patcherStatus } = usePatcherStatus();
  const toggleMod = useToggleMod();
  const toast = useToast();

  const mod = mods?.find((candidate) => candidate.id === modId);
  if (!mod) return null;

  if (!mod.enabled) {
    return (
      <Button variant="ghost" size="xs" disabled>
        Disabled
      </Button>
    );
  }

  const patcherRunning = patcherStatus?.running ?? false;
  const button = (
    <Button
      variant="outline"
      size="xs"
      disabled={patcherRunning}
      loading={toggleMod.isPending}
      left={<ProhibitIcon weight="bold" className="h-3.5 w-3.5" />}
      onClick={() =>
        toggleMod.mutate(
          { modId, enabled: false },
          {
            onSuccess: () =>
              toast.warning("Mod disabled", `${mod.displayName} stays out of the next game.`),
            onError: (error) => toast.error("Couldn't disable the mod", error.message),
          },
        )
      }
    >
      Disable
    </Button>
  );

  if (!patcherRunning) return button;
  return (
    <Tooltip content={PATCHER_BUSY}>
      <span className="inline-flex">{button}</span>
    </Tooltip>
  );
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
      Open
    </Button>
  );
}

function FactsLine({ incident }: { incident: Incident }) {
  const facts = [
    incident.game?.version,
    formatDuration(incident.startedAt, incident.endedAt),
    formatOrigin(incident.origin),
    incident.game ? "log found" : "no log",
  ].filter((fact): fact is string => !!fact);

  return (
    <p data-ui="IncidentDetail:facts" className="font-mono text-xs text-surface-400 select-text">
      {facts.join(" · ")}
    </p>
  );
}

function messageOf(error: unknown): string {
  if (typeof error === "object" && error !== null && "message" in error) {
    return String((error as { message: unknown }).message);
  }
  return "Unknown error";
}

function IncidentActions({ incident }: { incident: Incident }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const copy = useCopyToClipboard();
  const report = useIncidentReport(incident.id);
  const token = useIncidentToken(incident.id);
  const revealLog = useRevealGameLog();
  const dismiss = useDismissIncident();
  const rebuild = useRebuildOverlay();
  const { data: patcherStatus } = usePatcherStatus();

  const patcherRunning = patcherStatus?.running ?? false;
  const dismissLabel = incident.dismissed ? "Dismissed" : "Dismiss";

  async function copyReport() {
    try {
      const text =
        report.data ?? (await queryClient.fetchQuery(incidentReportOptions(incident.id)));
      await navigator.clipboard.writeText(text);
      toast.success("Copied report", "Paste it into a bug report or a support thread.");
    } catch (error) {
      toast.error("Couldn't copy the report", messageOf(error));
    }
  }

  async function copyToken() {
    let text: string;
    try {
      text = token.data ?? (await queryClient.fetchQuery(incidentTokenOptions(incident.id)));
    } catch (error) {
      toast.error("Couldn't build the token", messageOf(error));
      return;
    }
    await copy(text, "token");
  }

  function openGameLog() {
    revealLog.mutate(incident.id, {
      onError: (error) => toast.error("Couldn't open the game log", error.message),
    });
  }

  function rebuildOverlay() {
    rebuild.mutate(undefined, {
      onSuccess: () =>
        toast.success("Overlay rebuilt", "The overlay was regenerated from scratch."),
      onError: (error) => toast.error("Rebuild failed", error.message),
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
      Rebuild overlay
    </Button>
  );

  return (
    <div data-ui="IncidentDetail:actions" className="flex flex-wrap items-center gap-2">
      <Button
        variant="outline"
        size="sm"
        disabled={!incident.game}
        loading={revealLog.isPending}
        left={<FileTextIcon weight="bold" className="h-4 w-4" />}
        onClick={openGameLog}
      >
        Open game log
      </Button>
      <Button
        variant="outline"
        size="sm"
        left={<ClipboardTextIcon weight="bold" className="h-4 w-4" />}
        onClick={copyReport}
      >
        Copy report
      </Button>
      <Button
        variant="outline"
        size="sm"
        left={<HashIcon weight="bold" className="h-4 w-4" />}
        onClick={copyToken}
      >
        Copy token
      </Button>
      {!patcherRunning && rebuildButton}
      {patcherRunning && (
        <Tooltip content={PATCHER_BUSY}>
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
        {dismissLabel}
      </Button>
    </div>
  );
}
