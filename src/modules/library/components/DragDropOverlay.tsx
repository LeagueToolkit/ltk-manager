import { Upload } from "lucide-react";

interface DragDropOverlayProps {
  visible: boolean;
}

export function DragDropOverlay({ visible }: DragDropOverlayProps) {
  if (!visible) return null;

  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-surface-950/90 backdrop-blur-sm">
      <div className="flex flex-col items-center gap-4 rounded-2xl border-2 border-dashed border-accent-500 bg-surface-800/50 p-12">
        <Upload className="h-16 w-16 text-accent-500" />
        <div className="text-center">
          <p className="text-lg font-medium text-surface-100">Drop to install</p>
          <p className="text-sm text-surface-400">.modpkg or .fantome files</p>
        </div>
      </div>
    </div>
  );
}
