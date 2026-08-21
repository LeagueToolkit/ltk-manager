import { ArrowSquareOutIcon, CopyIcon } from "@phosphor-icons/react";
import type { ReactNode } from "react";

import { Button, EmptyState, ExternalLink, Tooltip } from "@/components";
import { useCopyToClipboard } from "@/hooks";
import type { AssetRef, WorkshopFileKind } from "@/lib/tauri";

import { describeFileKind } from "../utils/fileKindIcon";
import { useOpenInRitobin, useRitobinIntegration } from "./useRitobin";

/** The extension on the VS Code marketplace. */
const EXTENSION_URL = "https://marketplace.visualstudio.com/items?itemName=alanpq.ritobin-lsp-vs";

/** The install command as VS Code's palette lists it, category and all. */
const PALETTE_COMMAND = "ritobin-lsp: Install Windows Explorer Integration";

/** Whether a file kind is one the ritobin editor reads. */
export function isPropertyBin(kind: WorkshopFileKind): boolean {
  return kind === "property_bin" || kind === "property_bin_override";
}

interface BinPreviewProps {
  asset: AssetRef;
  /** The file name, which the document resolved. A reference may hold a hash. */
  name: string;
}

/**
 * A property bin, and the way out to something that reads one.
 *
 * Nothing here draws a bin. VS Code does, through the ritobin-lsp extension,
 * which turns one into text on the way in, so this pane offers the handoff and
 * says what installs it when the handoff is not there.
 */
export function BinPreview({ asset, name }: BinPreviewProps) {
  const integration = useRitobinIntegration();
  const open = useOpenInRitobin();

  if (integration.data === false) {
    return (
      <Pane>
        <EmptyState
          size="xs"
          icon={<BinGlyph />}
          description="Bin preview is not supported yet"
          action={<InstallSteps />}
        />
      </Pane>
    );
  }

  return (
    <Pane>
      <EmptyState
        size="xs"
        icon={<BinGlyph />}
        title="No viewer for a property bin"
        description="Open it as ritobin text in VS Code instead"
        action={
          <Button
            size="xs"
            loading={open.isPending}
            left={<ArrowSquareOutIcon className="h-3.5 w-3.5" weight="bold" />}
            onClick={() => open.mutate({ asset, name })}
          >
            Open in VS Code
          </Button>
        }
      />
    </Pane>
  );
}

function Pane({ children }: { children: ReactNode }) {
  return (
    <div
      data-ui="BinPreview"
      className="flex min-h-0 flex-1 flex-col justify-center bg-surface-950 select-none"
    >
      {children}
    </div>
  );
}

/** The mark the tree row carries, so the pane reads like the row that opened it. */
function BinGlyph() {
  const descriptor = describeFileKind("property_bin");
  const Icon = descriptor.icon;

  return (
    <span style={{ color: `var(${descriptor.tintToken})` }}>
      <Icon className="h-10 w-10" strokeWidth={1.5} />
    </span>
  );
}

/** What a machine without the handoff has left to do, in the order to do it. */
function InstallSteps() {
  const copy = useCopyToClipboard();

  return (
    <ol className="max-w-sm list-outside list-decimal pl-5 text-left text-xs leading-relaxed text-surface-400">
      <li>
        Get the <ExternalLink href={EXTENSION_URL}>ritobin-lsp extension</ExternalLink>
      </li>
      <li>
        Run this from its command palette
        <Tooltip content="Copy the command">
          <button
            type="button"
            onClick={() => void copy(PALETTE_COMMAND, "command")}
            className="mt-1 flex w-full items-center gap-1.5 rounded-sm bg-surface-800 px-1.5 py-1 text-left font-mono text-[11px] text-surface-200 transition-colors hover:bg-surface-700"
          >
            <span className="truncate">{PALETTE_COMMAND}</span>
            <CopyIcon className="ml-auto h-3 w-3 shrink-0 text-surface-400" />
          </button>
        </Tooltip>
      </li>
    </ol>
  );
}
