import { BookOpenTextIcon } from "@phosphor-icons/react";

import { IconButton, Tooltip } from "@/components";
import { m } from "@/i18n";
import { useLibrarySidebarStore } from "@/modules/library/state";

/**
 * The library-wide way into the documents panel.
 *
 * Lands on Licenses, which needs no mod and is already full, where the card
 * menu's own item lands on that mod's readme. The tab a panel opens on follows
 * the intent of what opened it.
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
