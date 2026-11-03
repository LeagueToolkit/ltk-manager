import { DownloadSimpleIcon } from "@phosphor-icons/react";
import { useState } from "react";

import {
  Button,
  ChromeGround,
  Inline,
  Kbd,
  PageInset,
  ReadingColumn,
  Toolbar,
  ToolbarRow,
  Tooltip,
} from "@/components";
import { usePlatformSupport } from "@/hooks";
import { m } from "@/i18n";
import {
  LastGameTile,
  LibraryTile,
  NewsTile,
  NoticeBanners,
  StatusLine,
  useMarkHomeSeen,
  WhatsNew,
} from "@/modules/home";
import { shortcutOf } from "@/modules/keys";
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
 * Framed as the library page is: its toolbar with Import and Play at the trailing edge, then an
 * inset region holding the cards. The drop, the import dialog and the migration wizard are the
 * library page's, mounted here again over this page's own actions. The two pages never mount
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
    <div data-ui="Home" className="relative flex h-full flex-col">
      <ChromeGround />
      <DragDropOverlay visible={isDragOver} />

      <div className="flex flex-col gap-2 px-4 pt-3 empty:hidden">
        {!patcherAvailable && <PatcherUnsupported />}
        <NoticeBanners />
        <StatusLine />
      </div>

      <Toolbar>
        <ToolbarRow className="justify-end">
          <Inline gap={5}>
            <Tooltip
              content={
                <>
                  {m.home_library_add_hint()} <Kbd shortcut={shortcutOf("library.import")} />
                </>
              }
            >
              <Button
                variant="tonal"
                onClick={actions.handleImportMods}
                loading={installing}
                aria-label={m.home_library_add_hint()}
                left={<DownloadSimpleIcon weight="bold" className="size-4" />}
              >
                {m.home_library_add_action()}
              </Button>
            </Tooltip>

            <PlayButton disabled={installing} />
          </Inline>
        </ToolbarRow>
      </Toolbar>

      <PageInset>
        <div data-ui="Home:content" className="flex-1 overflow-auto">
          <ReadingColumn width="wide">
            <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
              <WhatsNew />

              <div className="order-first flex min-w-0 flex-col gap-4 lg:order-none">
                <LibraryTile onImportFromCslol={() => setMigrationOpen(true)} />
                <LastGameTile />
                <NewsTile />
              </div>
            </div>
          </ReadingColumn>
        </div>
      </PageInset>

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
