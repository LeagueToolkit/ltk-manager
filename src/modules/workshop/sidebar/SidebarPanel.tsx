import { useState } from "react";

import { DocumentToolbarSlotContext } from "@/modules/editor";
import { useSidebarView } from "@/stores";

import { ContentSidebar, type ContentSidebarProps } from "../components/ContentSidebar";
import { objectsDocument, problemsDocument } from "../documents";
import { ObjectsDocument } from "../objectsBrowser";
import { ProblemsDocument } from "../problems";
import { GameIndexView } from "./GameIndexView";
import { GameSearchView } from "./GameSearchView";
import { railViews } from "./railViews";
import { SidebarViewMenu } from "./SidebarViewMenu";
import { SourceControlView } from "./SourceControlView";

/**
 * The primary side panel, filled by whatever view the rail has selected.
 *
 * The panel gives a view the toolbar slot an editor surface gives a document, so
 * a view that hosts a document draws that document's own chrome in the header
 * here rather than losing it.
 */
export function SidebarPanel(props: ContentSidebarProps) {
  const view = useSidebarView();
  const [toolbar, setToolbar] = useState<HTMLElement | null>(null);
  const title = railViews().find((entry) => entry.id === view)?.title ?? "";

  return (
    <aside
      data-ui="SidebarPanel"
      /* DS-GROUND: an island inside the fold sits a rung below it. */
      className="flex h-full w-full flex-col overflow-hidden rounded-xl border border-surface-700 bg-surface-950 select-none"
    >
      <div
        data-ui="SidebarPanel:title"
        className="flex h-9 shrink-0 items-center gap-1.5 border-b border-surface-700/50 pr-1.5 pl-3"
      >
        <span className="min-w-0 flex-1 truncate text-[0.6875rem] font-medium tracking-wide text-surface-300 uppercase">
          {title}
        </span>
        <SidebarViewMenu />
      </div>

      {/* `empty:hidden` rather than a conditional, because what fills this row
          arrives through a portal and so cannot be read from here. */}
      <div
        ref={setToolbar}
        data-ui="SidebarPanel:toolbar"
        className="flex shrink-0 flex-wrap items-center gap-2 border-b border-surface-700/50 px-2 py-1.5 empty:hidden"
      />

      <DocumentToolbarSlotContext value={toolbar}>
        <div data-ui="SidebarPanel:body" className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <SidebarBody {...props} />
        </div>
      </DocumentToolbarSlotContext>
    </aside>
  );
}

function SidebarBody(props: ContentSidebarProps) {
  const view = useSidebarView();

  if (view === "search") return <GameSearchView />;
  if (view === "problems") {
    return <ProblemsDocument document={problemsDocument()} active />;
  }
  if (view === "objects") return <ObjectsDocument document={objectsDocument()} active />;
  if (view === "game") return <GameIndexView />;
  if (view === "source") return <SourceControlView />;
  return <ContentSidebar {...props} />;
}
