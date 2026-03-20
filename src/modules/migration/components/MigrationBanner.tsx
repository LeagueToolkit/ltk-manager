import { ArrowRight } from "lucide-react";

import { AlertBox, Button } from "@/components";

interface MigrationBannerProps {
  onImport: () => void;
  onDismiss: () => void;
}

export function MigrationBanner({ onImport, onDismiss }: MigrationBannerProps) {
  return (
    <AlertBox
      variant="info"
      title="Migrating from cslol-manager?"
      onDismiss={onDismiss}
      actions={
        <Button variant="outline" size="sm" onClick={onImport}>
          <span className="flex items-center gap-1.5">
            Import Mods
            <ArrowRight className="h-3.5 w-3.5" />
          </span>
        </Button>
      }
      className="rounded-none border-x-0 border-t-0 border-b border-b-surface-600"
    >
      Import your existing mods to get started quickly.
    </AlertBox>
  );
}
