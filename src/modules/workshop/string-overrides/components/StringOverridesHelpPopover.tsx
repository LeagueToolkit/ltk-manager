import { HelpCircle } from "lucide-react";

import { ExternalLink, Popover } from "@/components";

export function StringOverridesHelpPopover() {
  return (
    <Popover.Root>
      <Popover.Trigger className="inline-flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm text-surface-400 transition-colors hover:bg-surface-700 hover:text-surface-200">
        <HelpCircle className="h-4 w-4" />
        How it works
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner side="bottom" align="end" sideOffset={8} className="z-50">
          <Popover.Popup className="w-96 space-y-2 rounded-xl border border-surface-600 bg-surface-800 p-4 text-sm text-surface-300 shadow-xl">
            <p className="font-medium text-surface-100">How overrides are applied</p>
            <p>
              Overrides are patched into the game&rsquo;s stringtable while the overlay is built, so
              they survive game patches without repacking. Entries under{" "}
              <span className="font-medium text-surface-200">Default (All Locales)</span> apply
              everywhere; a locale-specific entry for the same field wins in that locale.
            </p>
            <p>
              By default only the player&rsquo;s current game language is patched - the &ldquo;all
              locales&rdquo; toggle in{" "}
              <span className="font-medium text-surface-200">Settings &rarr; Patching</span> extends
              this to every installed language.
            </p>
            <p>
              Field names are matched case-insensitively. To target an entry whose name is unknown,
              use its full 64-bit hash as the field name: exactly 16 hex digits, padded with leading
              zeros, e.g.{" "}
              <code className="rounded bg-surface-700 px-1 py-0.5 text-xs">f772a83b33773223</code>.
            </p>
            <p>
              <ExternalLink href="https://wiki.leaguetoolkit.dev/guides/mod-creation/string-overrides/">
                Read the full guide on the LTK Wiki
              </ExternalLink>
            </p>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
