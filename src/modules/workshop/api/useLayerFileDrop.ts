import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect, useState } from "react";

const WAD_SUFFIXES = [".wad.client", ".wad.mobile", ".wad"];

function basename(path: string): string {
  const norm = path.replace(/[\\/]+$/, "");
  const slashIndex = Math.max(norm.lastIndexOf("/"), norm.lastIndexOf("\\"));
  return slashIndex >= 0 ? norm.slice(slashIndex + 1) : norm;
}

function isWadPath(path: string): boolean {
  const lower = basename(path).toLowerCase();
  return WAD_SUFFIXES.some((suffix) => lower.endsWith(suffix));
}

/**
 * Listen for OS-level drag-drop of WAD files/folders onto the window.
 * Mirrors `useModFileDrop`; matches `.wad`, `.wad.client`, and `.wad.mobile`
 * by basename (directory or file).
 */
export function useLayerFileDrop(onDrop: (paths: string[]) => void): boolean {
  const [isDragOver, setIsDragOver] = useState(false);

  useEffect(() => {
    const currentWindow = getCurrentWindow();
    const unlisten = currentWindow.onDragDropEvent((event) => {
      const eventType = event.payload.type;
      if (eventType === "enter" || eventType === "over") {
        setIsDragOver(true);
      } else if (eventType === "drop") {
        setIsDragOver(false);
        const paths = event.payload.paths as string[];
        const validPaths = paths.filter(isWadPath);
        if (validPaths.length > 0) {
          onDrop(validPaths);
        }
      } else if (eventType === "leave" || eventType === "cancel") {
        setIsDragOver(false);
      }
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, [onDrop]);

  return isDragOver;
}
