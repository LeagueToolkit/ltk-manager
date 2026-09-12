import { GitBranchIcon } from "@phosphor-icons/react";

import { EmptyState } from "@/components";
import { m } from "@/i18n";

/* per "Project row" in docs/ux/PROJECT_EDITOR.md */
export function SourceControlView() {
  return (
    <EmptyState
      size="sm"
      icon={<GitBranchIcon className="h-8 w-8" />}
      title={m.workshop_sidebar_source_title()}
      description={m.workshop_sidebar_source_empty()}
    />
  );
}
