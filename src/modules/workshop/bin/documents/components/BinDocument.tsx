import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react";

import { Popover, Spinner } from "@/components";
import { m } from "@/i18n";
import type {
  AssetRef,
  BinDocumentHandle,
  BinDocumentId,
  BinHeader,
  BinRow,
  ObjectName,
} from "@/lib/tauri";
import { DocumentToolbar, useNarrowToolbar } from "@/modules/editor";

import { objectDocument } from "../../../documents/utils/contentDocument";
import type { OpenIntent } from "../../../palette/utils/types";
/* The leaf rather than the preview barrel, which pulls the document that routes here. */
import { BinPreview } from "../../../preview/components/BinPreview";
import { CollapseAllButton } from "../../../shared/components/CollapseAllButton";
import {
  useAimCurve,
  useLendOpenBin,
  useOpenDocumentAs,
  useRowRevealRequest,
  useSettleRowReveal,
} from "../../../state";
import { type CurveDock, CurveDockContext } from "../../curves/state/curveTarget";
import { ObjectChip } from "../../links/components/LinkChip";
import {
  LinkOpenContext,
  LinkTargetsContext,
  type RowGroup,
  useCheckLinkTargets,
  useWarmLinkOpen,
} from "../../links/hooks/useLinkTargets";
import { BinTree, type TreeReveal } from "../../tree/components/BinTree";
import { NewObjectContext, useNewObjectDraft } from "../../tree/state/newObject";
import { objectKey, rowKey, sortedRoots, targetKey } from "../../tree/utils/binRows";
import { useBinDocument, useFileDependencies, useFileRoots } from "../hooks/useBinDocument";
import { useDeclaredState } from "../hooks/useDeclared";
import { useUndoKeys } from "../hooks/useUndoKeys";
import { BinEditState } from "./BinEditState";
import { DeclarationsOffNotice } from "./DeclarationsOffNotice";

interface BinDocumentProps {
  /** The editor's id for the tab, which a reveal request names. */
  documentId: string;
  asset: AssetRef;
  /** The file name, which the document resolved. A reference may hold a hash. */
  name: string;
  /** The file's path as an object tab names its declaring file: inside the archive or the layer. */
  file: string;
  active: boolean;
  /** The preview tab's own actions, drawn after the header facts. */
  actions: ReactNode;
}

/**
 * A property bin as blocks over its parsed tree.
 *
 * One row per object at depth zero, each expanding to its properties, then one per object
 * a `PTCH` patches, each expanding to its records. A file that does not parse lands in the
 * handoff pane, with the error and the VS Code action.
 */
export function BinDocument({ documentId, asset, name, file, active, actions }: BinDocumentProps) {
  const { state, reopen } = useBinDocument(asset);

  if (state.status === "failed") {
    return (
      <>
        <DocumentToolbar active={active}>{actions}</DocumentToolbar>
        <BinPreview asset={asset} name={name} error={state.error} />
      </>
    );
  }

  if (state.status === "opening") {
    return (
      <>
        <DocumentToolbar active={active}>{actions}</DocumentToolbar>
        <div
          data-ui="BinDocument"
          className="flex min-h-0 flex-1 items-center justify-center bg-surface-950"
        >
          <Spinner />
        </div>
      </>
    );
  }

  return (
    <OpenBin
      documentId={documentId}
      asset={asset}
      name={name}
      file={file}
      handle={state.handle}
      active={active}
      actions={actions}
      reopen={reopen}
    />
  );
}

interface OpenBinProps {
  documentId: string;
  asset: AssetRef;
  name: string;
  file: string;
  handle: BinDocumentHandle;
  active: boolean;
  actions: ReactNode;
  reopen: () => void;
}

function OpenBin({ documentId, asset, name, file, handle, active, actions, reopen }: OpenBinProps) {
  const read = useFileRoots(handle);
  const roots = useMemo(() => sortedRoots(read), [read]);
  const rootByKey = useMemo(() => new Map(roots.map((row) => [rowKey(row), row])), [roots]);

  const dependencies = useFileDependencies(handle);
  const prop = handle.header.kind === "prop";
  const [dependenciesReveal, setDependenciesReveal] = useState(0);
  const [collapseAllSignal, setCollapseAllSignal] = useState(0);
  const declaredState = useDeclaredState(handle.document);
  const removedLinks = declaredState?.links.filter((link) => link.change === "removed").length ?? 0;

  const narrow = useNarrowToolbar();
  const undoKeys = useUndoKeys(handle.document, asset, handle.readOnly === null);
  /* Only a declared document that takes edits creates an object. ADR-0049. */
  const newObject = useNewObjectDraft();
  const declares = declaredState !== null && handle.readOnly === null;
  useLendOpenBin(documentId, handle.document, null);

  /* A bin holding one object opens it expanded. */
  const initialExpanded = useMemo(() => {
    const [only] = roots;
    return only && roots.length === 1 ? [rowKey(only)] : [];
  }, [roots]);

  /* An answered request is settled. A later open of the same file starts clean. */
  const request = useRowRevealRequest(documentId);
  const settle = useSettleRowReveal();
  const [reveal, setReveal] = useState<TreeReveal | null>(null);
  useEffect(() => {
    if (request === null) return;
    settle(request.token);
    setReveal({ key: request.key, token: request.token });
  }, [request, settle]);

  const open = useOpenDocumentAs();
  const documentOf = useCallback(
    (row: BinRow) =>
      objectDocument(
        asset,
        row.entry,
        row.name,
        file,
        row.value.type === "struct" ? row.value.class : null,
      ),
    [asset, file],
  );
  const openObject = useCallback(
    (row: BinRow, intent: OpenIntent) => open(documentOf(row), intent),
    [documentOf, open],
  );

  /* A file tab finds an object and an object tab reads one, so there is one dock in the
     app and aiming from here lands the reader where the value's siblings are. */
  const aimCurve = useAimCurve();
  const dock = useMemo<CurveDock>(
    () => ({
      target: null,
      aim: ({ row, chain }) => {
        const object = rootByKey.get(objectKey(row.entry));
        if (object === undefined) return;
        const document = documentOf(object);
        open(document, "default");
        aimCurve(document.id, row, chain);
      },
      clear: () => {},
    }),
    [aimCurve, documentOf, open, rootByKey],
  );

  return (
    <div
      data-ui="BinDocument"
      /* Focusable, so a click anywhere in the tab is where its undo keys land. */
      tabIndex={-1}
      className="flex min-h-0 flex-1 flex-col bg-surface-950 outline-none"
      onKeyDown={undoKeys}
    >
      <NewObjectContext value={declares ? newObject : null}>
        <DocumentToolbar active={active}>
          <BinFacts
            document={handle.document}
            header={handle.header}
            dependencies={dependencies.length - removedLinks}
            narrow={narrow}
            onDependencies={() => setDependenciesReveal((count) => count + 1)}
          />
          <CollapseAllButton onCollapse={() => setCollapseAllSignal((count) => count + 1)} />
          <BinEditState
            document={handle.document}
            asset={asset}
            readOnly={handle.readOnly}
            onReload={reopen}
          />
          {actions}
        </DocumentToolbar>
        {handle.readOnly === "declarationsOff" && (
          <DeclarationsOffNotice asset={asset} file={file} subject={name} />
        )}
        <CurveDockContext value={dock}>
          <BinTree
            document={handle.document}
            asset={asset}
            roots={roots}
            rootOwner={null}
            label={name}
            initialExpanded={initialExpanded}
            reveal={reveal}
            objectName={(entry) =>
              (rootByKey.get(objectKey(entry)) ?? rootByKey.get(targetKey(entry)))?.name ?? entry
            }
            onNotOpen={reopen}
            onOpenObject={openObject}
            editable={handle.readOnly === null}
            dependencies={prop ? dependencies : null}
            dependenciesReveal={dependenciesReveal}
            collapseAllSignal={collapseAllSignal}
          />
        </CurveDockContext>
      </NewObjectContext>
    </div>
  );
}

interface BinFactsProps {
  document: BinDocumentId;
  header: BinHeader;
  /** How many dependencies the file holds now, which an edit changes from the header's. */
  dependencies: number;
  /** The toolbar has room for the count and what opens, and for none of the rest. */
  narrow: boolean;
  /** Open the tree's pinned dependencies row and move to it. */
  onDependencies: () => void;
}

/** What the file is, in the row its tab owns: the count, the version, the dependencies. */
function BinFacts({ document, header, dependencies, narrow, onDependencies }: BinFactsProps) {
  return (
    <span className="flex min-w-0 items-center gap-2 text-meta text-surface-400 select-none">
      <span>{m.workshop_bin_objects_label({ count: header.objects })}</span>
      {!narrow && header.kind === "prop" && header.version !== null && (
        <>
          <Dot />
          <span>{m.workshop_bin_version_label({ version: header.version })}</span>
        </>
      )}
      {header.kind === "prop" && (
        <>
          <Dot />
          <button
            type="button"
            className="cursor-pointer underline decoration-dotted underline-offset-2 hover:text-surface-200"
            onClick={onDependencies}
          >
            {m.workshop_bin_dependencies_label({ count: dependencies })}
          </button>
        </>
      )}
      {header.kind === "patch" && (
        <>
          <Dot />
          <span>{m.workshop_bin_patch_label()}</span>
          {!narrow && (
            <>
              <Dot />
              <span>{m.workshop_bin_patch_records_label({ count: header.patches })}</span>
              {header.deleted.length > 0 && (
                <>
                  <Dot />
                  <Deleted document={document} objects={header.deleted} />
                </>
              )}
            </>
          )}
        </>
      )}
    </span>
  );
}

interface DeletedProps {
  document: BinDocumentId;
  objects: readonly ObjectName[];
}

/** The count of objects a patch deletes, opening to a link to each. */
function Deleted({ document, objects }: DeletedProps) {
  const label = m.workshop_bin_patch_deleted_label({ count: objects.length });

  return (
    <Popover.Root>
      <Popover.Trigger
        render={
          <button
            type="button"
            className="cursor-pointer underline decoration-dotted underline-offset-2 hover:text-surface-200"
          />
        }
      >
        {label}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner side="bottom" align="start" sideOffset={8}>
          <Popover.Popup aria-label={label} className="max-w-md p-2 text-meta">
            <DeletedLinks document={document} objects={objects} />
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

/** Each deleted object as the chip a `link` to it draws, checked the way a tree checks one. */
function DeletedLinks({ document, objects }: DeletedProps) {
  const groups = useMemo<RowGroup[]>(
    () => [{ key: "deleted", rows: objects.map(linkRow) }],
    [objects],
  );
  const targets = useCheckLinkTargets(document, groups);
  const linkOpen = useWarmLinkOpen(targets);

  return (
    <LinkTargetsContext value={targets}>
      <LinkOpenContext value={linkOpen}>
        <ul className="flex flex-col gap-0.5 font-mono text-code text-surface-200 select-text">
          {objects.map((object) => (
            <li key={object.hash} className="flex min-w-0">
              <ObjectChip hash={object.hash} name={object.name} kind="link" />
            </li>
          ))}
        </ul>
      </LinkOpenContext>
    </LinkTargetsContext>
  );
}

/** A deleted object as the `link` row a link check reads. */
function linkRow(object: ObjectName): BinRow {
  return {
    entry: object.hash,
    path: "",
    label: "",
    node: "object",
    name: object.name ?? object.hash,
    unnamed: object.name === null,
    kind: null,
    value: { type: "objectLink", hash: object.hash, name: object.name },
    declared: null,
  };
}

/** The separator between two facts of a toolbar. */
export function Dot() {
  return <span aria-hidden>·</span>;
}
