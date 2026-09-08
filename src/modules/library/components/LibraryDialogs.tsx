import { BulkUninstallDialog } from "./BulkUninstallDialog";

/**
 * Every library dialog a store raises, mounted once for the whole module.
 *
 * A store dialog nobody mounted opens to nothing and reports no error, so
 * mount-completeness is one import rather than a list each page maintains.
 */
export function LibraryDialogs() {
  return (
    <>
      <BulkUninstallDialog />
    </>
  );
}
