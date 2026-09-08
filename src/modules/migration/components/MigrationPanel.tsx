import { useState } from "react";

import { MigrationSection } from "./MigrationSection";
import { MigrationWizardDialog } from "./MigrationWizardDialog";

/** The cslol import, section and wizard together, for a settings tab to place. */
export function MigrationPanel() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <MigrationSection onImport={() => setOpen(true)} />
      <MigrationWizardDialog open={open} onClose={() => setOpen(false)} />
    </>
  );
}
