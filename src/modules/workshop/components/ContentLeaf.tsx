import { Button, EmptyState } from "@/components";
import { EditorSurface, LeafDropZones, type LeafNode } from "@/modules/editor";
import { useLayerPanelOpen, useSetLayerPanelOpen } from "@/stores";

import { useContentEditors } from "../documents";
import {
  useActivateDocument,
  useActiveLeafId,
  useCloseDocument,
  useDirtyDocumentIds,
  useFocusLeaf,
  useLeafTabs,
  useSplitWithDocument,
} from "../state";
import { ContentLayoutPopover } from "./ContentLayoutPopover";
import { LeafProvider } from "./LeafContext";
import { useProjectContext } from "./ProjectContext";

/* Built once. The strip memoizes its tabs, and a fresh element here on every
   render would hand it a changed prop and undo that. */
const LAYOUT_ACTIONS = <ContentLayoutPopover />;

interface ContentLeafProps {
  leaf: LeafNode;
}

/** One editor group of the split tree, bound to the content documents it holds. */
export function ContentLeaf({ leaf }: ContentLeafProps) {
  const documents = useLeafTabs(leaf.id);
  const dirtyIds = useDirtyDocumentIds();
  const editors = useContentEditors();
  const activateDocument = useActivateDocument();
  const closeDocument = useCloseDocument();
  const splitWithDocument = useSplitWithDocument();
  const focusLeaf = useFocusLeaf();
  const activeLeafId = useActiveLeafId();

  return (
    <LeafProvider leafId={leaf.id}>
      <LeafDropZones leafId={leaf.id} tabs={leaf.tabs}>
        <EditorSurface
          leafId={leaf.id}
          documents={documents}
          activeId={leaf.activeTab}
          registry={editors}
          dirtyIds={dirtyIds}
          onActivate={(id) => activateDocument(leaf.id, id)}
          onClose={(id) => closeDocument(leaf.id, id)}
          onSplit={(id, edge) => splitWithDocument(id, leaf.id, edge)}
          onFocus={() => focusLeaf(leaf.id)}
          focused={activeLeafId === leaf.id}
          actions={LAYOUT_ACTIONS}
          empty={<NothingOpenState />}
        />
      </LeafDropZones>
    </LeafProvider>
  );
}

/* Only the root leaf can be empty, since a leaf losing its last tab prunes. */
function NothingOpenState() {
  const project = useProjectContext();
  const sidebarOpen = useLayerPanelOpen();
  const setLayerPanelOpen = useSetLayerPanelOpen();

  const action = !sidebarOpen && (
    <Button variant="outline" size="sm" onClick={() => setLayerPanelOpen(true)}>
      Show sidebar
    </Button>
  );

  if (project.layers.length === 0) {
    return (
      <EmptyState
        size="sm"
        className="h-full"
        title="No layers yet"
        description="Add a layer from the sidebar"
        action={action}
      />
    );
  }

  return (
    <EmptyState
      size="sm"
      className="h-full"
      title="Nothing open"
      description="Pick a layer or a locale from the sidebar"
      action={action}
    />
  );
}
