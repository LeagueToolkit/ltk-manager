import { Monitor } from "lucide-react";

export function PatcherUnsupported() {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-surface-600 bg-surface-800/50 px-4 py-3">
      <Monitor className="h-5 w-5 shrink-0 text-surface-400" />
      <div className="flex flex-col">
        <span className="text-sm font-medium text-surface-200">
          Patcher not available on this platform
        </span>
        <span className="text-xs text-surface-400">
          Mod management works normally. The overlay patcher requires Windows or macOS.
        </span>
      </div>
    </div>
  );
}
