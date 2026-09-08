import { BulkDeleteDialog } from "./BulkDeleteDialog";
import { BulkPackDialog } from "./BulkPackDialog";
import { DeleteConfirmDialog } from "./DeleteConfirmDialog";
import { ImportFantomeDialog } from "./ImportFantomeDialog";
import { ImportGitRepoDialog } from "./ImportGitRepoDialog";
import { NewProjectDialog } from "./NewProjectDialog";
import { PackDialog } from "./PackDialog";
import { RenameProjectDialog } from "./RenameProjectDialog";

/**
 * Every workshop dialog a store raises, mounted once for the whole module.
 *
 * A store dialog nobody mounted opens to nothing and reports no error, so
 * mount-completeness is one import rather than a list each route maintains.
 * This belongs at the layout route both project routes sit under. A dialog
 * scoped to one project mounts on that route instead.
 */
export function WorkshopDialogs() {
  return (
    <>
      <NewProjectDialog />
      <ImportFantomeDialog />
      <ImportGitRepoDialog />
      <PackDialog />
      <BulkPackDialog />
      <DeleteConfirmDialog />
      <RenameProjectDialog />
      <BulkDeleteDialog />
    </>
  );
}
