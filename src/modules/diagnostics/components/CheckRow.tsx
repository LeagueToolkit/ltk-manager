import { CopyIcon } from "@phosphor-icons/react";
import { ShieldUser } from "lucide-react";

import { Button, Disclosure, IconButton, Properties, Property, useToast } from "@/components";
import { type Check } from "@/lib/tauri";
import { twMerge } from "@/utils";

import { useFixCommandTerminal } from "../api";
import { SeverityBadge } from "./SeverityBadge";

const VERBATIM_PREFIX = /^(\\\\\?\\|\/\/\?\/)/;

function normalizePath(value: string): string {
  return value.replace(VERBATIM_PREFIX, "");
}

export function CheckRow({ check }: { check: Check }) {
  const toast = useToast();
  const openTerminal = useFixCommandTerminal();
  const hasDetails = check.details.length > 0 || !!check.suggestion || !!check.fixCommand;

  function copyCommand() {
    if (!check.fixCommand) return;
    navigator.clipboard
      .writeText(check.fixCommand)
      .then(() => toast.success("Copied", "Run the command in an elevated terminal"))
      .catch(() => toast.error("Copy failed", "Could not access the clipboard"));
  }

  return (
    <Disclosure.Root
      disabled={!hasDetails}
      className="border-t border-surface-700/60 first:border-t-0"
    >
      <Disclosure.Trigger
        className={twMerge(
          "flex w-full items-center gap-3 px-4 py-2.5 transition-colors",
          hasDetails && "hover:bg-surface-800/60",
          !hasDetails && "cursor-default",
        )}
      >
        <SeverityBadge severity={check.severity} />
        <span className="text-sm font-medium text-surface-200">{check.label}</span>
        <span className="ml-auto truncate text-xs text-surface-400">
          {normalizePath(check.summary)}
        </span>
        {hasDetails && <Disclosure.Caret className="size-4 text-surface-500" />}
      </Disclosure.Trigger>

      <Disclosure.Panel className="space-y-3 border-t border-surface-700/60 bg-surface-950/40 px-4 py-3">
        {check.details.length > 0 && (
          <Properties className="grid-cols-[max-content_minmax(0,1fr)] gap-x-4 text-xs">
            {check.details.map((d, i) => (
              <Property
                key={`${d.key}-${i}`}
                label={d.key}
                className="font-mono break-all text-surface-300"
              >
                {normalizePath(d.value)}
              </Property>
            ))}
          </Properties>
        )}
        {check.suggestion && (
          <p className="text-xs leading-relaxed text-surface-300">{check.suggestion}</p>
        )}
        {check.fixCommand && (
          <div className="rounded-md border border-surface-700/60 bg-surface-900/80">
            <div className="flex items-center justify-between gap-2 border-b border-surface-700/60 px-3 py-1.5">
              <span className="font-mono text-fine tracking-wider text-surface-500">
                FIX COMMAND (run as administrator)
              </span>
              <div className="flex items-center gap-1">
                <IconButton
                  icon={<CopyIcon />}
                  size="md"
                  onClick={copyCommand}
                  aria-label="Copy command"
                  tooltip="Copy to clipboard"
                />
                <Button
                  variant="tonal"
                  size="sm"
                  left={<ShieldUser className="size-3.5" />}
                  onClick={() => check.fixCommand && openTerminal(check.fixCommand)}
                >
                  Open elevated terminal
                </Button>
              </div>
            </div>
            <pre className="overflow-x-auto px-3 py-2 font-mono text-xs whitespace-pre text-surface-200">
              {check.fixCommand}
            </pre>
          </div>
        )}
      </Disclosure.Panel>
    </Disclosure.Root>
  );
}
