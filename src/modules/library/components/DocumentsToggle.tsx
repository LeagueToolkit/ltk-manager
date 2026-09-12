import { BookOpenTextIcon } from "@phosphor-icons/react";

import { IconButton, Tooltip } from "@/components";
import { m } from "@/i18n";
import { useLibrarySidebarStore } from "@/modules/library/state";

/**
 * Show the documents panel, or hide it.
 *
 * Every tab is about one mod, so this reopens on the mod and the tab the panel
 * was left on rather than landing anywhere of its own.
 */
export function DocumentsToggle() {
  const open = useLibrarySidebarStore((s) => s.open);
  const toggle = useLibrarySidebarStore((s) => s.toggle);

  return (
    <Tooltip content={m.library_documents_toggle_action()}>
      <IconButton
        variant="ghost"
        size="sm"
        aria-label={m.library_documents_toggle_action()}
        aria-pressed={open}
        icon={<BookOpenTextIcon weight="bold" className="h-4 w-4" />}
        onClick={toggle}
        className={open ? "text-accent-400" : undefined}
      />
    </Tooltip>
  );
}
