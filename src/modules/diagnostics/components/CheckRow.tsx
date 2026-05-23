import { ChevronRight, Copy, ShieldUser } from "lucide-react";
import { useState } from "react";
import { twMerge } from "tailwind-merge";

import { Button, IconButton, Tooltip, useToast } from "@/components";
import { api, type Check, isErr } from "@/lib/tauri";

import { SeverityBadge } from "./SeverityBadge";

const VERBATIM_PREFIX = /^(\\\\\?\\|\/\/\?\/)/;

function normalizePath(value: string): string {
  return value.replace(VERBATIM_PREFIX, "");
}

export function CheckRow({ check }: { check: Check }) {
  const [open, setOpen] = useState(false);
  const toast = useToast();
  const hasDetails = check.details.length > 0 || !!check.suggestion || !!check.fixCommand;

  function copyCommand() {
    if (!check.fixCommand) return;
    navigator.clipboard
      .writeText(check.fixCommand)
      .then(() => toast.success("Copied", "Run the command in an elevated terminal"))
      .catch(() => toast.error("Copy failed", "Could not access the clipboard"));
  }

  async function runAsAdmin() {
    if (!check.fixCommand) return;
    let clipboardOk = true;
    try {
      await navigator.clipboard.writeText(check.fixCommand);
    } catch {
      clipboardOk = false;
    }
    const result = await api.openElevatedTerminal(clipboardOk);
    if (isErr(result)) {
      toast.error("Could not open elevated terminal", result.error.message);
      return;
    }
    if (clipboardOk) {
      toast.success("Elevated terminal opened", "Paste with Ctrl+V and press Enter");
    } else {
      toast.warning(
        "Elevated terminal opened, but copy failed",
        "Copy the command manually from the diagnostics row before running it.",
      );
    }
  }

  return (
    <div className="border-t border-surface-700/60 first:border-t-0">
      <button
        type="button"
        onClick={() => hasDetails && setOpen((v) => !v)}
        disabled={!hasDetails}
        aria-expanded={hasDetails ? open : undefined}
        className={twMerge(
          "flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors",
          hasDetails && "cursor-pointer hover:bg-surface-800/60",
          !hasDetails && "cursor-default",
        )}
      >
        <SeverityBadge severity={check.severity} />
        <span className="text-sm font-medium text-surface-200">{check.label}</span>
        <span className="ml-auto truncate text-xs text-surface-400">
          {normalizePath(check.summary)}
        </span>
        {hasDetails && (
          <ChevronRight
            className={twMerge(
              "h-4 w-4 shrink-0 text-surface-500 transition-transform",
              open && "rotate-90",
            )}
          />
        )}
      </button>

      {open && hasDetails && (
        <div className="space-y-3 border-t border-surface-700/60 bg-surface-950/40 px-4 py-3">
          {check.details.length > 0 && (
            <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-xs">
              {check.details.map((d, i) => (
                <div key={`${d.key}-${i}`} className="contents">
                  <dt className="text-surface-500">{d.key}</dt>
                  <dd className="font-mono break-all text-surface-300">{normalizePath(d.value)}</dd>
                </div>
              ))}
            </dl>
          )}
          {check.suggestion && (
            <p className="text-xs leading-relaxed text-surface-300">{check.suggestion}</p>
          )}
          {check.fixCommand && (
            <div className="rounded-md border border-surface-700/60 bg-surface-900/80">
              <div className="flex items-center justify-between gap-2 border-b border-surface-700/60 px-3 py-1.5">
                <span className="font-mono text-[10px] tracking-wider text-surface-500">
                  FIX COMMAND (run as administrator)
                </span>
                <div className="flex items-center gap-1">
                  <Tooltip content="Copy to clipboard">
                    <IconButton
                      icon={<Copy className="h-3.5 w-3.5" />}
                      variant="ghost"
                      size="sm"
                      onClick={copyCommand}
                      aria-label="Copy command"
                    />
                  </Tooltip>
                  <Button
                    variant="light"
                    size="xs"
                    left={<ShieldUser className="h-3.5 w-3.5" />}
                    onClick={runAsAdmin}
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
        </div>
      )}
    </div>
  );
}
