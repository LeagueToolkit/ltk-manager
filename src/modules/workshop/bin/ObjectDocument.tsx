import {
  CopyIcon,
  DotsThreeVerticalIcon,
  FileIcon,
  HashIcon,
  MagnifyingGlassIcon,
  PathIcon,
} from "@phosphor-icons/react";
import { useCallback } from "react";

import { Button, IconButton, Menu, Spinner } from "@/components";
import { useCopyToClipboard } from "@/hooks";
import { m } from "@/i18n";
import type { AssetRef, BinDocumentHandle, BinObjectHeader } from "@/lib/tauri";
import { DocumentToolbar, type EditorDocumentProps } from "@/modules/editor";

import type { ContentDocumentOf } from "../documents/contentDocument";
/* The leaf rather than the preview barrel, which pulls the document that routes here. */
import { BinPreview } from "../preview/BinPreview";
/* The leaf rather than the references barrel, which pulls the document that routes here. */
import {
  classReferences,
  objectReferences,
  useFindReferences,
} from "../references/useFindReferences";
import { clickIntent } from "../state";
import { Dot } from "./BinDocument";
import { BinTree } from "./BinTree";
import { ClassCard } from "./ClassCard";
import { OtherDeclarations } from "./OtherDeclarations";
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
  const { asset, objectHash, objectPath, file } = document;
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
  asset: AssetRef;
  objectPath: string;
  file: string;
  handle: BinDocumentHandle;
  object: BinObjectHeader;
  active: boolean;
  reopen: () => void;
}

function OpenObject({ asset, objectPath, file, handle, object, active, reopen }: OpenObjectProps) {
  const showInFile = useShowInFile();
  const objectName = useCallback(() => object.name, [object.name]);

  return (
    <div data-ui="ObjectDocument" className="flex min-h-0 flex-1 flex-col bg-surface-950">
      <DocumentToolbar active={active}>
        <span className="flex min-w-0 items-center gap-2 text-meta text-surface-400 select-none">
          <ClassCard classHash={object.classHash} name={object.class} />
          <Dot />
          <span>{m.workshop_bin_properties_label({ count: object.properties })}</span>
          <Dot />
          <OtherDeclarations asset={asset} objectHash={object.entry} objectPath={objectPath} />
        </span>
        <Button
          variant="ghost"
          size="xs"
          left={<FileIcon className="h-4 w-4" />}
          onClick={(event) => showInFile(asset, object.entry, file, clickIntent(event))}
        >
          {m.workshop_bin_show_in_file_action()}
        </Button>
        <HeaderMenu object={object} />
      </DocumentToolbar>
      <BinTree
        document={handle.document}
        asset={asset}
        roots={handle.rows}
        rootOwner={object.classHash}
        label={object.name}
        objectName={objectName}
        onNotOpen={reopen}
      />
    </div>
  );
}

/** The header's actions, which no row underneath carries. `DS-MENU-SCOPE`, `DS-GLYPH-ROLE`. */
function HeaderMenu({ object }: { object: BinObjectHeader }) {
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
