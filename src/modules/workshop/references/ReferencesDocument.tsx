import { ArrowsClockwiseIcon } from "@phosphor-icons/react";
import { useCallback, useMemo } from "react";
import { twMerge } from "tailwind-merge";

import { Button, EmptyState } from "@/components";
import { m } from "@/i18n";
import type { ReferenceResult } from "@/lib/tauri";
import { DocumentToolbar, type EditorDocumentProps } from "@/modules/editor";

import { ClassCard } from "../bin/ClassCard";
import type { ContentDocumentOf } from "../documents/contentDocument";
import { GameLoadingState, GameWadsErrorState } from "../gameBrowser/GameBrowserStates";
import { useWarmOnAbsent } from "../gameBrowser/useObjectIndex";
/* The leaf rather than the browser's barrel, which reaches this module back through
   the documents registry mid-evaluation. */
import {
  ObjectIndexBuildingState,
  ObjectIndexFailedState,
} from "../objectsBrowser/ObjectIndexStates";
import {
  type ReferenceRequest,
  useReferenceRequest,
  useShutReferenceFiles,
  useToggleReferenceFile,
} from "../state";
import { ReferencesTree } from "./ReferencesTree";
import { buildReferenceTree, countReferences, type ReferenceFileNode } from "./referenceTree";
import { useOpenReferenceNode } from "./useOpenReferenceNode";
import { useReferences } from "./useReferences";

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

  return (
    <div data-ui="ReferencesDocument" className="flex min-h-0 flex-1 flex-col bg-surface-950">
      <DocumentToolbar active={active}>
        <Question request={request} />
        {data?.status === "ready" && <Counts result={data} />}
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
      </DocumentToolbar>

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

/** The question in the header: a class as its card, an object as its path. */
function Question({ request }: { request: ReferenceRequest | null }) {
  if (request === null) {
    return (
      <span className="text-meta text-surface-400 select-none">
        {m.workshop_references_none_asked_label()}
      </span>
    );
  }
  if (request.query.kind === "class") {
    return (
      <span className="flex min-w-0 items-center gap-2 text-meta select-none">
        <span className="shrink-0 text-surface-400">{m.workshop_references_of_class_label()}</span>
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

/** How much the answer holds: the objects, the files, and what the cap left out. */
function Counts({ result }: { result: ReferenceResult }) {
  const shown = countReferences(result.groups);
  return (
    <span className="flex shrink-0 items-center gap-2 text-meta text-surface-400 select-none">
      <span aria-hidden>·</span>
      <span>{m.workshop_references_count_label({ count: shown })}</span>
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
    </span>
  );
}

/** The body: the build while it runs, the failure that stopped it, or the groups. */
function Answer({ request }: { request: ReferenceRequest }) {
  const { data, error, isFetching } = useReferences(request);
  const retry = useWarmOnAbsent(data?.status);
  const shut = useShutReferenceFiles();
  const toggle = useToggleReferenceFile();
  const open = useOpenReferenceNode();

  const files = useMemo(() => {
    if (data?.status !== "ready") return [];
    return buildReferenceTree(data.groups);
  }, [data]);

  const isShut = useCallback((node: ReferenceFileNode) => shut.has(node.id), [shut]);
  const handleToggle = useCallback((node: ReferenceFileNode) => toggle(node.id), [toggle]);

  if (error) return <GameWadsErrorState error={error} />;
  if (!data) return <GameLoadingState />;
  if (data.status === "failed")
    return <ObjectIndexFailedState error={data.error} onRetry={retry} />;
  if (data.status !== "ready") return <ObjectIndexBuildingState />;
  if (files.length === 0) {
    return (
      <EmptyState
        size="sm"
        title={m.workshop_references_no_match_title()}
        description={m.workshop_references_no_match_description()}
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
        onOpen={open}
      />
    </div>
  );
}
