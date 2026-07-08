import { Loader2, Square } from "lucide-react";
import { useEffect, useRef } from "react";
import { twMerge } from "tailwind-merge";

import { IconButton, Kbd, Tooltip } from "@/components";
import { usePatcherSessionStore } from "@/stores";

import { usePatcherStatus, useStopPatcher } from "../api";

export function PatcherStatusPill() {
  const { data: status } = usePatcherStatus();
  const testingProjects = usePatcherSessionStore((s) => s.testingProjects);
  const clearTestingProjects = usePatcherSessionStore((s) => s.clearTestingProjects);
  const stopPatcher = useStopPatcher();

  const running = status?.running ?? false;
  const building = status?.phase === "building";
  const isIdle = !running && !building;

  const wasActiveRef = useRef(false);
  useEffect(() => {
    if (!isIdle) {
      wasActiveRef.current = true;
    } else if (wasActiveRef.current && testingProjects.length > 0) {
      clearTestingProjects();
      wasActiveRef.current = false;
    }
  }, [isIdle, testingProjects, clearTestingProjects]);

  if (isIdle) return null;

  const testLabel =
    testingProjects.length === 1
      ? testingProjects[0].displayName
      : testingProjects.length > 1
        ? `${testingProjects.length} projects`
        : null;

  const label = status?.message
    ? status.message
    : building
      ? testLabel
        ? `Building ${testLabel}…`
        : "Building overlay…"
      : testLabel
        ? `Testing ${testLabel}`
        : "Patcher running";

  const tone = building ? "accent" : "running";

  return (
    <div
      className={twMerge(
        "fixed right-4 bottom-4 z-40 flex h-9 animate-fade-in items-center gap-2 rounded-full border px-3 text-sm font-medium shadow-lg",
        tone === "accent"
          ? "border-accent-500/40 bg-accent-500/15 text-accent-300"
          : "border-green-500/40 bg-green-500/15 text-green-300",
      )}
    >
      {building ? (
        <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
      ) : (
        <span className="inline-flex h-2 w-2 shrink-0 rounded-full bg-green-500 shadow-[0_0_6px_2px_rgba(74,222,128,0.6)]" />
      )}
      <span className="max-w-[240px] truncate">{label}</span>
      {!building && (
        <Tooltip
          content={
            <>
              Stop patcher <Kbd shortcut="Ctrl+P" />
            </>
          }
        >
          <IconButton
            icon={<Square className="h-3.5 w-3.5" />}
            variant="ghost"
            size="xs"
            onClick={() => stopPatcher.mutate()}
            loading={stopPatcher.isPending}
            aria-label="Stop patcher"
            className="-mr-1.5 text-green-300 hover:bg-green-500/25 hover:text-green-200"
          />
        </Tooltip>
      )}
    </div>
  );
}
