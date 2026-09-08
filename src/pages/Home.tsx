import { useState } from "react";

import { usePlatformSupport } from "@/hooks";
import {
  LastGameTile,
  LibraryTile,
  NewsTile,
  NoticeBanners,
  RecentChanges,
  StatusLine,
  useMarkHomeSeen,
} from "@/modules/home";
import { PlayButton } from "@/modules/launcher";
import {
  DragDropOverlay,
  ImportProgressDialog,
  useLibraryActions,
  useLibraryHotkeys,
  useModFileDrop,
} from "@/modules/library";
import { MigrationWizardDialog } from "@/modules/migration";
import { PatcherUnsupported } from "@/modules/patcher";

/**
 * The page the manager opens on, per docs/ux/HOME.md.
 *
 * The drop, the import dialog and the migration wizard are the library page's,
 * mounted here again over this page's own actions. The two pages never mount
 * together, so a drop lands with whichever is up.
 */
export function Home() {
  const [migrationOpen, setMigrationOpen] = useState(false);

  const { data: platform } = usePlatformSupport();
  const patcherAvailable = platform?.patcherAvailable ?? true;

  const actions = useLibraryActions();
  const isDragOver = useModFileDrop(actions.handleBulkInstallFiles);
  useLibraryHotkeys(actions.handleImportMods);
  useMarkHomeSeen();

  const installing = actions.installMod.isPending || actions.bulkInstallMods.isPending;

  return (
    <div data-ui="Home" className="relative h-full">
      <DragDropOverlay visible={isDragOver} />

      {/* Capped and centred: a wider window buys margins, not one wider card. */}
      <div className="mx-auto flex h-full max-w-6xl flex-col gap-4 px-4 pt-4">
        {!patcherAvailable && <PatcherUnsupported />}
        <NoticeBanners />

        <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_20rem] gap-4">
          <RecentChanges />
          <div data-ui="Home:rail" className="flex min-h-0 flex-col gap-4">
            {/* Outside the scroller: the primary action stays put while the tiles move. */}
            <PlayButton block disabled={installing} />
            <StatusLine />
            <div data-ui="Home:tiles" className="flex min-h-0 flex-col gap-4 overflow-y-auto">
              <LibraryTile
                onAddMod={actions.handleImportMods}
                onImportFromCslol={() => setMigrationOpen(true)}
              />
              <LastGameTile />
              <NewsTile />
            </div>
          </div>
        </div>
      </div>

      <ImportProgressDialog
        open={actions.importDialogOpen}
        onClose={actions.handleCloseImportDialog}
        progress={actions.installProgress}
        result={actions.importResult}
      />
      <MigrationWizardDialog open={migrationOpen} onClose={() => setMigrationOpen(false)} />
    </div>
  );
}
