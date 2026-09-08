import type { ReactNode } from "react";

import type { AssetRef, BinDocumentId, BinRow } from "@/lib/tauri";

import {
  LinkAssetContext,
  LinkOpenContext,
  LinkTargetsContext,
  type RowGroup,
  useCheckLinkTargets,
  useWarmLinkOpen,
} from "./useLinkTargets";
import { useValueMarks, ValueMarksContext } from "./useValueMarks";

interface TreeContextsProps {
  /** The open's id, which every read carries. */
  document: BinDocumentId;
  /** What the document was read from, which the layer side of a `file` link looks in. */
  asset: AssetRef;
  /** Every row the tree holds, checked for links one group at a time. */
  groups: RowGroup[];
  /** The viewport's own rows, which is the page a value row's read is scoped to. */
  inView: readonly BinRow[];
  children: ReactNode;
}

/** What a row reads around itself: the asset it came from, its links and its values. */
export function TreeContexts({ document, asset, groups, inView, children }: TreeContextsProps) {
  const linkTargets = useCheckLinkTargets(document, groups);
  const linkOpen = useWarmLinkOpen(linkTargets);
  const marks = useValueMarks(document, inView);

  return (
    <LinkAssetContext value={asset}>
      <LinkTargetsContext value={linkTargets}>
        <LinkOpenContext value={linkOpen}>
          <ValueMarksContext value={marks}>{children}</ValueMarksContext>
        </LinkOpenContext>
      </LinkTargetsContext>
    </LinkAssetContext>
  );
}
