import {
  CopyIcon,
  DotsThreeVerticalIcon,
  FileIcon,
  HashIcon,
  MagnifyingGlassIcon,
  PathIcon,
} from "@phosphor-icons/react";
import {
  type MouseEvent as ReactMouseEvent,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { Group, Panel } from "react-resizable-panels";

import { Button, IconButton, Menu, SegmentedControl, Spinner } from "@/components";
import { useCopyToClipboard } from "@/hooks";
import { m } from "@/i18n";
import type { AssetRef, BinDocumentHandle, BinObjectHeader } from "@/lib/tauri";
import {
  DocumentToolbar,
  type EditorDocumentProps,
  Seam,
  useNarrowToolbar,
} from "@/modules/editor";

import type { ContentDocumentOf } from "../documents/contentDocument";
/* The leaf rather than the preview barrel, which pulls the document that routes here. */
import { BinPreview } from "../preview/BinPreview";
/* The leaf rather than the references barrel, which pulls the document that routes here. */
import {
  classReferences,
  objectReferences,
  useFindReferences,
} from "../references/useFindReferences";
import { clickIntent, useCurveAimRequest, useSettleCurveAim } from "../state";
import { BinTree, type TreeReveal } from "./BinTree";
import { ClassCard } from "./ClassCard";
import { classLayout, type LayoutFrame, shellHoldsCurve } from "./classLayouts";
import { ClassView } from "./ClassView";
import { CurveSurface } from "./CurveSurface";
import { type CurveDock, CurveDockContext, type CurveTarget } from "./curveTarget";
import { OtherDeclarations } from "./OtherDeclarations";
import { ShellHeaderContext, ShellHeaderSlot, useShellHeaderSlots } from "./shellHeader";
import { useBinDocument } from "./useBinDocument";
import { useShowInFile } from "./useShowInFile";

/**
 * One declaration of an object as a document of its own (ADR-0028).
 *
 * The rows are the object's properties from depth zero, over the tree the file tab
 * holds for the same asset. The header is the object, and no row repeats it.
 */
export function ObjectDocument({
  document,
  active,
}: EditorDocumentProps<ContentDocumentOf<"object">>) {
  const { id, asset, objectHash, objectPath, file } = document;
  const { state, reopen } = useBinDocument(asset, objectHash);

  if (state.status === "failed") {
    return (
      <>
        <DocumentToolbar active={active}>{null}</DocumentToolbar>
        <BinPreview asset={asset} name={file} error={state.error} />
      </>
    );
  }

  if (state.status === "opening" || state.handle.object === null) {
    return (
      <div
        data-ui="ObjectDocument"
        className="flex min-h-0 flex-1 items-center justify-center bg-surface-950"
      >
        <Spinner />
      </div>
    );
  }

  return (
    <OpenObject
      documentId={id}
      asset={asset}
      objectPath={objectPath}
      file={file}
      handle={state.handle}
      object={state.handle.object}
      active={active}
      reopen={reopen}
    />
  );
}

interface OpenObjectProps {
  /** The editor's id for the tab, which a curve request names. */
  documentId: string;
  asset: AssetRef;
  objectPath: string;
  file: string;
  handle: BinDocumentHandle;
  object: BinObjectHeader;
  active: boolean;
  reopen: () => void;
}

function OpenObject({
  documentId,
  asset,
  objectPath,
  file,
  handle,
  object,
  active,
  reopen,
}: OpenObjectProps) {
  const showInFile = useShowInFile();
  const narrow = useNarrowToolbar();
  const objectName = useCallback(() => object.name, [object.name]);
  const layout = classLayout(object.classHash);

  const [mode, setMode] = useState<Mode>(layout ? "layout" : "properties");
  const [reveal, setReveal] = useState<TreeReveal | null>(null);
  const [frame, setFrame] = useState<LayoutFrame>("stack");
  const [target, setTarget] = useState<CurveTarget | null>(null);
  /* Apart from the target, so a follow that lets go of it leaves the dock open. */
  const [aimed, setAimed] = useState(false);
  const aim = useCallback((next: CurveTarget) => {
    setTarget(next);
    setAimed(true);
  }, []);
  const dock = useMemo<CurveDock>(
    () => ({ target, aim, clear: () => setTarget(null) }),
    [target, aim],
  );

  /* An answered request is settled, so a later open of the same object starts untargeted. */
  const request = useCurveAimRequest(documentId);
  const settleAim = useSettleCurveAim();
  useEffect(() => {
    if (request === null) return;
    settleAim(request.token);
    aim({ row: request.row, chain: request.chain });
  }, [request, settleAim, aim]);

  const showFile = useCallback(
    (event: ReactMouseEvent) => showInFile(asset, object.entry, file, clickIntent(event)),
    [asset, file, object.entry, showInFile],
  );

  const showInProperties = useCallback((key: string) => {
    setMode("properties");
    setReveal({ key, token: Date.now() });
  }, []);

  /* A shell with a curve pane holds the curve there (ADR-0031), so the dock is what every
     other frame and Properties get, and no tab draws the surface twice. */
  const paned = frame === "shell" && layout !== undefined && shellHoldsCurve(layout);
  const docked = aimed && (mode === "properties" || !paned);

  /* The crumb and the Panes menu share this row with the header, "The shell" in
     docs/ux/BIN_EDITOR.md. The slots stand only while a shell is what the tab draws. */
  const [slots, registerSlot] = useShellHeaderSlots();
  const shelled = frame === "shell" && mode === "layout";

  return (
    <div data-ui="ObjectDocument" className="flex min-h-0 flex-1 flex-col bg-surface-950">
      <DocumentToolbar active={active}>
        <span className="flex min-w-0 shrink-0 items-center gap-2 text-meta text-surface-400 select-none">
          <ClassCard classHash={object.classHash} name={object.class} />
          {!narrow && (
            <OtherDeclarations asset={asset} objectHash={object.entry} objectPath={objectPath} />
          )}
        </span>
        {shelled && (
          <ShellHeaderSlot name="crumb" onElement={registerSlot} className="min-w-0 flex-1" />
        )}
        {layout && (
          <SegmentedControl
            size="xs"
            aria-label={m.workshop_bin_view_mode_label()}
            value={mode}
            onChange={setMode}
            options={[
              { value: "layout", label: layout.title() },
              {
                value: "properties",
                label: m.workshop_bin_mode_properties_label(),
              },
            ]}
          />
        )}
        {!narrow && (
          <Button
            variant="ghost"
            size="xs"
            left={<FileIcon className="h-4 w-4" />}
            onClick={showFile}
          >
            {m.workshop_bin_show_in_file_action()}
          </Button>
        )}
        {shelled && <ShellHeaderSlot name="panes" onElement={registerSlot} />}
        <HeaderMenu object={object} onShowInFile={narrow ? showFile : undefined} />
      </DocumentToolbar>
      <ShellHeaderContext value={slots}>
        <CurveDockContext value={dock}>
          <Group id="object" orientation="vertical" className="flex min-h-0 flex-1 flex-col">
            <Panel id="view" minSize={160} className="flex min-h-0 w-full flex-col">
              {layout && mode === "layout" && (
                <ClassView
                  document={handle.document}
                  asset={asset}
                  roots={handle.rows}
                  classHash={object.classHash}
                  layout={layout}
                  objectName={objectName}
                  onNotOpen={reopen}
                  onShowInProperties={showInProperties}
                  onFrame={setFrame}
                />
              )}
              {mode === "properties" && (
                <BinTree
                  document={handle.document}
                  asset={asset}
                  roots={handle.rows}
                  rootOwner={object.classHash}
                  label={object.name}
                  reveal={reveal}
                  objectName={objectName}
                  onNotOpen={reopen}
                />
              )}
            </Panel>
            {docked && (
              <>
                <Seam orientation="vertical" variant="divider" />
                <Panel
                  id="curve"
                  defaultSize={220}
                  minSize={140}
                  maxSize="60%"
                  /* DS-GROUND: a band over the page, as every other pane of the tab is. */
                  className="flex min-h-0 w-full flex-col bg-surface-900 p-2"
                >
                  <CurveSurface document={handle.document} />
                </Panel>
              </>
            )}
          </Group>
        </CurveDockContext>
      </ShellHeaderContext>
    </div>
  );
}

/** Which way the tab draws its object: its class's layout, or the tree. */
type Mode = "layout" | "properties";

interface HeaderMenuProps {
  object: BinObjectHeader;
  /** Show in file, where the toolbar is too narrow to carry it as a button of its own. */
  onShowInFile?: (event: ReactMouseEvent) => void;
}

/** The header's actions, which no row underneath carries. `DS-MENU-SCOPE`, `DS-GLYPH-ROLE`. */
function HeaderMenu({ object, onShowInFile }: HeaderMenuProps) {
  const copy = useCopyToClipboard();
  const findReferences = useFindReferences();
  const label = m.workshop_bin_object_actions_label();
  const objectClass = object.class;

  return (
    <Menu.Root>
      <Menu.Trigger
        render={
          <IconButton
            variant="ghost"
            size="xs"
            compact
            icon={<DotsThreeVerticalIcon weight="bold" className="h-4 w-4" />}
            aria-label={label}
            className="h-5 w-5"
          />
        }
      />
      <Menu.Portal>
        <Menu.Positioner align="end" sideOffset={4}>
          <Menu.Popup className="w-56">
            {onShowInFile && (
              <>
                <Menu.Item icon={<FileIcon className="h-4 w-4" />} onClick={onShowInFile}>
                  {m.workshop_bin_show_in_file_action()}
                </Menu.Item>
                <Menu.Separator />
              </>
            )}
            <Menu.Item
              icon={<MagnifyingGlassIcon className="h-4 w-4" />}
              onClick={() => findReferences(objectReferences(object.entry, object.name))}
            >
              {m.workshop_references_find_object_action()}
            </Menu.Item>
            <Menu.Item
              icon={<MagnifyingGlassIcon className="h-4 w-4" />}
              onClick={() => findReferences(classReferences(object.classHash, object.class))}
            >
              {m.workshop_references_find_class_action()}
            </Menu.Item>
            <Menu.Separator />
            <Menu.Item
              icon={<PathIcon className="h-4 w-4" />}
              onClick={() => void copy(object.name, m.workshop_bin_path_label())}
            >
              {m.workshop_bin_copy_path_action()}
            </Menu.Item>
            <Menu.Item
              icon={<HashIcon className="h-4 w-4" />}
              onClick={() => void copy(object.entry, m.workshop_bin_hash_label())}
            >
              {m.workshop_bin_copy_hash_action()}
            </Menu.Item>
            {objectClass !== null && (
              <Menu.Item
                icon={<CopyIcon className="h-4 w-4" />}
                onClick={() => void copy(objectClass, m.workshop_bin_name_label())}
              >
                {m.workshop_bin_copy_class_name_action()}
              </Menu.Item>
            )}
            <Menu.Item
              icon={<HashIcon className="h-4 w-4" />}
              onClick={() => void copy(object.classHash, m.workshop_bin_hash_label())}
            >
              {m.workshop_bin_copy_class_hash_action()}
            </Menu.Item>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}
