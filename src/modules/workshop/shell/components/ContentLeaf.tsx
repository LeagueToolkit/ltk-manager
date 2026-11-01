import { Button, EmptyState } from "@/components";
import { m } from "@/i18n";
import { EditorSurface, LeafDropZones, type LeafNode, TabGlyph, TabRail } from "@/modules/editor";
import { useLayerPanelOpen, useSetLayerPanelOpen } from "@/stores";

import {
  documentDefinition,
  gameDocument,
  objectsDocument,
  useContentEditors,
} from "../../documents";
import { useRevealRowSearch } from "../../palette";
import { useProjectContext } from "../../projects/state/ProjectContext";
import {
  useActivateDocument,
  useActiveLeafId,
  useCloseDocument,
  useDirtyDocumentIds,
  useFocusLeaf,
  useLeafTabs,
  useMaximizedLeafId,
  useOpenDocument,
  usePinnedDocumentIds,
  usePreviewDocumentId,
  useReopenClosedDocument,
  usePromoteDocument,
  useSetDocumentPinned,
  useSetLeafLocked,
  useSplitWithDocument,
  useToggleMaximizedLeaf,
} from "../../state";
import { useSharedTabTitles } from "../hooks/useSharedTabTitles";
import { LeafProvider } from "../state/LeafContext";

interface ContentLeafProps {
  leaf: LeafNode;
}

/**
 * An editor group's frame. A shown document of islands draws its own edges, and the frame
 * then draws none.
 */
const FRAME = "rounded-lg border border-surface-700 data-[islands-shown]:border-transparent";

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
  const previewId = usePreviewDocumentId(leaf.id);
  const promoteDocument = usePromoteDocument();
  const pinnedIds = usePinnedDocumentIds();
  const setDocumentPinned = useSetDocumentPinned();
  const setLeafLocked = useSetLeafLocked();
  const maximizedLeafId = useMaximizedLeafId();
  const toggleMaximized = useToggleMaximizedLeaf();
  const revealRowSearch = useRevealRowSearch(leaf.activeTab);
  const reopenClosed = useReopenClosedDocument();
  const sharedTitles = useSharedTabTitles();

  return (
    <LeafProvider leafId={leaf.id}>
      <LeafDropZones leafId={leaf.id} tabs={leaf.tabs} maximized={maximizedLeafId === leaf.id}>
        <EditorSurface
          leafId={leaf.id}
          documents={documents}
          activeId={leaf.activeTab}
          registry={editors}
          dirtyIds={dirtyIds}
          pinnedIds={pinnedIds}
          previewId={previewId}
          sharedTitles={sharedTitles}
          onActivate={(id) => activateDocument(leaf.id, id)}
          onPromote={promoteDocument}
          onTogglePin={setDocumentPinned}
          onMaximize={() => toggleMaximized(leaf.id)}
          onClose={(id) => closeDocument(leaf.id, id)}
          onSplit={(id, edge) => splitWithDocument(id, leaf.id, edge)}
          locked={leaf.locked === true}
          onToggleLock={(locked) => setLeafLocked(leaf.id, locked)}
          onFocus={() => focusLeaf(leaf.id)}
          onFindElsewhere={revealRowSearch}
          onReopenClosed={reopenClosed}
          focused={activeLeafId === leaf.id}
          empty={<NothingOpenState />}
          className={FRAME}
        />
      </LeafDropZones>
    </LeafProvider>
  );
}

/** One editor group collapsed in a row: its documents as a rail of their glyphs. */
export function ContentLeafRail({ leaf }: ContentLeafProps) {
  const documents = useLeafTabs(leaf.id);
  const editors = useContentEditors();
  const activateDocument = useActivateDocument();

  const tabs = documents.flatMap((document) => {
    const definition = documentDefinition(editors, document);
    if (!definition) return [];

    return [
      {
        id: document.id,
        title: definition.label(document).title,
        icon: <TabGlyph>{definition.icon(document)}</TabGlyph>,
      },
    ];
  });

  return (
    <TabRail
      tabs={tabs}
      activeId={leaf.activeTab}
      onActivate={(id) => activateDocument(leaf.id, id)}
    />
  );
}

function NothingOpenState() {
  const project = useProjectContext();
  const sidebarOpen = useLayerPanelOpen();
  const setLayerPanelOpen = useSetLayerPanelOpen();
  const openDocument = useOpenDocument();

  const action = (
    <>
      <Button variant="outline" onClick={() => openDocument(gameDocument())}>
        Browse game index
      </Button>
      <Button variant="outline" onClick={() => openDocument(objectsDocument())}>
        {m.workshop_objects_browse_action()}
      </Button>
      {!sidebarOpen && (
        <Button variant="outline" onClick={() => setLayerPanelOpen(true)}>
          Show sidebar
        </Button>
      )}
    </>
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
