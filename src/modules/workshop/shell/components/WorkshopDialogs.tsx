import { AddFoldersDialog } from "../../folders/components/AddFoldersDialog";
import { ConvertFolderDialog } from "../../folders/components/ConvertFolderDialog";
import { ImportFantomeDialog } from "../../imports/components/ImportFantomeDialog";
import { ImportGitRepoDialog } from "../../imports/components/ImportGitRepoDialog";
import { BulkPackDialog } from "../../packing/components/BulkPackDialog";
import { PackDialog } from "../../packing/components/PackDialog";
import { BulkDeleteDialog } from "../../projects/components/BulkDeleteDialog";
import { DeleteConfirmDialog } from "../../projects/components/DeleteConfirmDialog";
import { NewProjectDialog } from "../../projects/components/NewProjectDialog";
import { RenameProjectDialog } from "../../projects/components/RenameProjectDialog";

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
      <ConvertFolderDialog />
      <AddFoldersDialog />
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
