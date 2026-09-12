import { XIcon } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";

import { IconButton, Tabs, Tooltip } from "@/components";
import { m } from "@/i18n";
import type { InstalledMod } from "@/lib/tauri";
import { type DocumentsTab, useLibrarySidebarStore } from "@/modules/library/state";

import { DetailsTab } from "./DetailsTab";
import { LicensesTab } from "./LicensesTab";
import { ReadmeTab } from "./ReadmeTab";

/**
 * The window width below which the panel floats over the grid.
 *
 * The panel at the width it asks for beside the grid's own 320px floor. Under
 * that one of the two is at its minimum, and a grid squeezed to a single column
 * has stopped being a grid. Decided here rather than by a container query,
 * following the readme's own fold.
 */
const OVERLAY_BELOW = 760;

interface DocumentsSidebarProps {
  /** Every installed mod, which the licenses tab lists and the readme tab names. */
  mods: InstalledMod[];
}

/**
 * What one mod is, its readme, and the library's licenses, in a panel the
 * reader opened.
 *
 * Draws on the page ground with a hairline, the way the toolbar and the session
 * bar already do, which is what lets a rendered document sit on the ground with
 * no inset frame of its own. The strip therefore has no rung to mark itself
 * with and leans on that hairline and on type.
 */
export function DocumentsSidebar({ mods }: DocumentsSidebarProps) {
  const tab = useLibrarySidebarStore((s) => s.tab);
  const showTab = useLibrarySidebarStore((s) => s.showTab);
  const close = useLibrarySidebarStore((s) => s.close);
  const modId = useLibrarySidebarStore((s) => s.modId);

  const openMod = mods.find((mod) => mod.id === modId) ?? null;
  const missing = modId !== null && openMod === null;
  const panel = useRef<HTMLDivElement>(null);

  /* Focus lands on the panel rather than on its chrome, so the reader's first
     tab stop is what they opened it for. */
  useEffect(() => {
    panel.current?.focus();
  }, []);

  return (
    <div
      ref={panel}
      tabIndex={-1}
      data-ui="DocumentsSidebar"
      aria-label={m.library_documents_title()}
      className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden rounded-xl border border-surface-700 bg-surface-950 outline-none"
    >
      <Tabs.Root
        value={tab}
        onValueChange={(value) => showTab(value as DocumentsTab)}
        className="min-h-0 flex-1"
      >
        <div className="flex shrink-0 items-center border-b border-surface-700 select-none">
          <Tabs.List variant="plain" className="min-w-0 flex-1 overflow-x-auto scrollbar-sm">
            <Tabs.Tab value="details">{m.library_documents_details_tab()}</Tabs.Tab>
            <Tabs.Tab value="readme">{m.library_documents_readme_tab()}</Tabs.Tab>
            <Tabs.Tab value="licenses">{m.library_documents_licenses_tab()}</Tabs.Tab>
          </Tabs.List>
          <Tooltip content={m.library_documents_close_action()}>
            <IconButton
              variant="ghost"
              size="sm"
              aria-label={m.library_documents_close_action()}
              icon={<XIcon weight="bold" className="h-4 w-4" />}
              onClick={close}
              className="mr-1 shrink-0"
            />
          </Tooltip>
        </div>

        <Header tab={tab} mod={openMod} />

        <Tabs.Panel value="details" className="mt-0 flex min-h-0 flex-1 flex-col">
          <DetailsTab mod={openMod} missing={missing} />
        </Tabs.Panel>
        <Tabs.Panel value="readme" className="mt-0 flex min-h-0 flex-1 flex-col">
          <ReadmeTab mod={openMod} missing={missing} />
        </Tabs.Panel>
        <Tabs.Panel value="licenses" className="mt-0 flex min-h-0 flex-1 flex-col">
          <LicensesTab mods={mods} />
        </Tabs.Panel>
      </Tabs.Root>
    </div>
  );
}

/**
 * What the panel is holding, for a reader who left it open and came back.
 *
 * The name sits here rather than on the tab, so the strip does not shift under
 * the pointer as one mod's name gives way to another's, and a long one has
 * somewhere to go.
 */
function Header({ tab, mod }: { tab: DocumentsTab; mod: InstalledMod | null }) {
  return (
    <div className="flex shrink-0 items-center border-b border-surface-700 px-3 py-2 select-none">
      <p className="min-w-0 flex-1 truncate text-row font-medium text-surface-200 select-text">
        {headerTitle(tab, mod)}
      </p>
    </div>
  );
}

function headerTitle(tab: DocumentsTab, mod: InstalledMod | null): string {
  if (tab === "licenses") return m.library_documents_library_wide_label();
  if (mod) return mod.displayName;
  return m.library_documents_no_mod_title();
}

/** Whether the window is too narrow to hold the panel beside the grid. */
export function useOverlaidSidebar(): boolean {
  const [narrow, setNarrow] = useState(isNarrow);

  useEffect(() => {
    const query = window.matchMedia(NARROW_QUERY);
    const answer = (event: MediaQueryListEvent) => setNarrow(event.matches);
    query.addEventListener("change", answer);
    return () => query.removeEventListener("change", answer);
  }, []);

  return narrow;
}

const NARROW_QUERY = `(max-width: ${OVERLAY_BELOW - 1}px)`;

function isNarrow(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia(NARROW_QUERY).matches;
}
