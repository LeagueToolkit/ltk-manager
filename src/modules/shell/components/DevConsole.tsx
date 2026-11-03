import { TrashIcon, XIcon } from "@phosphor-icons/react";
import { Terminal } from "lucide-react";
import { useEffect, useRef } from "react";

import { IconButton } from "@/components";
import { useKeys } from "@/modules/keys";
import { twMerge } from "@/utils";

import { isLevelVisible, type LogEntry, useDevConsoleStore } from "../state";

const levelColors: Record<string, string> = {
  TRACE: "text-surface-500",
  DEBUG: "text-surface-400",
  INFO: "text-info-text",
  WARN: "text-warning-text",
  ERROR: "text-danger-text",
};

const LEVEL_OPTIONS = ["TRACE", "DEBUG", "INFO", "WARN", "ERROR"] as const;

function LogLine({ entry }: { entry: LogEntry }) {
  return (
    <div className="flex gap-2 px-2 py-0.5 font-mono text-xs leading-5 hover:bg-surface-800/50">
      <span className="shrink-0 text-surface-500">{entry.timestamp}</span>
      <span className={twMerge("w-12 shrink-0 text-right font-semibold", levelColors[entry.level])}>
        {entry.level}
      </span>
      <span className="shrink-0 text-surface-500">{entry.target}</span>
      <span className="min-w-0 text-surface-300">{entry.message}</span>
    </div>
  );
}

export function DevConsole() {
  const {
    entries,
    isOpen,
    levelFilter,
    targetFilter,
    toggle,
    setLevelFilter,
    setTargetFilter,
    clear,
  } = useDevConsoleStore();
  const scrollRef = useRef<HTMLDivElement>(null);
  const shouldAutoScroll = useRef(true);

  useKeys("app", { "app.devConsole": toggle });

  // Auto-scroll to bottom when new entries arrive
  useEffect(() => {
    if (scrollRef.current && shouldAutoScroll.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [entries]);

  const handleScroll = () => {
    if (!scrollRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
    shouldAutoScroll.current = scrollHeight - scrollTop - clientHeight < 40;
  };

  if (!isOpen) return null;

  const filteredEntries = entries.filter((entry) => {
    if (!isLevelVisible(entry.level, levelFilter)) return false;
    if (targetFilter && !entry.target.toLowerCase().includes(targetFilter.toLowerCase()))
      return false;
    return true;
  });

  return (
    <div className="flex h-64 shrink-0 flex-col border-t border-surface-600 bg-surface-900">
      {/* Toolbar */}
      <div className="flex items-center gap-2 border-b border-surface-700 px-2 py-1">
        <Terminal className="size-3.5 text-surface-400" />
        <span className="text-xs font-medium text-surface-300">Dev Console</span>

        <select
          value={levelFilter}
          onChange={(e) => setLevelFilter(e.target.value as (typeof LEVEL_OPTIONS)[number])}
          className="ml-2 rounded-md border border-surface-600 bg-surface-800 px-1.5 py-0.5 text-xs text-surface-300"
        >
          {LEVEL_OPTIONS.map((level) => (
            <option key={level} value={level}>
              {level}+
            </option>
          ))}
        </select>

        <input
          type="text"
          value={targetFilter}
          onChange={(e) => setTargetFilter(e.target.value)}
          placeholder="Filter target..."
          className="w-40 rounded-md border border-surface-600 bg-surface-800 px-1.5 py-0.5 text-xs text-surface-300 placeholder:text-surface-600"
        />

        <span className="ml-auto text-xs text-surface-500">{filteredEntries.length} entries</span>

        <IconButton size="sm" icon={<TrashIcon />} onClick={clear} muted label="Clear console" />
        <IconButton size="sm" icon={<XIcon />} onClick={toggle} muted label="Close console" />
      </div>

      {/* Log entries */}
      <div ref={scrollRef} onScroll={handleScroll} className="flex-1 overflow-y-auto">
        {filteredEntries.map((entry) => (
          <LogLine key={entry.id} entry={entry} />
        ))}
      </div>
    </div>
  );
}
