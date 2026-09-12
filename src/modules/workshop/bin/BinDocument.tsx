import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react";

import { Popover, Spinner } from "@/components";
import { m } from "@/i18n";
import type { AssetRef, BinDocumentHandle, BinHeader, BinRow } from "@/lib/tauri";
import { DocumentToolbar, useNarrowToolbar } from "@/modules/editor";

import { objectDocument } from "../documents/contentDocument";
import type { OpenIntent } from "../palette/types";
/* The leaf rather than the preview barrel, which pulls the document that routes here. */
import { BinPreview } from "../preview/BinPreview";
import {
  useAimCurve,
  useObjectRevealRequest,
  useOpenDocumentAs,
  useSettleObjectReveal,
} from "../state";
import { objectKey, rowKey } from "./binRows";
import { BinTree, type TreeReveal } from "./BinTree";
import { type CurveDock, CurveDockContext } from "./curveTarget";
import { useBinDocument } from "./useBinDocument";

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
 * One row per object at depth zero, each expanding to its properties. A file that does
 * not parse lands in the handoff pane, with the error and the VS Code action.
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
  const roots = handle.rows;
  const rootByKey = useMemo(() => new Map(roots.map((row) => [rowKey(row), row])), [roots]);

  const narrow = useNarrowToolbar();

  /* A bin holding one object opens it expanded. */
  const initialExpanded = useMemo(() => {
    const [only] = roots;
    return only && roots.length === 1 ? [rowKey(only)] : [];
  }, [roots]);

  /* An answered request is settled. A later open of the same file starts clean. */
  const request = useObjectRevealRequest(documentId);
  const settle = useSettleObjectReveal();
  const [reveal, setReveal] = useState<TreeReveal | null>(null);
  useEffect(() => {
    if (request === null) return;
    settle(request.token);
    setReveal({ key: objectKey(request.objectHash), token: request.token });
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
    <div data-ui="BinDocument" className="flex min-h-0 flex-1 flex-col bg-surface-950">
      <DocumentToolbar active={active}>
        <BinFacts header={handle.header} narrow={narrow} />
        {actions}
      </DocumentToolbar>
      <CurveDockContext value={dock}>
        <BinTree
          document={handle.document}
          asset={asset}
          roots={roots}
          rootOwner={null}
          label={name}
          initialExpanded={initialExpanded}
          reveal={reveal}
          objectName={(entry) => rootByKey.get(objectKey(entry))?.name ?? entry}
          onNotOpen={reopen}
          onOpenObject={openObject}
        />
      </CurveDockContext>
    </div>
  );
}

interface BinFactsProps {
  header: BinHeader;
  /** The toolbar has room for the count and what opens, and for none of the rest. */
  narrow: boolean;
}

/** What the file is, in the row its tab owns: the count, the version, the dependencies. */
function BinFacts({ header, narrow }: BinFactsProps) {
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
          <Dependencies paths={header.dependencies} />
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
              {header.deleted > 0 && (
                <>
                  <Dot />
                  <span>{m.workshop_bin_patch_deleted_label({ count: header.deleted })}</span>
                </>
              )}
            </>
          )}
        </>
      )}
    </span>
  );
}

/** The dependency count, opening to the list of paths. */
function Dependencies({ paths }: { paths: readonly string[] }) {
  const label = m.workshop_bin_dependencies_label({ count: paths.length });
  if (paths.length === 0) return <span>{label}</span>;

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
          <Popover.Popup aria-label={label} className="max-w-md p-2">
            <ul className="flex flex-col gap-0.5 font-mono text-code text-surface-200 select-text">
              {paths.map((path) => (
                <li key={path} className="truncate">
                  {path}
                </li>
              ))}
            </ul>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

/** The separator between two facts of a toolbar. */
export function Dot() {
  return <span aria-hidden>·</span>;
}
