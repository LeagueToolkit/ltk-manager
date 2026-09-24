import type { ReactNode } from "react";

import type { AssetRef, BinDocumentId, BinRow } from "@/lib/tauri";

import { DeclaredRowsContext, useDeclaredRows } from "../../documents/hooks/useDeclared";
import {
  LinkAssetContext,
  LinkOpenContext,
  LinkTargetsContext,
  ObjectNameContext,
  type RowGroup,
  useCheckLinkTargets,
  useWarmLinkOpen,
} from "../../links/hooks/useLinkTargets";
import { useValueMarks, ValueMarksContext } from "../../values/hooks/useValueMarks";
import { BinEditContext, type TreeFocus, useBinEditor } from "../hooks/useBinEdit";
import { LeafEditContext } from "../hooks/useLeafEdit";
import { RowDocumentContext } from "../state/rowFold";

interface TreeContextsProps {
  /** The open's id, which every read carries. */
  document: BinDocumentId;
  /** What the document was read from, which the layer side of a `file` link looks in. */
  asset: AssetRef;
  /** Every row the tree holds, checked for links one group at a time. */
  groups: RowGroup[];
  /** The viewport's own rows, which is the page a value row's read is scoped to. */
  inView: readonly BinRow[];
  /** The name of the object an entry hash addresses, which a row's chips read under. */
  objectName: (entry: string) => string;
  /** The leaves take edits. */
  editable: boolean;
  /** Where the tree sends focus after an edit. */
  focus: TreeFocus;
  children: ReactNode;
}

/** What a row reads around itself: the asset it came from, its object, its links, its values and its edits. */
export function TreeContexts({
  document,
  asset,
  groups,
  inView,
  objectName,
  editable,
  focus,
  children,
}: TreeContextsProps) {
  const linkTargets = useCheckLinkTargets(document, groups);
  const linkOpen = useWarmLinkOpen(linkTargets);
  const marks = useValueMarks(document, inView);
  const edit = useBinEditor(document, asset, editable, focus);
  const declared = useDeclaredRows(document, editable);

  return (
    <LinkAssetContext value={asset}>
      <ObjectNameContext value={objectName}>
        <LinkTargetsContext value={linkTargets}>
          <LinkOpenContext value={linkOpen}>
            <ValueMarksContext value={marks}>
              <DeclaredRowsContext value={declared}>
                <RowDocumentContext value={document}>
                  <LeafEditContext value={null}>
                    <BinEditContext value={edit}>{children}</BinEditContext>
                  </LeafEditContext>
                </RowDocumentContext>
              </DeclaredRowsContext>
            </ValueMarksContext>
          </LinkOpenContext>
        </LinkTargetsContext>
      </ObjectNameContext>
    </LinkAssetContext>
  );
}
