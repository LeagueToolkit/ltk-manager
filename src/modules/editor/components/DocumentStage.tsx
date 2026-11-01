import {
  type ComponentType,
  createContext,
  memo,
  type ReactElement,
  type ReactNode,
  use,
  useLayoutEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
import { createPortal } from "react-dom";

import { RetainedContent } from "@/components";
import { ContentVisibilityContext } from "@/hooks";

import { createPortalHost, type PortalHost } from "../layout/PortalHosts";
import { IslandsContext } from "../state/islands";
import type { EditorDocumentBase, EditorDocumentDefinition, EditorRegistry } from "../types";
import { DocumentToolbarSlotContext } from "./DocumentToolbar";

/** What an editor group offers the documents it shows. */
export interface LeafChrome {
  readonly toolbar: HTMLElement | null;
  readonly reportIslands: () => () => void;
}

/** One open document and the editor group that shows it. */
export interface DocumentPlacement<D extends EditorDocumentBase> {
  readonly document: D;
  readonly leafId: string;
  readonly active: boolean;
}

interface Stage {
  readonly hostOf: (documentId: string) => PortalHost;
  readonly keepHosts: (documentIds: ReadonlySet<string>) => void;
  readonly chromeOf: (leafId: string) => LeafChrome | null;
  /** Publishes the chrome of `leafId`, and returns the call that withdraws it. */
  readonly publish: (leafId: string, chrome: LeafChrome) => () => void;
  readonly subscribe: (listener: () => void) => () => void;
}

function createStage(): Stage {
  const hosts = new Map<string, PortalHost>();
  const chromes = new Map<string, LeafChrome>();
  const listeners = new Set<() => void>();
  const notify = () => {
    for (const listener of listeners) listener();
  };

  return {
    hostOf: (documentId) => {
      let host = hosts.get(documentId);
      if (host === undefined) {
        host = createPortalHost(`document:${documentId}`);
        hosts.set(documentId, host);
      }

      return host;
    },
    keepHosts: (documentIds) => {
      for (const documentId of hosts.keys()) {
        if (!documentIds.has(documentId)) hosts.delete(documentId);
      }
    },
    chromeOf: (leafId) => chromes.get(leafId) ?? null,
    publish: (leafId, chrome) => {
      chromes.set(leafId, chrome);
      notify();

      return () => {
        /* A group remounted under the same id may have published already. */
        if (chromes.get(leafId) !== chrome) return;

        chromes.delete(leafId);
        notify();
      };
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

const StageContext = createContext<Stage | null>(null);

/**
 * Returns the stage around the caller. Throws outside a `DocumentStage`.
 */
export function useDocumentStage(): Stage {
  const stage = use(StageContext);
  if (stage === null) throw new Error("useDocumentStage must be used within a DocumentStage");

  return stage;
}

/** Publishes the chrome of the surface drawing `leafId` while it is mounted. */
export function usePublishLeafChrome(leafId: string, chrome: LeafChrome): void {
  const stage = useDocumentStage();

  useLayoutEffect(() => stage.publish(leafId, chrome), [stage, leafId, chrome]);
}

export interface DocumentStageProps<D extends EditorDocumentBase> {
  readonly placements: readonly DocumentPlacement<D>[];
  readonly registry: EditorRegistry<D>;
  /** The per-group context a document reads, supplied by the host of the surfaces. */
  readonly leafScope: ComponentType<{ leafId: string; children: ReactNode }>;
  /** The split tree, whose surfaces show the documents. */
  readonly children: ReactNode;
}

/**
 * The open documents of a split tree, mounted once above it.
 *
 * Each document renders through a portal that its group's `EditorSurface` adopts, so closing a
 * neighbouring group, a split, a move between groups and a maximize keep every document mounted.
 * A canvas keeps its WebGL context and everything uploaded to it.
 */
export function DocumentStage<D extends EditorDocumentBase>({
  placements,
  registry,
  leafScope,
  children,
}: DocumentStageProps<D>) {
  const [stage] = useState(createStage);

  const openIds = useMemo(
    () => new Set(placements.map((placement) => placement.document.id)),
    [placements],
  );
  useLayoutEffect(() => stage.keepHosts(openIds), [stage, openIds]);

  return (
    <StageContext value={stage}>
      {children}
      {placements.map(({ document, leafId, active }) => (
        <StagedDocument<D>
          key={document.id}
          stage={stage}
          document={document}
          leafId={leafId}
          active={active}
          registry={registry}
          leafScope={leafScope}
        />
      ))}
    </StageContext>
  );
}

interface StagedDocumentProps<D extends EditorDocumentBase> extends DocumentPlacement<D> {
  readonly stage: Stage;
  readonly registry: EditorRegistry<D>;
  readonly leafScope: DocumentStageProps<D>["leafScope"];
}

/* `memo` narrows a generic component to one signature. A seam drag rewrites the tree, and the
   memo keeps that from rendering every open document. */
const StagedDocument = memo(function StagedDocument<D extends EditorDocumentBase>({
  stage,
  document,
  leafId,
  active,
  registry,
  leafScope: LeafScope,
}: StagedDocumentProps<D>) {
  const host = stage.hostOf(document.id);
  const view = useSyncExternalStore(host.subscribe, host.view);
  const chrome = useSyncExternalStore(stage.subscribe, () => stage.chromeOf(leafId));

  /* The registry narrows to one kind per key, which a lookup by a union's own kind cannot
     express. The key comes off the document, so the two agree. */
  const definition = registry[document.kind as D["kind"]] as unknown as
    | EditorDocumentDefinition<D>
    | undefined;
  if (!definition) return null;

  const Editor = definition.component;

  return createPortal(
    <ContentVisibilityContext value={view === "shown"}>
      <LeafScope leafId={leafId}>
        <DocumentToolbarSlotContext value={chrome?.toolbar ?? null}>
          <IslandsContext value={chrome?.reportIslands ?? null}>
            <RetainedContent
              data-ui={`EditorSurface:document:${document.kind}`}
              active={active}
              className="absolute inset-0 flex flex-col"
            >
              <Editor document={document} active={active} />
            </RetainedContent>
          </IslandsContext>
        </DocumentToolbarSlotContext>
      </LeafScope>
    </ContentVisibilityContext>,
    host.node,
  );
}) as <D extends EditorDocumentBase>(props: StagedDocumentProps<D>) => ReactElement | null;
