import { ArrowsClockwiseIcon, XIcon } from "@phosphor-icons/react";
import { useCallback, useMemo, useState } from "react";

import { Button, EmptyState, Progress } from "@/components";
import { m } from "@/i18n";
import { api, type ReferenceResult, type ReferenceWalkProgress } from "@/lib/tauri";
import { useTauriEvent } from "@/lib/useTauriEvent";
import { DocumentToolbar, type EditorDocumentProps } from "@/modules/editor";
import { twMerge } from "@/utils";

import { ClassCard } from "../../bin/classes/components/ClassCard";
import type { ContentDocumentOf } from "../../documents/utils/contentDocument";
import {
  GameLoadingState,
  GameWadsErrorState,
} from "../../gameBrowser/components/GameBrowserStates";
import { useWarmOnAbsent } from "../../objectsBrowser/api/useObjectIndex";
/* The leaf rather than the browser's barrel, which reaches this module back through
   the documents registry mid-evaluation. */
import {
  ObjectIndexBuildingState,
  ObjectIndexFailedState,
} from "../../objectsBrowser/components/ObjectIndexStates";
import { CollapseAllButton } from "../../shared/components/CollapseAllButton";
import {
  type ReferenceRequest,
  useCollapseReferenceFiles,
  useReferenceRequest,
  useShutReferenceFiles,
  useToggleReferenceFile,
} from "../../state";
import { isWalk } from "../api/queries";
import { useReferences } from "../api/useReferences";
import { useOpenReferenceNode } from "../hooks/useOpenReferenceNode";
import {
  buildReferenceTree,
  countReferences,
  type ReferenceFileNode,
} from "../utils/referenceTree";
import { ReferencesTree } from "./ReferencesTree";

/**
 * The References document: one question's answer, grouped by declaring file.
 *
 * "The References document" in docs/ux/PROJECT_EDITOR.md. The question sits in the
 * header with the control that runs it again, and a new question replaces both.
 */
export function ReferencesDocument({
  active,
}: EditorDocumentProps<ContentDocumentOf<"references">>) {
  const request = useReferenceRequest();
  const { data, isFetching, refetch } = useReferences(request);
  const walk = request !== null && isWalk(request.query);

  return (
    <div data-ui="ReferencesDocument" className="flex min-h-0 flex-1 flex-col bg-surface-950">
      <DocumentToolbar active={active}>
        <Question request={request} />
        {data?.status === "ready" && <Counts result={data} walk={walk} />}
        {request !== null && (
          <Button
            variant="ghost"
            size="xs"
            className="ml-auto"
            left={
              <ArrowsClockwiseIcon className={twMerge("h-4 w-4", isFetching && "animate-spin")} />
            }
            onClick={() => void refetch()}
          >
            {m.workshop_references_rerun_action()}
          </Button>
        )}
        {request !== null && (
          <CollapseReferencesButton result={data?.status === "ready" ? data : null} />
        )}
      </DocumentToolbar>

      {walk && <WalkProgress walking={isFetching} />}
      {request === null && (
        <EmptyState
          size="sm"
          title={m.workshop_references_empty_title()}
          description={m.workshop_references_empty_description()}
        />
      )}
      {request !== null && <Answer request={request} />}
    </div>
  );
}

/** The question in the header: a class as its card, an object or a file as its path. */
function Question({ request }: { request: ReferenceRequest | null }) {
  if (request === null) {
    return (
      <span className="text-meta text-surface-400 select-none">
        {m.workshop_references_none_asked_label()}
      </span>
    );
  }
  if (request.query.kind === "class" || request.query.kind === "embedded") {
    const label =
      request.query.kind === "class"
        ? m.workshop_references_of_class_label()
        : m.workshop_references_of_embedded_label();
    return (
      <span className="flex min-w-0 items-center gap-2 text-meta select-none">
        <span className="shrink-0 text-surface-400">{label}</span>
        <ClassCard
          classHash={request.query.classHash}
          name={request.label === request.query.classHash ? null : request.label}
        />
      </span>
    );
  }
  return (
    <span className="flex min-w-0 items-center gap-2 text-meta select-none">
      <span className="shrink-0 text-surface-400">{m.workshop_references_of_object_label()}</span>
      <span className="min-w-0 truncate text-surface-200">{request.label}</span>
    </span>
  );
}

/** The collapse-all control over every file of the answer. */
function CollapseReferencesButton({ result }: { result: ReferenceResult | null }) {
  const collapseFiles = useCollapseReferenceFiles();
  const keys = useMemo(
    () => (result ? buildReferenceTree(result.groups).map((file) => file.id) : []),
    [result],
  );

  return <CollapseAllButton onCollapse={() => collapseFiles(keys)} disabled={keys.length === 0} />;
}

/** How much the answer holds: the rows, the files, what the cap left out, and a cancel's mark. */
function Counts({ result, walk }: { result: ReferenceResult; walk: boolean }) {
  const shown = countReferences(result.groups);
  /* A walk's row is a place inside an object, and one object can hold several. */
  const count = walk
    ? m.workshop_references_rows_label({ count: shown })
    : m.workshop_references_count_label({ count: shown });
  return (
    <span className="flex shrink-0 items-center gap-2 text-meta text-surface-400 select-none">
      <span aria-hidden>·</span>
      <span>{count}</span>
      <span aria-hidden>·</span>
      <span>{m.workshop_references_files_label({ count: result.groups.length })}</span>
      {result.total > shown && (
        <>
          <span aria-hidden>·</span>
          <span>
            {m.workshop_references_capped_label({
              shown: shown.toLocaleString(),
              total: result.total.toLocaleString(),
            })}
          </span>
        </>
      )}
      {result.cancelled && (
        <>
          <span aria-hidden>·</span>
          <span className="text-warning-text">{m.workshop_references_cancelled_label()}</span>
        </>
      )}
    </span>
  );
}

/**
 * The band a walk draws while it reads: how far it is, what it found, and its cancel.
 *
 * Drawn from the first report of a walk to its answer, so a poll of the index waiting on
 * its build never flashes it.
 */
function WalkProgress({ walking }: { walking: boolean }) {
  const [progress, setProgress] = useState<ReferenceWalkProgress | null>(null);
  useTauriEvent<ReferenceWalkProgress>(walking ? "reference-walk-progress" : null, setProgress);

  /* The last walk's figures are dropped as it answers, so the next walk starts from none. */
  const [wasWalking, setWasWalking] = useState(walking);
  if (wasWalking !== walking) {
    setWasWalking(walking);
    if (!walking) setProgress(null);
  }

  if (!walking || progress === null) return null;

  return (
    <div
      data-ui="ReferencesDocument:walk"
      className="flex shrink-0 items-center gap-3 border-b border-surface-600 px-3 py-1.5 text-meta text-surface-400 select-none"
    >
      <Progress.Root value={progress.walked} max={Math.max(progress.total, 1)} className="flex-1">
        <Progress.Track size="sm">
          <Progress.Indicator />
        </Progress.Track>
      </Progress.Root>
      <span className="shrink-0 tabular-nums">
        {m.workshop_references_walk_label({
          walked: progress.walked.toLocaleString(),
          total: progress.total.toLocaleString(),
        })}
      </span>
      <span aria-hidden>·</span>
      <span className="shrink-0 tabular-nums">
        {m.workshop_references_rows_label({ count: progress.hits })}
      </span>
      <Button
        variant="ghost"
        size="xs"
        left={<XIcon weight="bold" className="h-4 w-4" />}
        onClick={() => void api.objects.cancelWalk()}
      >
        {m.workshop_references_cancel_action()}
      </Button>
    </div>
  );
}

/** The body: the build while it runs, the failure that stopped it, or the groups. */
function Answer({ request }: { request: ReferenceRequest }) {
  const { data, error, isFetching } = useReferences(request);
  const retry = useWarmOnAbsent(data?.status);
  const shut = useShutReferenceFiles();
  const toggle = useToggleReferenceFile();
  const collapseFiles = useCollapseReferenceFiles();
  const open = useOpenReferenceNode();

  const files = useMemo(() => {
    if (data?.status !== "ready") return [];
    return buildReferenceTree(data.groups);
  }, [data]);

  const isShut = useCallback((node: ReferenceFileNode) => shut.has(node.id), [shut]);
  const handleToggle = useCallback((node: ReferenceFileNode) => toggle(node.id), [toggle]);
  const collapseAll = useCallback(
    () => collapseFiles(files.map((file) => file.id)),
    [collapseFiles, files],
  );

  if (error) return <GameWadsErrorState error={error} />;
  if (!data) return <GameLoadingState />;
  if (data.status === "failed")
    return <ObjectIndexFailedState error={data.error} onRetry={retry} />;
  if (data.status !== "ready") return <ObjectIndexBuildingState />;
  if (files.length === 0) {
    const description = isWalk(request.query)
      ? m.workshop_references_no_walk_match_description()
      : m.workshop_references_no_match_description();
    return (
      <EmptyState
        size="sm"
        title={m.workshop_references_no_match_title()}
        description={description}
      />
    );
  }

  return (
    <div
      className={twMerge(
        "flex min-h-0 flex-1 flex-col transition-opacity",
        /* Still the answer to the last question, dimmed rather than blanked. */
        isFetching && "opacity-50",
      )}
    >
      <ReferencesTree
        files={files}
        ariaLabel={m.workshop_references_title()}
        isShut={isShut}
        onToggle={handleToggle}
        onCollapseAll={collapseAll}
        onOpen={open}
      />
    </div>
  );
}
